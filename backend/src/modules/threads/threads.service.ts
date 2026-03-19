import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  ListThreadsDto,
  ThreadInboxCountsDto,
  BulkUpdateThreadsDto,
  UpdateThreadDto,
  ComposeThreadDto,
  ReplyThreadDto,
  AssignThreadDto,
  CreateNoteDto,
  UpdateNoteDto,
} from './dto/thread.dto';
import {
  ThreadStatus,
  ThreadPriority,
  MessageDirection,
  Prisma,
} from '@prisma/client';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { EventsGateway } from '../websockets/events.gateway';
import sanitizeHtml from 'sanitize-html';
import { SlaService } from '../sla/sla.service';
import type { BusinessHours, SlaTargets } from '../sla/dto/sla.dto';

const ALGORITHM = 'aes-256-gcm';

type MailboxSmtpConfig = {
  id: string;
  name: string;
  email: string | null;
  provider: string;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  oauthProvider: string | null;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
  googleAccessToken: string | null;
  googleRefreshToken: string | null;
  syncStatus?: string | null;
  lastSyncError?: string | null;
};

// RFC 5322 threading interfaces (per spec)
interface MessageHeaders {
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
}

interface ThreadMatch {
  threadId: string | null;
  matchedBy: 'messageId' | 'subject' | 'new';
}

