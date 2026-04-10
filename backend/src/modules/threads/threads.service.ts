import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
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
  ForwardThreadDto,
  AssignThreadDto,
  CreateNoteDto,
  UpdateNoteDto,
  NoteMentionSuggestionsQueryDto,
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
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { CrmService } from '../crm/crm.service';

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

const THREAD_NOTE_WITH_MENTIONS_INCLUDE = {
  user: {
    select: { id: true, fullName: true, email: true, avatarUrl: true },
  },
  mentions: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      mentionedUser: {
        select: { id: true, fullName: true, email: true, avatarUrl: true },
      },
    },
  },
} satisfies Prisma.ThreadNoteInclude;

type ThreadNoteWithMentions = Prisma.ThreadNoteGetPayload<{
  include: typeof THREAD_NOTE_WITH_MENTIONS_INCLUDE;
}>;

type MentionedUserSummary = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  mentionKey: string;
};

type MappedThreadNote = {
  id: string;
  organizationId: string;
  threadId: string;
  userId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    fullName: string;
    email: string;
    avatarUrl: string | null;
  };
  mentionedUsers: MentionedUserSummary[];
};

@Injectable()
export class ThreadsService {
  private readonly logger = new Logger(ThreadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly eventsGateway: EventsGateway,
    private readonly slaService: SlaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly crmService: CrmService,
  ) {}

  private async getUserTeamIds(userId: string): Promise<string[]> {
    const teamRows = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });

    return Array.from(new Set(teamRows.map((row) => row.teamId)));
  }

  private buildMailboxReadAccessWhere(userId: string, teamIds: string[]) {
    return {
      canRead: true,
      OR: [
        { userId },
        ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
      ],
    } satisfies Prisma.MailboxAccessWhereInput;
  }

  private buildReadableMailboxWhere(userId: string, teamIds: string[]) {
    return {
      deletedAt: null,
      OR: [
        { mailboxAccess: { none: {} } },
        {
          mailboxAccess: {
            some: this.buildMailboxReadAccessWhere(userId, teamIds),
          },
        },
      ],
    } satisfies Prisma.MailboxWhereInput;
  }

  private async buildReadableThreadWhere(
    user: JwtUser,
    extra: Prisma.ThreadWhereInput = {},
    providedTeamIds?: string[],
  ): Promise<Prisma.ThreadWhereInput> {
    const teamIds = providedTeamIds ?? (await this.getUserTeamIds(user.sub));

    return {
      organizationId: user.organizationId,
      ...extra,
      mailbox: this.buildReadableMailboxWhere(user.sub, teamIds),
    };
  }

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

  private normalizeForwardSubject(subject?: string | null): string {
    const clean = String(subject || '').trim();
    if (!clean) return 'Fwd: (no subject)';
    return /^(fwd?:|fw:)/i.test(clean) ? clean : `Fwd: ${clean}`;
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
    if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
      this.logger.warn(
        `[threads] DISABLE_SMTP_SEND active; blocked provider send thread=${params.threadId} mailbox=${params.mailbox.id}`,
      );
      throw new ServiceUnavailableException(
        'Email sending is temporarily disabled by an emergency kill switch',
      );
    }

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
    const teamIds = await this.getUserTeamIds(user.sub);

    const where = await this.buildReadableThreadWhere(
      user,
      {
        ...(query.mailboxId && { mailboxId: query.mailboxId }),
        ...(query.status && { status: query.status as ThreadStatus }),
        ...(query.priority && { priority: query.priority as ThreadPriority }),
        ...(query.assignedUserId && { assignedUserId: query.assignedUserId }),
        ...(query.mentioned && {
          notes: {
            some: {
              mentions: {
                some: { mentionedUserId: user.sub },
              },
            },
          },
        }),
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
      },
      teamIds,
    );

    const assigned = String(query.assigned || '').toLowerCase();
    if (assigned === 'me') {
      where.assignedUserId = user.sub;
    } else if (assigned === 'unassigned') {
      where.assignedUserId = null;
      where.assignedToTeamId = null;
    } else if (assigned === 'team') {
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
    const teamIds = await this.getUserTeamIds(user.sub);
    const baseWhere = await this.buildReadableThreadWhere(
      user,
      {
        ...(query.mailboxId && { mailboxId: query.mailboxId }),
      },
      teamIds,
    );

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
      this.prisma.thread.count({
        where: {
          ...baseWhere,
          notes: {
            some: {
              mentions: {
                some: { mentionedUserId: user.sub },
              },
            },
          },
        },
      }),
    ]);

    let tagCounts: Record<string, number> = {};

    if (includeTagCounts) {
      const groupedTags = await this.prisma.threadTag.groupBy({
        by: ['tagId'],
        where: {
          thread: {
            ...(await this.buildReadableThreadWhere(
              user,
              {
                ...(query.mailboxId ? { mailboxId: query.mailboxId } : {}),
              },
              teamIds,
            )),
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
        mentioned: counts[11],
      },
      mailbox: {
        starred: counts[9],
        archive: counts[10],
      },
      tags: tagCounts,
    };
  }

  async findOne(id: string, user: JwtUser) {
    const where = await this.buildReadableThreadWhere(user, { id });
    const thread = await this.prisma.thread.findFirst({
      where,
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

  async bulkUpdate(
    dto: BulkUpdateThreadsDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const accessibleThreads =
      (await this.prisma.thread.findMany({
        where: await this.buildReadableThreadWhere(user, {
          id: { in: dto.ids },
        }),
        select: { id: true, status: true },
      })) ?? [];
    const accessibleThreadIds = accessibleThreads.map((thread) => thread.id);

    if (accessibleThreadIds.length === 0) {
      return { updated: 0 };
    }

    const previousStatusByThread = new Map<string, ThreadStatus>();
    accessibleThreads.forEach((thread) => {
      const currentStatus = (thread as { status?: ThreadStatus }).status;
      if (currentStatus) {
        previousStatusByThread.set(thread.id, currentStatus);
      }
    });

    await this.prisma.thread.updateMany({
      where: {
        id: { in: accessibleThreadIds },
        organizationId: user.organizationId,
      },
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
    if (dto.status) {
      await Promise.all(
        accessibleThreadIds.map((threadId) =>
          this.logAuditSafe({
            organizationId: user.organizationId,
            userId: user.sub,
            action: 'STATUS_CHANGE',
            entityType: 'thread',
            entityId: threadId,
            previousValue: { status: previousStatusByThread.get(threadId) },
            newValue: { status: dto.status },
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          }),
        ),
      );
    }

    if (
      dto.status !== undefined ||
      dto.assignedUserId !== undefined ||
      dto.assignedToTeamId !== undefined
    ) {
      const updatedThreads = await this.prisma.thread.findMany({
        where: {
          id: { in: accessibleThreadIds },
          organizationId: user.organizationId,
          contactId: { not: null },
        },
        select: { id: true, mailboxId: true, contactId: true },
      });
      await Promise.all(
        updatedThreads.map((thread) =>
          this.crmService.emitContactActivity({
            organizationId: user.organizationId,
            contactId: thread.contactId as string,
            activity: 'thread_updated',
            actorUserId: user.sub,
            threadId: thread.id,
            mailboxId: thread.mailboxId,
          }),
        ),
      );
    }

    return { updated: dto.ids.length };
  }

  async update(
    id: string,
    dto: UpdateThreadDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const thread = await this.findOne(id, user);

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
              ? (rawSlaPolicyId ?? null)
              : (thread.slaPolicyId ?? null),
        }),
      );
    }

    const updated = await this.prisma.thread.update({
      where: { id },
      data,
    });

    if (updated.status !== thread.status) {
      await this.logAuditSafe({
        organizationId: user.organizationId,
        userId: user.sub,
        action: 'STATUS_CHANGE',
        entityType: 'thread',
        entityId: updated.id,
        previousValue: {
          status: thread.status,
        },
        newValue: {
          status: updated.status,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }

    void this.eventsGateway.emitToMailbox(updated.mailboxId, 'thread:updated', {
      threadId: updated.id,
      mailboxId: updated.mailboxId,
      type: 'status_changed',
    });

    if (thread.contact?.id) {
      await this.crmService.emitContactActivity({
        organizationId: user.organizationId,
        contactId: thread.contact.id,
        activity: 'thread_updated',
        actorUserId: user.sub,
        threadId: updated.id,
        mailboxId: updated.mailboxId,
      });
    }

    return updated;
  }

  async star(threadId: string, starred: boolean, user: JwtUser) {
    const thread = await this.findOne(threadId, user);
    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: { starred },
    });

    void this.eventsGateway.emitToMailbox(updated.mailboxId, 'thread:updated', {
      threadId: updated.id,
      mailboxId: updated.mailboxId,
      type: 'status_changed',
    });

    if (thread.contact?.id) {
      await this.crmService.emitContactActivity({
        organizationId: user.organizationId,
        contactId: thread.contact.id,
        activity: 'thread_updated',
        actorUserId: user.sub,
        threadId: updated.id,
        mailboxId: updated.mailboxId,
      });
    }

    return updated;
  }

  async archive(
    threadId: string,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const thread = await this.findOne(threadId, user);
    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: {
        previousStatus: thread.status,
        status: ThreadStatus.ARCHIVED,
        archivedAt: new Date(),
      },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'STATUS_CHANGE',
      entityType: 'thread',
      entityId: updated.id,
      previousValue: { status: thread.status },
      newValue: { status: updated.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    void this.eventsGateway.emitToMailbox(updated.mailboxId, 'thread:updated', {
      threadId: updated.id,
      mailboxId: updated.mailboxId,
      type: 'status_changed',
    });

    if (thread.contact?.id) {
      await this.crmService.emitContactActivity({
        organizationId: user.organizationId,
        contactId: thread.contact.id,
        activity: 'thread_updated',
        actorUserId: user.sub,
        threadId: updated.id,
        mailboxId: updated.mailboxId,
      });
    }

    return updated;
  }

  async unarchive(
    threadId: string,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
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

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'STATUS_CHANGE',
      entityType: 'thread',
      entityId: updated.id,
      previousValue: { status: thread.status },
      newValue: { status: updated.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    void this.eventsGateway.emitToMailbox(updated.mailboxId, 'thread:updated', {
      threadId: updated.id,
      mailboxId: updated.mailboxId,
      type: 'status_changed',
    });

    return updated;
  }

  async compose(dto: ComposeThreadDto, user: JwtUser) {
    const to = this.sanitizeEmails(dto.to);
    const cc = this.sanitizeEmails(dto.cc);
    const bcc = this.sanitizeEmails(dto.bcc);

    let contactId: string | null = null;
    let companyId: string | null = null;
    const recipientEmail = this.extractFirstEmail(to);
    if (recipientEmail) {
      const linkedContact = await this.prisma.contact.findFirst({
        where: {
          organizationId: user.organizationId,
          deletedAt: null,
          OR: [
            { email: recipientEmail },
            { additionalEmails: { array_contains: [recipientEmail] } },
          ],
        },
        select: {
          id: true,
          companyId: true,
        },
      });

      if (linkedContact) {
        contactId = linkedContact.id;
        companyId = linkedContact.companyId ?? null;
      } else {
        const autoLinked = await this.crmService
          .autoCreateContactIfEnabled(recipientEmail, undefined, user.organizationId)
          .catch(() => ({ contactId: null, companyId: null }));
        contactId = autoLinked.contactId;
        companyId = autoLinked.companyId;
      }
    }

    // Create a new thread + first outbound message
    const thread = await this.prisma.thread.create({
      data: {
        mailboxId: dto.mailboxId,
        organizationId: user.organizationId,
        subject: dto.subject,
        status: ThreadStatus.OPEN,
        ...(contactId ? { contactId } : {}),
        ...(companyId ? { companyId } : {}),
      },
    });

    const message = await this.prisma.message.create({
      data: {
        threadId: thread.id,
        mailboxId: dto.mailboxId,
        direction: MessageDirection.OUTBOUND,
        fromEmail: user.email,
        to: to as unknown as import('@prisma/client').Prisma.InputJsonValue,
        cc: cc as unknown as import('@prisma/client').Prisma.InputJsonValue,
        bcc: bcc as unknown as import('@prisma/client').Prisma.InputJsonValue,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml,
        bodyText: dto.bodyText,
        isOutbound: true,
        isDraft: false,
      },
    });

    if (contactId) {
      await this.crmService.emitContactActivity({
        organizationId: user.organizationId,
        contactId,
        activity: 'email_sent',
        actorUserId: user.sub,
        threadId: thread.id,
        mailboxId: dto.mailboxId,
        messageId: message.id,
      });
    }

    return { thread, message };
  }

  async reply(
    threadId: string,
    dto: ReplyThreadDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const where = await this.buildReadableThreadWhere(user, { id: threadId });
    const thread = await this.prisma.thread.findFirst({
      where,
      select: {
        id: true,
        subject: true,
        mailboxId: true,
        assignedUserId: true,
        createdAt: true,
        priority: true,
        slaPolicyId: true,
        firstResponseAt: true,
        contact: { select: { id: true, email: true } },
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

    if (thread.assignedUserId && thread.assignedUserId !== user.sub) {
      await this.notificationsService
        .dispatch({
          userId: thread.assignedUserId,
          organizationId: user.organizationId,
          type: 'thread_reply',
          title: 'A reply was sent on an assigned thread',
          message: `${user.email} replied to "${thread.subject || 'a thread'}"`,
          resourceId: thread.id,
          data: {
            threadId: thread.id,
            mailboxId: thread.mailboxId,
            assignedToUserId: thread.assignedUserId,
            repliedByUserId: user.sub,
          },
        })
        .catch((error) => {
          this.logger.error(
            `[threads] Failed to dispatch thread_reply notification thread=${thread.id} user=${thread.assignedUserId}`,
            error instanceof Error ? error.stack : undefined,
          );
        });
    }

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'REPLY_SENT',
      entityType: 'thread',
      entityId: thread.id,
      previousValue: null,
      newValue: {
        messageId: message.id,
        to,
        cc,
        bcc,
        subject: message.subject,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    if (thread.contact?.id) {
      await this.crmService.emitContactActivity({
        organizationId: user.organizationId,
        contactId: thread.contact.id,
        activity: 'email_sent',
        actorUserId: user.sub,
        threadId: thread.id,
        mailboxId: thread.mailboxId,
        messageId: message.id,
      });
    }

    return message;
  }

  async forward(
    threadId: string,
    dto: ForwardThreadDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const where = await this.buildReadableThreadWhere(user, { id: threadId });
    const thread = await this.prisma.thread.findFirst({
      where,
      select: {
        id: true,
        subject: true,
        mailboxId: true,
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

    const latestMessage = await this.prisma.message.findFirst({
      where: { threadId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        subject: true,
        bodyText: true,
        bodyHtml: true,
      },
    });

    const to = this.sanitizeEmails(dto.to);
    const cc = this.sanitizeEmails(dto.cc);
    const bcc = this.sanitizeEmails(dto.bcc);
    if (!to.length) {
      throw new BadRequestException(
        'No valid recipient found for this forward.',
      );
    }

    const subject = this.normalizeForwardSubject(
      dto.subject || thread.subject || latestMessage?.subject,
    );
    const bodyHtml = dto.bodyHtml || undefined;
    const fallbackBodyText = latestMessage?.bodyText
      ? `---------- Forwarded message ----------\n${latestMessage.bodyText}`
      : undefined;
    const bodyText =
      dto.bodyText ||
      (dto.bodyHtml
        ? dto.bodyHtml
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : fallbackBodyText);

    const sendResult = await this.sendReplyThroughProvider({
      mailbox: thread.mailbox,
      actor: user,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
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
        subject,
        bodyHtml,
        bodyText: bodyText || undefined,
        messageId: sendResult.providerMessageId,
        isOutbound: true,
        isDraft: false,
      },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'FORWARD_SENT',
      entityType: 'thread',
      entityId: thread.id,
      previousValue: null,
      newValue: {
        messageId: message.id,
        to,
        cc,
        bcc,
        subject: message.subject,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return message;
  }

  async assign(
    threadId: string,
    dto: AssignThreadDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const where = await this.buildReadableThreadWhere(user, { id: threadId });
    const thread = await this.prisma.thread.findFirst({
      where,
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const assignData =
      dto.userId !== undefined
        ? {
            assignedUserId: dto.userId || null,
            assignedToTeamId: null,
          }
        : dto.teamId !== undefined
          ? {
              assignedToTeamId: dto.teamId || null,
              assignedUserId: null,
            }
          : {
              assignedUserId: null,
              assignedToTeamId: null,
            };

    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: {
        ...assignData,
        status: ThreadStatus.OPEN,
      },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'ASSIGN',
      entityType: 'thread',
      entityId: updated.id,
      previousValue: {
        assignedUserId: thread.assignedUserId,
        assignedToTeamId: thread.assignedToTeamId,
      },
      newValue: {
        assignedUserId: updated.assignedUserId,
        assignedToTeamId: updated.assignedToTeamId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    void this.eventsGateway.emitToMailbox(updated.mailboxId, 'thread:assigned', {
      threadId: updated.id,
      mailboxId: updated.mailboxId,
      assignedUserId: updated.assignedUserId ?? null,
      assignedToTeamId: updated.assignedToTeamId ?? null,
    });

    const hasNewUserAssignment =
      dto.userId !== undefined &&
      !!updated.assignedUserId &&
      updated.assignedUserId !== thread.assignedUserId;

    if (hasNewUserAssignment) {
      try {
        await this.notificationsService.dispatch({
          userId: updated.assignedUserId!,
          organizationId: user.organizationId,
          type: 'thread_assigned',
          title: 'Thread assigned to you',
          message: `${user.email} assigned "${updated.subject || 'a thread'}" to you`,
          resourceId: updated.id,
          data: {
            threadId: updated.id,
            assignedByUserId: user.sub,
            assignedUserId: updated.assignedUserId,
            mailboxId: updated.mailboxId,
          },
        });
      } catch (error) {
        this.logger.error(
          `[threads] Failed to dispatch thread_assigned notification thread=${updated.id} user=${updated.assignedUserId}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    return updated;
  }

  // ─── Thread Notes ─────────────────────────────────────────────────────────

  private async assertNotePermission(user: JwtUser) {
    void user;
    // threads:notes permission is required (included for ADMIN, MANAGER, USER per ROLE_PERMISSIONS)
    // At this layer we trust the JWT permissions — guard enforces it at controller level
  }

  async getNotes(threadId: string, user: JwtUser) {
    await this.findOne(threadId, user);
    const notes = await this.prisma.threadNote.findMany({
      where: { threadId, organizationId: user.organizationId },
      include: THREAD_NOTE_WITH_MENTIONS_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return notes.map((note) => this.mapThreadNote(note));
  }

  async getNoteMentionSuggestions(
    threadId: string,
    query: NoteMentionSuggestionsQueryDto,
    user: JwtUser,
  ) {
    const thread = await this.findOne(threadId, user);
    const normalizedQuery = String(query.query || '')
      .trim()
      .toLowerCase();
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);
    const mentionableUsers = await this.getMentionableUsers(
      user.organizationId,
      thread.mailboxId,
    );

    return mentionableUsers
      .filter((mentionedUser) => mentionedUser.id !== user.sub)
      .filter((mentionedUser) => {
        if (!normalizedQuery) return true;

        const aliases = this.getMentionKeysForUser(mentionedUser);
        return (
          aliases.some((alias) => alias.includes(normalizedQuery)) ||
          mentionedUser.fullName.toLowerCase().includes(normalizedQuery) ||
          mentionedUser.email.toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((left, right) => {
        const leftAliases = this.getMentionKeysForUser(left);
        const rightAliases = this.getMentionKeysForUser(right);
        const leftStarts =
          leftAliases.some((alias) => alias.startsWith(normalizedQuery)) ||
          left.fullName.toLowerCase().startsWith(normalizedQuery);
        const rightStarts =
          rightAliases.some((alias) => alias.startsWith(normalizedQuery)) ||
          right.fullName.toLowerCase().startsWith(normalizedQuery);

        if (leftStarts !== rightStarts) {
          return leftStarts ? -1 : 1;
        }

        return left.fullName.localeCompare(right.fullName);
      })
      .slice(0, limit);
  }

  async createNote(
    threadId: string,
    dto: CreateNoteDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const thread = await this.findOne(threadId, user);
    const cleanBody = this.sanitizeNoteBody(dto.body);
    const resolvedMentions = await this.resolveMentionedUsers(
      user.organizationId,
      thread.mailboxId,
      cleanBody,
    );

    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.threadNote.create({
        data: {
          threadId,
          organizationId: user.organizationId,
          userId: user.sub,
          body: cleanBody,
        },
        select: { id: true },
      });

      if (resolvedMentions.length > 0) {
        await tx.threadNoteMention.createMany({
          data: resolvedMentions.map((mentionedUser) => ({
            organizationId: user.organizationId,
            noteId: created.id,
            mentionedUserId: mentionedUser.id,
            mentionKey: mentionedUser.mentionKey,
          })),
          skipDuplicates: true,
        });
      }

      return tx.threadNote.findFirstOrThrow({
        where: { id: created.id, organizationId: user.organizationId },
        include: THREAD_NOTE_WITH_MENTIONS_INCLUDE,
      });
    });

    const mappedNote = this.mapThreadNote(note);
    try {
      await this.dispatchMentionNotifications({
        threadId,
        threadSubject: thread.subject,
        note: mappedNote,
        authorUserId: user.sub,
        mentionedUsers: mappedNote.mentionedUsers,
      });
    } catch (error) {
      this.logger.error(
        `[thread-notes] Failed mention dispatch thread=${threadId} note=${mappedNote.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    void this.eventsGateway.emitToMailbox(thread.mailboxId, 'thread:note_added', {
      threadId,
      note: mappedNote,
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'NOTE_ADD',
      entityType: 'thread',
      entityId: threadId,
      previousValue: null,
      newValue: {
        noteId: mappedNote.id,
        body: mappedNote.body,
        mentionedUserIds: mappedNote.mentionedUsers.map(
          (mentionedUser) => mentionedUser.id,
        ),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return mappedNote;
  }

  async updateNote(
    threadId: string,
    noteId: string,
    dto: UpdateNoteDto,
    user: JwtUser,
  ) {
    const thread = await this.findOne(threadId, user);
    const note = await this.prisma.threadNote.findFirst({
      where: { id: noteId, threadId, organizationId: user.organizationId },
      include: {
        mentions: {
          include: {
            mentionedUser: {
              select: {
                id: true,
                fullName: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (note.userId !== user.sub)
      throw new ForbiddenException("Cannot edit another user's note");

    const cleanBody = this.sanitizeNoteBody(dto.body);
    const resolvedMentions = await this.resolveMentionedUsers(
      user.organizationId,
      thread.mailboxId,
      cleanBody,
    );
    const existingMentionedUserIds = new Set(
      note.mentions.map((mention) => mention.mentionedUserId),
    );
    const newlyAddedMentions = resolvedMentions.filter(
      (mentionedUser) => !existingMentionedUserIds.has(mentionedUser.id),
    );

    const updatedNote = await this.prisma.$transaction(async (tx) => {
      await tx.threadNote.update({
        where: { id: noteId },
        data: { body: cleanBody },
      });
      await tx.threadNoteMention.deleteMany({ where: { noteId } });

      if (resolvedMentions.length > 0) {
        await tx.threadNoteMention.createMany({
          data: resolvedMentions.map((mentionedUser) => ({
            organizationId: user.organizationId,
            noteId,
            mentionedUserId: mentionedUser.id,
            mentionKey: mentionedUser.mentionKey,
          })),
          skipDuplicates: true,
        });
      }

      return tx.threadNote.findFirstOrThrow({
        where: { id: noteId, threadId, organizationId: user.organizationId },
        include: THREAD_NOTE_WITH_MENTIONS_INCLUDE,
      });
    });

    const mappedNote = this.mapThreadNote(updatedNote);
    try {
      await this.dispatchMentionNotifications({
        threadId,
        threadSubject: thread.subject,
        note: mappedNote,
        authorUserId: user.sub,
        mentionedUsers: newlyAddedMentions,
      });
    } catch (error) {
      this.logger.error(
        `[thread-notes] Failed mention dispatch thread=${threadId} note=${mappedNote.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    return mappedNote;
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

  private sanitizeNoteBody(body: string) {
    const cleanBody = sanitizeHtml(body, {
      allowedTags: [],
      allowedAttributes: {},
    }).trim();

    if (!cleanBody) {
      throw new BadRequestException('Note body cannot be empty');
    }

    return cleanBody;
  }

  private extractMentionKeys(body: string) {
    const keys = new Set<string>();
    const matcher = /(^|[^A-Za-z0-9._+@-])@([A-Za-z0-9._+-]{1,64})\b/g;
    let match: RegExpExecArray | null = matcher.exec(body);

    while (match) {
      keys.add(match[2].toLowerCase());
      match = matcher.exec(body);
    }

    return [...keys];
  }

  private normalizeMentionToken(value: string) {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._+-]+/g, ' ')
      .trim();

    if (!normalized) {
      return '';
    }

    return normalized
      .split(/\s+/)
      .filter(Boolean)
      .join('.')
      .replace(/[._+-]{2,}/g, '.')
      .replace(/^[._+-]+|[._+-]+$/g, '')
      .slice(0, 64);
  }

  private toEmailMentionKey(email: string) {
    return this.normalizeMentionToken(email.trim().toLowerCase().split('@')[0] || '');
  }

  private toMentionKey(fullName: string, email: string) {
    const nameMentionKey = this.normalizeMentionToken(fullName);
    if (nameMentionKey) {
      return nameMentionKey;
    }

    return this.toEmailMentionKey(email);
  }

  private composeMentionKey(base: string, suffix: string) {
    return `${base}.${suffix}`
      .toLowerCase()
      .replace(/[^a-z0-9._+-]+/g, '.')
      .replace(/[._+-]{2,}/g, '.')
      .replace(/^[._+-]+|[._+-]+$/g, '')
      .slice(0, 64);
  }

  private getMentionKeysForUser(mentionedUser: MentionedUserSummary) {
    return Array.from(
      new Set([
        mentionedUser.mentionKey,
        this.toEmailMentionKey(mentionedUser.email),
      ].filter(Boolean)),
    );
  }

  private async getMentionableUsers(
    organizationId: string,
    mailboxId: string,
  ): Promise<MentionedUserSummary[]> {
    const mailboxAccessRows =
      (await this.prisma.mailboxAccess.findMany({
        where: { mailboxId, canRead: true },
        select: { userId: true, teamId: true },
      })) ?? [];

    let readableUserIds: string[] | null = null;
    if (mailboxAccessRows.length > 0) {
      const directUserIds = mailboxAccessRows
        .map((row) => row.userId)
        .filter((userId): userId is string => Boolean(userId));
      const teamIds = mailboxAccessRows
        .map((row) => row.teamId)
        .filter((teamId): teamId is string => Boolean(teamId));
      const teamMembers =
        teamIds.length > 0
          ? await this.prisma.teamMember.findMany({
              where: { teamId: { in: teamIds } },
              select: { userId: true },
            })
          : [];

      readableUserIds = Array.from(
        new Set([
          ...directUserIds,
          ...teamMembers.map((membership) => membership.userId),
        ]),
      );

      if (readableUserIds.length === 0) {
        return [];
      }
    }

    const users = await this.prisma.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        isActive: true,
        ...(readableUserIds ? { id: { in: readableUserIds } } : {}),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        avatarUrl: true,
      },
    });

    const usersByBaseKey = new Map<
      string,
      Array<{
        id: string;
        fullName: string;
        email: string;
        avatarUrl: string | null;
        baseMentionKey: string;
        emailMentionKey: string;
      }>
    >();

    users.forEach((candidate) => {
      const emailMentionKey = this.toEmailMentionKey(candidate.email);
      const baseMentionKey = this.toMentionKey(candidate.fullName, candidate.email);
      if (!baseMentionKey && !emailMentionKey) {
        return;
      }

      const groupingKey = baseMentionKey || emailMentionKey;
      const group = usersByBaseKey.get(groupingKey) ?? [];
      group.push({
        id: candidate.id,
        fullName: candidate.fullName,
        email: candidate.email,
        avatarUrl: candidate.avatarUrl,
        baseMentionKey,
        emailMentionKey,
      });
      usersByBaseKey.set(groupingKey, group);
    });

    const mentionableUsers: MentionedUserSummary[] = [];
    usersByBaseKey.forEach((group, groupingKey) => {
      if (group.length === 1) {
        const candidate = group[0];
        mentionableUsers.push({
          id: candidate.id,
          fullName: candidate.fullName,
          email: candidate.email,
          avatarUrl: candidate.avatarUrl,
          mentionKey: candidate.baseMentionKey || candidate.emailMentionKey,
        });
        return;
      }

      const fallbackByKey = new Map<string, typeof group[number]>();
      const ambiguousFallback = new Set<string>();
      group.forEach((candidate) => {
        const fallbackKey = this.composeMentionKey(
          candidate.baseMentionKey || groupingKey,
          candidate.emailMentionKey,
        );
        if (!fallbackKey || ambiguousFallback.has(fallbackKey)) {
          return;
        }

        const existing = fallbackByKey.get(fallbackKey);
        if (existing && existing.id !== candidate.id) {
          fallbackByKey.delete(fallbackKey);
          ambiguousFallback.add(fallbackKey);
          return;
        }

        if (!existing) {
          fallbackByKey.set(fallbackKey, candidate);
        }
      });

      fallbackByKey.forEach((candidate, mentionKey) => {
        mentionableUsers.push({
          id: candidate.id,
          fullName: candidate.fullName,
          email: candidate.email,
          avatarUrl: candidate.avatarUrl,
          mentionKey,
        });
      });
    });

    return mentionableUsers.sort((left, right) =>
      left.fullName.localeCompare(right.fullName),
    );
  }

  private async resolveMentionedUsers(
    organizationId: string,
    mailboxId: string,
    body: string,
  ): Promise<MentionedUserSummary[]> {
    const mentionKeys = this.extractMentionKeys(body);
    if (mentionKeys.length === 0) {
      return [];
    }

    const mentionableUsers = await this.getMentionableUsers(
      organizationId,
      mailboxId,
    );
    const uniqueMatches = new Map<string, MentionedUserSummary>();
    const ambiguousKeys = new Set<string>();

    mentionableUsers.forEach((mentionedUser) => {
      this.getMentionKeysForUser(mentionedUser).forEach((mentionKey) => {
        if (ambiguousKeys.has(mentionKey)) {
          return;
        }

        const existing = uniqueMatches.get(mentionKey);
        if (existing && existing.id !== mentionedUser.id) {
          uniqueMatches.delete(mentionKey);
          ambiguousKeys.add(mentionKey);
          return;
        }

        if (!existing) {
          uniqueMatches.set(mentionKey, mentionedUser);
        }
      });
    });

    return mentionKeys
      .map((mentionKey) => uniqueMatches.get(mentionKey))
      .filter((mentionedUser): mentionedUser is MentionedUserSummary =>
        Boolean(mentionedUser),
      );
  }

  private mapThreadNote(note: ThreadNoteWithMentions): MappedThreadNote {
    return {
      id: note.id,
      organizationId: note.organizationId,
      threadId: note.threadId,
      userId: note.userId,
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      user: note.user,
      mentionedUsers: note.mentions.map((mention) => ({
        id: mention.mentionedUser.id,
        fullName: mention.mentionedUser.fullName,
        email: mention.mentionedUser.email,
        avatarUrl: mention.mentionedUser.avatarUrl,
        mentionKey: mention.mentionKey,
      })),
    };
  }

  private async dispatchMentionNotifications(params: {
    threadId: string;
    threadSubject: string | null;
    note: MappedThreadNote;
    authorUserId: string;
    mentionedUsers: MentionedUserSummary[];
  }) {
    const recipients = params.mentionedUsers.filter(
      (mentionedUser) => mentionedUser.id !== params.authorUserId,
    );

    await Promise.all(
      recipients.map((mentionedUser) =>
        this.notificationsService.dispatch({
          userId: mentionedUser.id,
          organizationId: params.note.organizationId,
          type: 'mention',
          title: 'You were mentioned in a note',
          message: `${params.note.user.fullName} mentioned you on ${params.threadSubject || 'a thread'}`,
          resourceId: params.threadId,
          data: {
            threadId: params.threadId,
            noteId: params.note.id,
            authorUserId: params.note.user.id,
            authorName: params.note.user.fullName,
            mentionKey: mentionedUser.mentionKey,
          },
        }),
      ),
    );
  }

  // ─── Thread Tags ──────────────────────────────────────────────────────────

  async addTag(
    threadId: string,
    tagId: string,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    await this.findOne(threadId, user);
    // Upsert to avoid duplicates
    const record = await this.prisma.threadTag.upsert({
      where: { threadId_tagId: { threadId, tagId } },
      create: { threadId, tagId },
      update: {},
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'TAG_ADD',
      entityType: 'thread',
      entityId: threadId,
      previousValue: null,
      newValue: { tagId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return record;
  }

  async removeTag(
    threadId: string,
    tagId: string,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    await this.findOne(threadId, user);
    const record = await this.prisma.threadTag.findUnique({
      where: { threadId_tagId: { threadId, tagId } },
    });
    if (!record) throw new NotFoundException('Tag not attached to thread');
    await this.prisma.threadTag.delete({
      where: { threadId_tagId: { threadId, tagId } },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'TAG_REMOVE',
      entityType: 'thread',
      entityId: threadId,
      previousValue: { tagId },
      newValue: null,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { message: 'Tag removed' };
  }

  // ─── Snooze ───────────────────────────────────────────────────────────────

  async snoozeThread(
    threadId: string,
    snoozedUntil: Date,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const thread = await this.findOne(threadId, user);
    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: {
        snoozedUntil,
        previousStatus: thread.status,
        status: ThreadStatus.SNOOZED,
      },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'STATUS_CHANGE',
      entityType: 'thread',
      entityId: updated.id,
      previousValue: { status: thread.status },
      newValue: { status: updated.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  }

  async unsnoozeThread(
    threadId: string,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const thread = await this.findOne(threadId, user);
    const restoredStatus =
      (thread.previousStatus as ThreadStatus) ?? ThreadStatus.OPEN;
    const updated = await this.prisma.thread.update({
      where: { id: threadId },
      data: {
        snoozedUntil: null,
        previousStatus: null,
        status: restoredStatus,
      },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'STATUS_CHANGE',
      entityType: 'thread',
      entityId: updated.id,
      previousValue: { status: thread.status },
      newValue: { status: updated.status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  }

  private async logAuditSafe(input: {
    organizationId: string;
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    previousValue?: Prisma.InputJsonValue | null;
    newValue?: Prisma.InputJsonValue | null;
    ipAddress?: string;
    userAgent?: string;
  }) {
    const { previousValue, newValue, ...baseAudit } = input;
    try {
      await this.auditService.log({
        ...baseAudit,
        ...(previousValue !== undefined &&
          previousValue !== null && { previousValue }),
        ...(newValue !== undefined && newValue !== null && { newValue }),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write thread audit log for ${input.action}: ${(error as Error).message}`,
      );
    }
  }
}