@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventsGateway: EventsGateway,
    private readonly slaService: SlaService,
  ) {}

  private async buildSlaThreadData(params: {
    threadId: string;
    organizationId: string;
    createdAt: Date;
    priority: string;
    slaPolicyId: string | null;
  }): Promise<Prisma.ThreadUpdateInput> {
    if (!params.slaPolicyId) {
      return {
        firstResponseDueAt: null,
        resolutionDueAt: null,
        slaBreached: false,
      };
    }

    const policy = await this.prisma.slaPolicy.findFirst({
      where: {
        id: params.slaPolicyId,
        organizationId: params.organizationId,
        deletedAt: null,
        isActive: true,
      },
      select: {
        targets: true,
        businessHours: true,
      },
    });

    if (!policy) {
      throw new BadRequestException('SLA policy not found or inactive.');
    }

    const [latestInbound, latestOutbound] = await Promise.all([
      this.prisma.message.findFirst({
        where: {
          threadId: params.threadId,
          direction: MessageDirection.INBOUND,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.message.findFirst({
        where: {
          threadId: params.threadId,
          direction: MessageDirection.OUTBOUND,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const deadlines = this.slaService.resolveThreadDeadlines(
      {
        createdAt: params.createdAt,
        priority: params.priority,
        latestInboundAt: latestInbound?.createdAt ?? null,
        latestOutboundAt: latestOutbound?.createdAt ?? null,
      },
      policy.targets as unknown as SlaTargets,
      (policy.businessHours as BusinessHours | null) ?? null,
    );

    const now = new Date();
    const slaBreached = Boolean(
      (deadlines.firstResponseDueAt &&
        deadlines.firstResponseDueAt.getTime() <= now.getTime()) ||
        (deadlines.resolutionDueAt &&
          deadlines.resolutionDueAt.getTime() <= now.getTime()),
    );

    return {
      firstResponseDueAt: deadlines.firstResponseDueAt,
      resolutionDueAt: deadlines.resolutionDueAt,
      slaBreached,
    };
  }

  private parseThreadStatus(value: string | null | undefined): ThreadStatus {
    const upper = String(value || '').toUpperCase();
    if (Object.values(ThreadStatus).includes(upper as ThreadStatus)) {
      return upper as ThreadStatus;
    }
    return ThreadStatus.OPEN;
  }

  private getEncryptionKey(): Buffer {
    const key = this.configService.get<string>('encryption.key') ?? '';
    return Buffer.from(crypto.createHash('sha256').update(key).digest());
  }

  private getLegacyEncryptionKey(): Buffer {
    const key = this.configService.get<string>('encryption.key') ?? '';
    return Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf8');
  }

  private decryptWithKey(value: string, key: Buffer): string {
    const [ivHex, tagHex, dataHex] = value.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data).toString('utf8') + decipher.final('utf8');
  }

  private decryptSecretIfNeeded(value?: string | null): string | undefined {
    if (!value) return undefined;
    const parts = value.split(':');
    const looksEncrypted =
      parts.length === 3 && parts.every((part) => /^[0-9a-f]+$/i.test(part));
    if (!looksEncrypted) return value;
    try {
      return this.decryptWithKey(value, this.getEncryptionKey());
    } catch {
      try {
        return this.decryptWithKey(value, this.getLegacyEncryptionKey());
      } catch {
        this.logger.warn(
          'Failed to decrypt mailbox secret. Check ENCRYPTION_KEY consistency.',
        );
        return undefined;
      }
    }
  }

  private sanitizeEmails(input?: string[] | null): string[] {
    if (!Array.isArray(input)) return [];
    return input
      .map((item) => String(item || '').trim())
      .filter((item) => item.length > 0);
  }

  private extractFirstEmail(input: unknown): string | null {
    if (Array.isArray(input)) {
      for (const entry of input) {
        const found = this.extractFirstEmail(entry);
        if (found) return found;
      }
      return null;
    }

    if (input && typeof input === 'object') {
      const emailValue = (input as Record<string, unknown>).email;
      if (typeof emailValue === 'string' && emailValue.trim())
        return emailValue.trim();
      const addressValue = (input as Record<string, unknown>).address;
      if (typeof addressValue === 'string' && addressValue.trim())
        return addressValue.trim();
      return null;
    }

    if (typeof input === 'string' && input.trim()) {
      const raw = input.trim();
      const matched = raw.match(/<([^>]+)>/);
      return matched ? matched[1].trim() : raw;
    }

    return null;
  }

  private normalizeSubject(subject?: string | null): string {
    const clean = String(subject || '').trim();
    if (!clean) return 'Re: (no subject)';
    return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
  }

  private normalizeMessageId(value?: string | null): string | undefined {
    const raw = String(value || '').trim();
    if (!raw) return undefined;
    return raw.startsWith('<') && raw.endsWith('>') ? raw : `<${raw}>`;
  }

  private extractReferences(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
    }
    if (typeof value === 'string') {
      return value
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }
    return [];
  }

  private async sendReplyThroughProvider(params: {
    mailbox: MailboxSmtpConfig;
    actor: JwtUser;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    bodyHtml?: string;
    bodyText?: string;
    inReplyTo?: string;
    references?: string[];
    threadId: string;
  }): Promise<{ providerMessageId?: string; fromEmail: string }> {
    const globalHost = this.configService.get<string>('smtp.host') ?? '';
    const globalPort = this.configService.get<number>('smtp.port') ?? 587;
    const globalUser = this.configService.get<string>('smtp.user') ?? '';
    const globalPass = this.configService.get<string>('smtp.pass') ?? '';
    const globalFrom = this.configService.get<string>('smtp.from') ?? '';

    const host = params.mailbox.smtpHost || globalHost;
    const port = params.mailbox.smtpPort || globalPort;
    const secure = params.mailbox.smtpSecure ?? port === 465;
    const mailboxSmtpUser = params.mailbox.smtpUser || '';
    const mailboxSmtpPass =
      this.decryptSecretIfNeeded(params.mailbox.smtpPass) || '';
    const smtpUser = mailboxSmtpUser || globalUser;
    const smtpPass = mailboxSmtpPass || globalPass;

    const oauthAccessToken =
      this.decryptSecretIfNeeded(params.mailbox.oauthAccessToken) ||
      this.decryptSecretIfNeeded(params.mailbox.googleAccessToken);
    const oauthRefreshToken =
      this.decryptSecretIfNeeded(params.mailbox.oauthRefreshToken) ||
      this.decryptSecretIfNeeded(params.mailbox.googleRefreshToken);
    const googleClientId =
      this.configService.get<string>('google.clientId') ?? '';
    const googleClientSecret =
      this.configService.get<string>('google.clientSecret') ?? '';

    const fromEmail = params.mailbox.email || globalFrom || params.actor.email;
    const replyTo = params.mailbox.email || params.actor.email;

    const isDisconnectedOauthMailbox =
      (params.mailbox.provider === 'GMAIL' ||
        params.mailbox.provider === 'OUTLOOK') &&
      !params.mailbox.oauthProvider &&
      params.mailbox.lastSyncError === 'OAuth disconnected';

    if (isDisconnectedOauthMailbox) {
      throw new BadRequestException(
        'Mailbox is disconnected. Reconnect this mailbox before sending.',
      );
    }

    if (!host) {
      throw new BadRequestException(
        'SMTP host is not configured for this mailbox.',
      );
    }

    if (!fromEmail) {
      throw new BadRequestException(
        'From email is not configured for this mailbox.',
      );
    }

    if (!params.to.length) {
      throw new BadRequestException('No valid recipient found for this reply.');
    }

    let authMode: 'oauth2' | 'password' | 'none' = 'none';
    let transportAuth: Record<string, unknown> = {};

    if (oauthAccessToken) {
      authMode = 'oauth2';
      transportAuth = {
        auth: {
          type: 'OAuth2' as const,
          user: params.mailbox.email || fromEmail,
          accessToken: oauthAccessToken,
          ...(oauthRefreshToken ? { refreshToken: oauthRefreshToken } : {}),
          ...(googleClientId ? { clientId: googleClientId } : {}),
          ...(googleClientSecret ? { clientSecret: googleClientSecret } : {}),
        },
      };
    } else if (smtpUser && smtpPass) {
      authMode = 'password';
      transportAuth = {
        auth: { user: smtpUser, pass: smtpPass },
      };
    }

    if (authMode === 'none' && /gmail\.com$/i.test(host)) {
      throw new BadRequestException(
        'Mailbox authentication is missing (SMTP credentials or OAuth token required).',
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      ...transportAuth,
    });

    try {
      const info = await transporter.sendMail({
        from: params.mailbox.name
          ? `"${params.mailbox.name}" <${fromEmail}>`
          : fromEmail,
        replyTo,
        to: params.to,
        cc: params.cc.length > 0 ? params.cc : undefined,
        bcc: params.bcc.length > 0 ? params.bcc : undefined,
        subject: params.subject,
        html: params.bodyHtml,
        text: params.bodyText,
        inReplyTo: params.inReplyTo,
        references: params.references,
      });

      return {
        providerMessageId:
          typeof info?.messageId === 'string' ? info.messageId : undefined,
        fromEmail,
      };
    } catch (error) {
      const details = {
        threadId: params.threadId,
        mailboxId: params.mailbox.id,
        authMode,
        fromEmail,
        replyTo,
        to: params.to,
        cc: params.cc,
        bcc: params.bcc,
        subject: params.subject,
      };
      const providerMessage =
        error instanceof Error ? error.message : 'Unknown provider error';
      this.logger.error(
        `[reply-send-failed] ${JSON.stringify({ ...details, providerMessage })}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        `Failed to deliver email to provider: ${providerMessage}`,
      );
    }
  }

  // ─── RFC 5322 Thread matching ──────────────────────────────────────────────

  async findThreadForMessage(
    headers: MessageHeaders,
    mailboxId: string,
  ): Promise<ThreadMatch> {
    // 1. Match by In-Reply-To / References messageId
    if (
      headers.inReplyTo ||
      (headers.references && headers.references.length > 0)
    ) {
      const ids = [
        ...(headers.inReplyTo ? [headers.inReplyTo] : []),
        ...(headers.references ?? []),
      ];
      const existing = await this.prisma.message.findFirst({
        where: { messageId: { in: ids }, mailboxId },
        select: { threadId: true },
      });
      if (existing)
        return { threadId: existing.threadId, matchedBy: 'messageId' };
    }

    // 2. Match by subject (normalize: strip Re:/Fwd: prefixes)
    const normalizedSubject = headers.subject
      .replace(/^(re:|fwd?:|aw:|fw:)\s*/gi, '')
      .trim();
    if (normalizedSubject) {
      const existing = await this.prisma.thread.findFirst({
        where: {
          mailboxId,
          subject: { contains: normalizedSubject, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (existing) return { threadId: existing.id, matchedBy: 'subject' };
    }

    return { threadId: null, matchedBy: 'new' };
  }

  // ─── Threads ──────────────────────────────────────────────────────────────

  async findAll(query: ListThreadsDto, user: JwtUser) {
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Number(query.limit ?? 50), 200);
    const skip = (page - 1) * limit;

    const where: Prisma.ThreadWhereInput = {
      organizationId: user.organizationId,
      mailbox: { deletedAt: null },
      ...(query.mailboxId && { mailboxId: query.mailboxId }),
      ...(query.status && { status: query.status as ThreadStatus }),
      ...(query.priority && { priority: query.priority as ThreadPriority }),
      ...(query.assignedUserId && { assignedUserId: query.assignedUserId }),
      ...(query.folderId && {
        messages: { some: { folderId: query.folderId } },
      }),
      ...(query.tagId && { tags: { some: { tagId: query.tagId } } }),
      ...(query.tag && {
        tags: {
          some: {
            tag: {
              name: { contains: query.tag, mode: 'insensitive' as const },
            },
          },
        },
      }),
      ...(query.search && {
        OR: [
          { subject: { contains: query.search, mode: 'insensitive' as const } },
          {
            contact: {
              email: { contains: query.search, mode: 'insensitive' as const },
            },
          },
        ],
      }),
    };

    const assigned = String(query.assigned || '').toLowerCase();
    if (assigned === 'me') {
      where.assignedUserId = user.sub;
    } else if (assigned === 'unassigned') {
      where.assignedUserId = null;
      where.assignedToTeamId = null;
    } else if (assigned === 'team') {
      const teamRows = await this.prisma.teamMember.findMany({
        where: { userId: user.sub },
        select: { teamId: true },
      });
      const teamIds = teamRows.map((row) => row.teamId);
      where.assignedToTeamId = { in: teamIds };
    }

    if (query.slaBreached !== undefined) {
      where.slaBreached = query.slaBreached;
    }

    const candidates = await this.prisma.thread.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        status: true,
        starred: true,
        resolutionDueAt: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            folder: { select: { type: true } },
          },
        },
      },
    });

    const folder = String(query.folder || query.folderType || '').toLowerCase();
    const now = Date.now();
    const soonThreshold = now + 60 * 60 * 1000;
    const filteredCandidates = candidates.filter((candidate) => {
      if (query.slaDue === 'soon') {
        if (!candidate.resolutionDueAt) return false;
        const due = candidate.resolutionDueAt.getTime();
        if (due < now || due > soonThreshold) return false;
      }

      if (!folder) return true;

      if (folder === 'archive') {
        return candidate.status === ThreadStatus.ARCHIVED;
      }

      if (folder === 'starred') {
        return candidate.starred === true;
      }

      if (
        folder === 'inbox' ||
        folder === 'sent' ||
        folder === 'drafts' ||
        folder === 'spam' ||
        folder === 'trash'
      ) {
        const latestMessage = candidate.messages[0];
        const latestFolderType = String(
          latestMessage?.folder?.type || '',
        ).toLowerCase();
        return latestFolderType === folder;
      }

      return true;
    });

    const total = filteredCandidates.length;
    const pageSlice = filteredCandidates.slice(skip, skip + limit);
    const pageIds = pageSlice.map((item) => item.id);

    const threadsUnordered =
      pageIds.length > 0
        ? await this.prisma.thread.findMany({
            where: { id: { in: pageIds } },
            include: {
              assignedUser: {
                select: { id: true, fullName: true, email: true },
              },
              assignedTeam: { select: { id: true, name: true } },
              contact: { select: { id: true, email: true, name: true } },
              mailbox: {
                select: { id: true, email: true, name: true, provider: true },
              },
              messages: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  id: true,
                  fromEmail: true,
                  bodyText: true,
                  isRead: true,
                  folderId: true,
                  createdAt: true,
                  folder: { select: { type: true, name: true } },
                },
              },
              tags: {
                include: {
                  tag: {
                    select: {
                      id: true,
                      name: true,
                      color: true,
                      scope: true,
                      ownerId: true,
                    },
                  },
                },
              },
              _count: { select: { messages: true, notes: true } },
            },
          })
        : [];

    const threadMap = new Map(
      threadsUnordered.map((thread) => [thread.id, thread]),
    );
    const threads = pageIds
      .map((id) => threadMap.get(id))
      .filter((thread): thread is (typeof threadsUnordered)[number] =>
        Boolean(thread),
      );

    const totalPages = Math.max(Math.ceil(total / limit), 1);
    const hasMore = page < totalPages;
    const nextCursor =
      hasMore && threads.length > 0
        ? threads[threads.length - 1].id
        : undefined;

    return {
      // Nest-style shape
      items: threads,
      nextCursor,
      hasMore,
      // Legacy Express-style compatibility shape (used by current frontend)
      threads,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore,
      },
    };
  }

  async getInboxCounts(query: ThreadInboxCountsDto, user: JwtUser) {
    const baseWhere: Prisma.ThreadWhereInput = {
      organizationId: user.organizationId,
      mailbox: { deletedAt: null },
      ...(query.mailboxId && { mailboxId: query.mailboxId }),
    };

    const teamRows = await this.prisma.teamMember.findMany({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    const teamIds = teamRows.map((row) => row.teamId);

    const now = new Date();
    const soonThreshold = new Date(now.getTime() + 60 * 60 * 1000);
    const includeTagCounts = query.includeTagCounts !== false;

    const counts = await Promise.all([
      this.prisma.thread.count({ where: baseWhere }),
      this.prisma.thread.count({
        where: { ...baseWhere, assignedUserId: user.sub },
      }),
      this.prisma.thread.count({
        where: { ...baseWhere, assignedUserId: null, assignedToTeamId: null },
      }),
      teamIds.length > 0
        ? this.prisma.thread.count({
            where: { ...baseWhere, assignedToTeamId: { in: teamIds } },
          })
        : Promise.resolve(0),
      this.prisma.thread.count({
        where: { ...baseWhere, priority: ThreadPriority.HIGH },
      }),
      this.prisma.thread.count({
        where: { ...baseWhere, priority: ThreadPriority.NORMAL },
      }),
      this.prisma.thread.count({
        where: { ...baseWhere, priority: ThreadPriority.LOW },
      }),
      this.prisma.thread.count({
        where: {
          ...baseWhere,
          resolutionDueAt: {
            gte: now,
            lte: soonThreshold,
          },
        },
      }),
      this.prisma.thread.count({ where: { ...baseWhere, slaBreached: true } }),
      this.prisma.thread.count({ where: { ...baseWhere, starred: true } }),
      this.prisma.thread.count({
        where: { ...baseWhere, status: ThreadStatus.ARCHIVED },
      }),
    ]);

    let tagCounts: Record<string, number> = {};

    if (includeTagCounts) {
      const groupedTags = await this.prisma.threadTag.groupBy({
        by: ['tagId'],
        where: {
          thread: {
            organizationId: user.organizationId,
            mailbox: { deletedAt: null },
            ...(query.mailboxId ? { mailboxId: query.mailboxId } : {}),
          },
          tag: {
            deletedAt: null,
          },
        },
        _count: { _all: true },
      });

      tagCounts = groupedTags.reduce<Record<string, number>>((acc, row) => {
        acc[row.tagId] = row._count._all;
        return acc;
      }, {});
    }

    return {
      sidebar: {
        all: counts[0],
        'my-threads': counts[1],
        unassigned: counts[2],
        'team-inbox': counts[3],
        'priority-high': counts[4],
        'priority-normal': counts[5],
        'priority-low': counts[6],
        'sla-at-risk': counts[7],
        'sla-breached': counts[8],
      },
      mailbox: {
        starred: counts[9],
        archive: counts[10],
      },
      tags: tagCounts,
    };
  }

  async findOne(id: string, user: JwtUser) {
    const thread = await this.prisma.thread.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        assignedUser: { select: { id: true, fullName: true, email: true } },
        assignedTeam: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
        contact: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true } },
        slaPolicy: { select: { id: true, name: true } },
        _count: { select: { messages: true, notes: true } },
      },
    });
    if (!thread) throw new NotFoundException('Thread not found');
    return thread;
  }

  async bulkUpdate(dto: BulkUpdateThreadsDto, user: JwtUser) {
    await this.prisma.thread.updateMany({
      where: { id: { in: dto.ids }, organizationId: user.organizationId },
      data: {
        ...(dto.status && { status: dto.status as ThreadStatus }),
        ...(dto.assignedUserId !== undefined && {
          assignedUserId: dto.assignedUserId,
        }),
        ...(dto.assignedToTeamId !== undefined && {
          assignedToTeamId: dto.assignedToTeamId,
        }),
      },
    });
    return { updated: dto.ids.length };
  }

  async update(id: string, dto: UpdateThreadDto, user: JwtUser) {
    const thread = await this.prisma.thread.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const rawSlaPolicyId = (dto as { slaPolicyId?: string | null }).slaPolicyId;
    const data: Prisma.ThreadUpdateInput = {
      ...(dto.status && { status: dto.status as ThreadStatus }),
      ...(dto.priority && { priority: dto.priority as ThreadPriority }),
      ...(dto.assignedUserId !== undefined && {
        assignedUserId: dto.assignedUserId,
      }),
      ...(dto.assignedToTeamId !== undefined && {
        assignedToTeamId: dto.assignedToTeamId,
      }),
      ...(rawSlaPolicyId !== undefined && { slaPolicyId: rawSlaPolicyId }),
      ...(dto.snoozedUntil !== undefined && {
        snoozedUntil: dto.snoozedUntil,
        status: ThreadStatus.SNOOZED,
        previousStatus: thread.status,
      }),
    };

    if (rawSlaPolicyId !== undefined || dto.priority !== undefined) {
      Object.assign(
        data,
        await this.buildSlaThreadData({
          threadId: id,
          organizationId: user.organizationId,
          createdAt: thread.createdAt,
          priority: dto.priority ?? thread.priority,
          slaPolicyId:
            rawSlaPolicyId !== undefined
              ? rawSlaPolicyId ?? null
              : thread.slaPolicyId ?? null,
        }),
      );
    }

    const updated = await this.prisma.thread.update({
      where: { id },
      data,
    });

    this.eventsGateway.emitToOrganization(
      user.organizationId,
      'thread:updated',
      {
        threadId: updated.id,
        mailboxId: updated.mailboxId,
        type: 'status_changed',
      },
    );

    return updated;
  }

  async star(threadId: string, starred: boolean, user: JwtUser) {
    await this.findOne(threadId, user);
    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: { starred },
    });

    this.eventsGateway.emitToOrganization(
      user.organizationId,
      'thread:updated',
      {
        threadId: updated.id,
        mailboxId: updated.mailboxId,
        type: 'status_changed',
      },
    );

    return updated;
  }

  async archive(threadId: string, user: JwtUser) {
    const thread = await this.findOne(threadId, user);
    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: {
        previousStatus: thread.status,
        status: ThreadStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });

    this.eventsGateway.emitToOrganization(
      user.organizationId,
      'thread:updated',
      {
        threadId: updated.id,
        mailboxId: updated.mailboxId,
        type: 'status_changed',
      },
    );

    return updated;
  }

  async unarchive(threadId: string, user: JwtUser) {
    const thread = await this.findOne(threadId, user);
    const restoredStatus = this.parseThreadStatus(thread.previousStatus);
    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: {
        status: restoredStatus,
        archivedAt: null,
        previousStatus: null,
      },
    });

    this.eventsGateway.emitToOrganization(
      user.organizationId,
      'thread:updated',
      {
        threadId: updated.id,
        mailboxId: updated.mailboxId,
        type: 'status_changed',
      },
    );

    return updated;
  }

  async compose(dto: ComposeThreadDto, user: JwtUser) {
    // Create a new thread + first outbound message
    const thread = await this.prisma.thread.create({
      data: {
        mailboxId: dto.mailboxId,
        organizationId: user.organizationId,
        subject: dto.subject,
        status: ThreadStatus.OPEN,
      },
    });

    const message = await this.prisma.message.create({
      data: {
        threadId: thread.id,
        mailboxId: dto.mailboxId,
        direction: MessageDirection.OUTBOUND,
        fromEmail: user.email,
        to: dto.to as unknown as import('@prisma/client').Prisma.InputJsonValue,
        cc: (dto.cc ??
          []) as unknown as import('@prisma/client').Prisma.InputJsonValue,
        bcc: (dto.bcc ??
          []) as unknown as import('@prisma/client').Prisma.InputJsonValue,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        bodyText: dto.bodyText,
        isOutbound: true,
        isDraft: false,
      },
    });

    return { thread, message };
  }

  async reply(threadId: string, dto: ReplyThreadDto, user: JwtUser) {
    const thread = await this.prisma.thread.findFirst({
      where: { id: threadId, organizationId: user.organizationId },
      select: {
        id: true,
        subject: true,
        mailboxId: true,
        createdAt: true,
        priority: true,
        slaPolicyId: true,
        firstResponseAt: true,
        contact: { select: { email: true } },
        mailbox: {
          select: {
            id: true,
            name: true,
            email: true,
            provider: true,
            smtpHost: true,
            smtpPort: true,
            smtpSecure: true,
            smtpUser: true,
            smtpPass: true,
            oauthProvider: true,
            oauthAccessToken: true,
            oauthRefreshToken: true,
            googleAccessToken: true,
            googleRefreshToken: true,
            syncStatus: true,
            lastSyncError: true,
          },
        },
      },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const lastInbound = await this.prisma.message.findFirst({
      where: {
        threadId,
        direction: MessageDirection.INBOUND,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        fromEmail: true,
        replyTo: true,
        messageId: true,
        references: true,
        subject: true,
      },
    });

    const replyTarget =
      this.extractFirstEmail(lastInbound?.replyTo) ||
      this.extractFirstEmail(lastInbound?.fromEmail) ||
      this.extractFirstEmail(thread.contact?.email);

    if (!replyTarget) {
      throw new BadRequestException(
        'No recipient address found for this thread.',
      );
    }

    const cc = this.sanitizeEmails(dto.cc);
    const bcc = this.sanitizeEmails(dto.bcc);
    const to = [replyTarget];

    const inReplyTo = this.normalizeMessageId(
      lastInbound?.messageId || undefined,
    );
    const referenceIds = this.extractReferences(lastInbound?.references);
    if (inReplyTo) {
      referenceIds.push(inReplyTo);
    }

    const references = Array.from(
      new Set(
        referenceIds
          .map((id) => this.normalizeMessageId(id))
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const bodyHtml = dto.bodyHtml || undefined;
    const bodyText =
      dto.bodyText ||
      (dto.bodyHtml
        ? dto.bodyHtml
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : undefined);

    const sendResult = await this.sendReplyThroughProvider({
      mailbox: thread.mailbox,
      actor: user,
      to,
      cc,
      bcc,
      subject: this.normalizeSubject(thread.subject || lastInbound?.subject),
      bodyHtml,
      bodyText,
      inReplyTo,
      references,
      threadId,
    });

    const message = await this.prisma.message.create({
      data: {
        threadId,
        mailboxId: thread.mailboxId,
        direction: MessageDirection.OUTBOUND,
        fromEmail: sendResult.fromEmail,
        to: to as unknown as import('@prisma/client').Prisma.InputJsonValue,
        cc: cc as unknown as import('@prisma/client').Prisma.InputJsonValue,
        bcc: bcc as unknown as import('@prisma/client').Prisma.InputJsonValue,
        subject: this.normalizeSubject(thread.subject || lastInbound?.subject),
        bodyHtml,
        bodyText,
        messageId: sendResult.providerMessageId,
        inReplyTo,
        references:
          references as unknown as import('@prisma/client').Prisma.InputJsonValue,
        isOutbound: true,
        isDraft: false,
      },
    });

    const threadUpdateData: Prisma.ThreadUpdateInput = {};
    if (!thread.firstResponseAt) {
      threadUpdateData.firstResponseAt = new Date();
    }
    if (thread.slaPolicyId) {
      Object.assign(
        threadUpdateData,
        await this.buildSlaThreadData({
          threadId,
          organizationId: user.organizationId,
          createdAt: thread.createdAt,
          priority: thread.priority,
          slaPolicyId: thread.slaPolicyId,
        }),
      );
    }
    if (Object.keys(threadUpdateData).length > 0) {
      await this.prisma.thread.update({
        where: { id: threadId },
        data: threadUpdateData,
      });
    }

    return message;
  }

  async assign(threadId: string, dto: AssignThreadDto, user: JwtUser) {
    const thread = await this.prisma.thread.findFirst({
      where: { id: threadId, organizationId: user.organizationId },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    return this.prisma.thread.update({
      where: { id: threadId },
      data: {
        ...(dto.userId !== undefined && { assignedUserId: dto.userId }),
        ...(dto.teamId !== undefined && { assignedToTeamId: dto.teamId }),
        status: ThreadStatus.OPEN,
      },
    });
  }

  // ─── Thread Notes ─────────────────────────────────────────────────────────

  private async assertNotePermission(user: JwtUser) {
    // threads:notes permission is required (included for ADMIN, MANAGER, USER per ROLE_PERMISSIONS)
    // At this layer we trust the JWT permissions — guard enforces it at controller level
  }

  async getNotes(threadId: string, user: JwtUser) {
    await this.findOne(threadId, user); // assert thread belongs to org
    return this.prisma.threadNote.findMany({
      where: { threadId, organizationId: user.organizationId },
      include: {
        user: { select: { id: true, fullName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createNote(threadId: string, dto: CreateNoteDto, user: JwtUser) {
    await this.findOne(threadId, user);
    const cleanBody = sanitizeHtml(dto.body, {
      allowedTags: [],
      allowedAttributes: {},
    }).trim();

    if (!cleanBody) {
      throw new BadRequestException('Note body cannot be empty');
    }

    const note = await this.prisma.threadNote.create({
      data: {
        threadId,
        organizationId: user.organizationId,
        userId: user.sub,
        body: cleanBody,
      },
      include: {
        user: {
          select: { id: true, fullName: true, email: true, avatarUrl: true },
        },
      },
    });

    this.eventsGateway.emitToOrganization(
      user.organizationId,
      'thread:note_added',
      {
        threadId,
        note,
      },
    );

    return note;
  }

  async updateNote(
    threadId: string,
    noteId: string,
    dto: UpdateNoteDto,
    user: JwtUser,
  ) {
    await this.findOne(threadId, user);
    const note = await this.prisma.threadNote.findFirst({
      where: { id: noteId, threadId, organizationId: user.organizationId },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (note.userId !== user.sub)
      throw new ForbiddenException("Cannot edit another user's note");

    const cleanBody = sanitizeHtml(dto.body, {
      allowedTags: [],
      allowedAttributes: {},
    }).trim();

    if (!cleanBody) {
      throw new BadRequestException('Note body cannot be empty');
    }

    return this.prisma.threadNote.update({
      where: { id: noteId },
      data: { body: cleanBody },
    });
  }

  async deleteNote(threadId: string, noteId: string, user: JwtUser) {
    await this.findOne(threadId, user);
    const note = await this.prisma.threadNote.findFirst({
      where: { id: noteId, threadId, organizationId: user.organizationId },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (
      note.userId !== user.sub &&
      user.role !== 'ADMIN' &&
      user.role !== 'MANAGER'
    ) {
      throw new ForbiddenException("Cannot delete another user's note");
    }
    await this.prisma.threadNote.delete({ where: { id: noteId } });
    return { message: 'Note deleted' };
  }

  // ─── Thread Tags ──────────────────────────────────────────────────────────

  async addTag(threadId: string, tagId: string, user: JwtUser) {
    await this.findOne(threadId, user);
    // Upsert to avoid duplicates
    return this.prisma.threadTag.upsert({
      where: { threadId_tagId: { threadId, tagId } },
      create: { threadId, tagId },
      update: {},
    });
  }

  async removeTag(threadId: string, tagId: string, user: JwtUser) {
    await this.findOne(threadId, user);
    const record = await this.prisma.threadTag.findUnique({
      where: { threadId_tagId: { threadId, tagId } },
    });
    if (!record) throw new NotFoundException('Tag not attached to thread');
    await this.prisma.threadTag.delete({
      where: { threadId_tagId: { threadId, tagId } },
    });
    return { message: 'Tag removed' };
  }

  // ─── Snooze ───────────────────────────────────────────────────────────────

  async snoozeThread(threadId: string, snoozedUntil: Date, user: JwtUser) {
    const thread = await this.findOne(threadId, user);
    return this.prisma.thread.update({
      where: { id: threadId },
      data: {
        snoozedUntil,
        previousStatus: thread.status,
        status: ThreadStatus.SNOOZED,
      },
    });
  }

  async unsnoozeThread(threadId: string, user: JwtUser) {
    const thread = await this.findOne(threadId, user);
    const restoredStatus =
      (thread.previousStatus as ThreadStatus) ?? ThreadStatus.OPEN;
    return this.prisma.thread.update({
      where: { id: threadId },
      data: {
        snoozedUntil: null,
        previousStatus: null,
        status: restoredStatus,
      },
    });
  }
}
