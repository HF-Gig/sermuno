import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
  Optional,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import * as crypto from 'crypto';
import { ImapFlow } from 'imapflow';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateMailboxDto,
  UpdateMailboxDto,
  CreateMailboxAccessDto,
  CreateFolderDto,
  TestConnectionDto,
} from './dto/mailbox.dto';
import { EMAIL_SYNC_QUEUE } from '../../jobs/queues/email-sync.queue';
import type { EmailSyncJobData } from '../../jobs/processors/email-sync.processor';
import { Prisma, ReadStateMode } from '@prisma/client';
import { EventsGateway } from '../websockets/events.gateway';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { FeatureFlagsService } from '../../config/feature-flags.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

@Injectable()
export class MailboxesService {
  private readonly logger = new Logger(MailboxesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly featureFlags: FeatureFlagsService,
    @InjectQueue(EMAIL_SYNC_QUEUE)
    private readonly emailSyncQueue: Queue<EmailSyncJobData>,
    @Optional() private readonly eventsGateway: EventsGateway | null,
    private readonly auditService: AuditService,
  ) {}

  // ─── Encryption helpers ──────────────────────────────────────────────────

  private getEncryptionKey(): Buffer {
    const key = this.configService.get<string>('encryption.key') ?? '';
    // Key must be exactly 32 bytes for AES-256; derive via SHA-256 if necessary
    return Buffer.from(crypto.createHash('sha256').update(key).digest());
  }

  private encrypt(plaintext: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    // Format: iv(hex):tag(hex):ciphertext(hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(ciphertext: string): string {
    const key = this.getEncryptionKey();
    const [ivHex, tagHex, dataHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !dataHex)
      throw new BadRequestException('Invalid encrypted value');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data).toString('utf8') + decipher.final('utf8');
  }

  private encryptIfPresent(value: string | undefined): string | undefined {
    return value ? this.encrypt(value) : undefined;
  }

  private shouldExcludeProviderSystemFolder(name: string): boolean {
    const raw = String(name || '').trim().toLowerCase();
    const normalized = raw
      .replace(/[\[\]().]/g, ' ')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return (
      normalized === 'gmail' ||
      raw === '[gmail]' ||
      raw === '[gmail]/starred' ||
      raw === '[gmail]/important' ||
      normalized === 'starred' ||
      normalized === 'important' ||
      normalized === 'flagged emails' ||
      normalized.endsWith('/starred') ||
      normalized.endsWith('/important')
    );
  }

  // ─── Mailboxes ────────────────────────────────────────────────────────────

  async findAll(user: JwtUser) {
    return this.prisma.mailbox.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        provider: true,
        syncStatus: true,
        healthStatus: true,
        lastSyncAt: true,
        readStateMode: true,
        imapHost: true,
        imapPort: true,
        imapSecure: true,
        imapUser: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        oauthProvider: true,
        nextRetryAt: true,
        syncErrorCount: true,
        organizationMailAccountId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOne(id: string, user: JwtUser) {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');
    // Never return raw passwords/tokens
    const {
      imapPass: _,
      smtpPass: __,
      googleAccessToken: ___,
      googleRefreshToken: ____,
      oauthAccessToken: _____,
      oauthRefreshToken: ______,
      ...safe
    } = mailbox;
    return safe;
  }

  async getHealth(id: string, user: JwtUser) {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
      select: {
        id: true,
        healthStatus: true,
        syncStatus: true,
        lastSyncAt: true,
        nextRetryAt: true,
        syncErrorCount: true,
      },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');
    return mailbox;
  }

  async getUnreadCount(id: string, user: JwtUser) {
    await this.assertMailboxOwner(id, user);
    const rows = await this.prisma.mailboxFolder.findMany({
      where: { mailboxId: id },
      select: { name: true, unreadCount: true },
    });

    return {
      mailboxId: id,
      unreadCount: rows
        .filter((row) => !this.shouldExcludeProviderSystemFolder(row.name))
        .reduce((sum, row) => sum + Number(row.unreadCount ?? 0), 0),
    };
  }

  async create(dto: CreateMailboxDto, user: JwtUser, meta: RequestMeta = {}) {
    const encImapPass = this.encryptIfPresent(dto.imapPass);
    const encSmtpPass = this.encryptIfPresent(dto.smtpPass);

    const created = await this.prisma.mailbox.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        email: dto.email,
        provider: dto.provider as import('@prisma/client').MailboxProvider,
        imapHost: dto.imapHost,
        imapPort: dto.imapPort,
        imapSecure: dto.imapSecure ?? true,
        imapUser: dto.imapUser,
        imapPass: encImapPass,
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort,
        smtpSecure: dto.smtpSecure ?? true,
        smtpUser: dto.smtpUser,
        smtpPass: encSmtpPass,
        readStateMode: (dto.readStateMode ?? 'personal') as ReadStateMode,
        organizationMailAccountId: dto.organizationMailAccountId,
      },
      select: {
        id: true,
        name: true,
        email: true,
        provider: true,
        syncStatus: true,
        healthStatus: true,
        readStateMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'MAILBOX_CREATED',
      entityType: 'mailbox',
      entityId: created.id,
      previousValue: null,
      newValue: {
        name: created.name,
        email: created.email,
        provider: created.provider,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return created;
  }

  async update(id: string, dto: UpdateMailboxDto, user: JwtUser) {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');

    const encImapPass = this.encryptIfPresent(dto.imapPass);
    const encSmtpPass = this.encryptIfPresent(dto.smtpPass);

    return this.prisma.mailbox.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.imapHost !== undefined && { imapHost: dto.imapHost }),
        ...(dto.imapPort !== undefined && { imapPort: dto.imapPort }),
        ...(dto.imapSecure !== undefined && { imapSecure: dto.imapSecure }),
        ...(dto.imapUser !== undefined && { imapUser: dto.imapUser }),
        ...(encImapPass !== undefined && { imapPass: encImapPass }),
        ...(dto.smtpHost !== undefined && { smtpHost: dto.smtpHost }),
        ...(dto.smtpPort !== undefined && { smtpPort: dto.smtpPort }),
        ...(dto.smtpSecure !== undefined && { smtpSecure: dto.smtpSecure }),
        ...(dto.smtpUser !== undefined && { smtpUser: dto.smtpUser }),
        ...(encSmtpPass !== undefined && { smtpPass: encSmtpPass }),
        ...(dto.readStateMode !== undefined && {
          readStateMode: dto.readStateMode as ReadStateMode,
        }),
        ...(dto.organizationMailAccountId !== undefined && {
          organizationMailAccountId: dto.organizationMailAccountId,
        }),
      },
      select: {
        id: true,
        name: true,
        email: true,
        provider: true,
        syncStatus: true,
        healthStatus: true,
        readStateMode: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async remove(id: string, user: JwtUser, meta: RequestMeta = {}) {
    const userRole = String(user.role || '').toUpperCase();
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      throw new ForbiddenException(
        'Insufficient permissions to delete a mailbox',
      );
    }
    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');
    // Soft-delete cascades: remove all mailboxAccess rows before marking deleted
    await this.prisma.mailboxAccess.deleteMany({ where: { mailboxId: id } });
    await this.prisma.mailbox.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'MAILBOX_DELETED',
      entityType: 'mailbox',
      entityId: id,
      previousValue: {
        name: mailbox.name,
        email: mailbox.email,
        provider: mailbox.provider,
        deletedAt: mailbox.deletedAt,
      },
      newValue: { deletedAt: new Date().toISOString() },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { message: 'Mailbox deleted' };
  }

  async revokeOauth(id: string, user: JwtUser) {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');

    const hasOauthConnection = Boolean(
      mailbox.oauthProvider ||
      mailbox.oauthAccessToken ||
      mailbox.oauthRefreshToken ||
      mailbox.googleAccessToken ||
      mailbox.googleRefreshToken,
    );

    if (!hasOauthConnection) {
      throw new BadRequestException(
        'Mailbox does not have an active OAuth connection',
      );
    }

    const removedSyncJobs = await this.cancelQueuedSyncJobs(id);

    const rulesDisabled = await this.prisma.rule.updateMany({
      where: {
        organizationId: user.organizationId,
        mailboxId: id,
        deletedAt: null,
        isActive: true,
      },
      data: { isActive: false },
    });

    const hooks = await this.prisma.webhook.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      select: { id: true, filterMailboxIds: true },
    });

    let webhooksUpdated = 0;
    for (const hook of hooks) {
      const filterMailboxIds = Array.isArray(hook.filterMailboxIds)
        ? hook.filterMailboxIds.map((value) => String(value))
        : [];
      if (!filterMailboxIds.includes(id)) continue;

      const nextIds = filterMailboxIds.filter((mailboxId) => mailboxId !== id);
      await this.prisma.webhook.update({
        where: { id: hook.id },
        data: {
          filterMailboxIds:
            nextIds as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
      });
      webhooksUpdated += 1;
    }

    await this.prisma.mailbox.update({
      where: { id },
      data: {
        oauthProvider: null,
        oauthAccessToken: null,
        oauthRefreshToken: null,
        oauthTokenExpiresAt: null,
        googleAccessToken: null,
        googleRefreshToken: null,
        googleTokenExpiresAt: null,
        imapPass: null,
        smtpPass: null,
        syncStatus: 'FAILED',
        healthStatus: 'failed',
        nextRetryAt: null,
        syncErrorCount: 0,
        lastSyncError: 'OAuth disconnected',
      },
    });

    const disconnectedAt = new Date().toISOString();

    this.eventsGateway?.emitToOrganization(
      user.organizationId,
      'mailbox:disconnected',
      {
        mailboxId: id,
        organizationId: user.organizationId,
        disconnectedAt,
      },
    );

    await this.auditService?.log({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'MAILBOX_DISCONNECTED',
      entityType: 'mailbox',
      entityId: id,
      previousValue: {
        oauthProvider: mailbox.oauthProvider,
        provider: mailbox.provider,
        email: mailbox.email,
      },
      newValue: {
        oauthProvider: null,
        syncStatus: 'FAILED',
        healthStatus: 'failed',
        lastSyncError: 'OAuth disconnected',
      },
    });

    return {
      message: 'Mailbox OAuth disconnected',
      mailboxId: id,
      removedSyncJobs,
      rulesDisabled: rulesDisabled.count,
      webhooksUpdated,
    };
  }

  async testConnection(dto: TestConnectionDto) {
    const hasSmtp = Boolean(dto.smtpHost);
    const hasImap = Boolean(dto.imapHost);

    if (!hasSmtp && !hasImap) {
      throw new BadRequestException(
        'Provide SMTP or IMAP settings to test connection',
      );
    }

    const checks: string[] = [];

    if (hasSmtp) {
      const smtpHost = String(dto.smtpHost || '').trim();
      const smtpUser = String(dto.smtpUser || '').trim();
      const smtpPass = String(dto.smtpPass || '').trim();
      const smtpPort = Number(dto.smtpPort || 0);

      if (
        !smtpHost ||
        !smtpUser ||
        !smtpPass ||
        !Number.isInteger(smtpPort) ||
        smtpPort < 1 ||
        smtpPort > 65535
      ) {
        throw new BadRequestException(
          'SMTP test requires valid smtpHost, smtpPort, smtpUser, and smtpPass',
        );
      }

      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: Boolean(dto.smtpSecure),
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      });

      try {
        await transporter.verify();
        checks.push('SMTP');
      } catch (error: any) {
        const message = String(error?.message || 'SMTP connection failed');
        throw new BadRequestException(`SMTP test failed: ${message}`);
      }
    }

    if (hasImap) {
      const imapHost = String(dto.imapHost || '').trim();
      const imapUser = String(dto.imapUser || '').trim();
      const imapPass = String(dto.imapPass || '').trim();
      const imapPort = Number(dto.imapPort || 0);

      if (
        !imapHost ||
        !imapUser ||
        !imapPass ||
        !Number.isInteger(imapPort) ||
        imapPort < 1 ||
        imapPort > 65535
      ) {
        throw new BadRequestException(
          'IMAP test requires valid imapHost, imapPort, imapUser, and imapPass',
        );
      }

      const imapClient = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: Boolean(dto.imapSecure),
        auth: {
          user: imapUser,
          pass: imapPass,
        },
        logger: false,
        disableAutoEnable: true,
      });

      try {
        await imapClient.connect();
        checks.push('IMAP');
      } catch (error: any) {
        const message = String(error?.message || 'IMAP connection failed');
        throw new BadRequestException(`IMAP test failed: ${message}`);
      } finally {
        try {
          await imapClient.logout();
        } catch {
          // no-op
        }
      }
    }

    return {
      success: true,
      message: `${checks.join(' + ')} connection test successful`,
    };
  }

  async triggerSync(id: string, user: JwtUser) {
    if (this.featureFlags.get('DISABLE_IMAP_SYNC')) {
      this.logger.warn(
        `[mailboxes] DISABLE_IMAP_SYNC active; blocked sync trigger mailbox=${id} org=${user.organizationId}`,
      );
      throw new ServiceUnavailableException(
        'IMAP sync is temporarily disabled by an emergency kill switch',
      );
    }

    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');

    const streamingMode =
      this.configService.get<boolean>('featureFlags.enableStreamingSync') ??
      false;

    await this.prisma.mailbox.update({
      where: { id },
      data: {
        syncStatus: 'PENDING',
        nextRetryAt: null,
      },
    });

    await this.emailSyncQueue.add(
      'sync',
      { mailboxId: id, organizationId: user.organizationId, streamingMode },
      { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
    );

    return { message: 'Sync job enqueued', mailboxId: id };
  }

  // ─── Mailbox Access ───────────────────────────────────────────────────────

  async getAccess(mailboxId: string, user: JwtUser) {
    await this.assertMailboxOwner(mailboxId, user);
    return this.prisma.mailboxAccess.findMany({
      where: { mailboxId },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        team: { select: { id: true, name: true } },
      },
    });
  }

  async createAccess(
    mailboxId: string,
    dto: CreateMailboxAccessDto,
    user: JwtUser,
  ) {
    await this.assertMailboxOwner(mailboxId, user);

    // XOR constraint: exactly one of userId or teamId must be provided
    const hasUser = dto.userId != null && dto.userId !== '';
    const hasTeam = dto.teamId != null && dto.teamId !== '';
    const userRole = String(user.role || '').toUpperCase();
    if (hasUser === hasTeam) {
      throw new BadRequestException(
        'Exactly one of userId or teamId must be provided (not both, not neither)',
      );
    }

    if (hasTeam && userRole !== 'ADMIN') {
      throw new ForbiddenException(
        'Only admins can link teams to mailbox access',
      );
    }

    try {
      return await this.prisma.mailboxAccess.create({
        data: {
          mailboxId,
          userId: hasUser ? dto.userId : null,
          teamId: hasTeam ? dto.teamId : null,
          canRead: dto.canRead ?? false,
          canSend: dto.canSend ?? false,
          canManage: dto.canManage ?? false,
          canSetImapFlags: dto.canSetImapFlags ?? false,
        },
      });
    } catch (e: any) {
      // Prisma unique constraint violation → 409 Conflict
      if (e?.code === 'P2002') {
        throw new ConflictException(
          'Access record already exists for this mailbox and user/team',
        );
      }
      throw e;
    }
  }

  async revokeAccess(mailboxId: string, accessId: string, user: JwtUser) {
    await this.assertMailboxOwner(mailboxId, user);
    const userRole = String(user.role || '').toUpperCase();
    const record = await this.prisma.mailboxAccess.findFirst({
      where: { id: accessId, mailboxId },
    });
    if (!record) throw new NotFoundException('Access record not found');
    if (record.teamId && userRole !== 'ADMIN') {
      throw new ForbiddenException('Only admins can remove team mailbox links');
    }
    // Hard delete — no soft delete, no audit log per spec
    await this.prisma.mailboxAccess.delete({ where: { id: accessId } });
    return { message: 'Access revoked' };
  }

  /**
   * Compute effective permissions for a user on a mailbox.
   * OR-merges all matching mailbox_access rows (by userId + team memberships).
   */
  async getEffectivePermissions(mailboxId: string, userId: string) {
    const teamMemberships = await this.prisma.teamMember.findMany({
      where: { userId },
      select: { teamId: true },
    });
    const teamIds = teamMemberships.map((m) => m.teamId);

    const rows = await this.prisma.mailboxAccess.findMany({
      where: {
        mailboxId,
        OR: [
          { userId },
          ...(teamIds.length > 0 ? [{ teamId: { in: teamIds } }] : []),
        ],
      },
    });

    return rows.reduce(
      (acc, row) => ({
        canRead: acc.canRead || row.canRead,
        canSend: acc.canSend || row.canSend,
        canManage: acc.canManage || row.canManage,
        canSetImapFlags: acc.canSetImapFlags || row.canSetImapFlags,
      }),
      {
        canRead: false,
        canSend: false,
        canManage: false,
        canSetImapFlags: false,
      },
    );
  }

  // ─── Folders ─────────────────────────────────────────────────────────────

  async getFolders(mailboxId: string, user: JwtUser) {
    await this.assertMailboxOwner(mailboxId, user);
    const rows = await this.prisma.mailboxFolder.findMany({
      where: { mailboxId },
      select: {
        id: true,
        name: true,
        type: true,
        uidValidity: true,
        uidNext: true,
        highestModSeq: true,
        parentId: true,
        messageCount: true,
        unreadCount: true,
        syncStatus: true,
        lastSyncedAt: true,
      },
    });

    return rows
      .filter((row) => !this.shouldExcludeProviderSystemFolder(row.name))
      .map((row) => ({
        ...row,
        uidValidity: row.uidValidity != null ? row.uidValidity.toString() : null,
        uidNext: row.uidNext != null ? row.uidNext.toString() : null,
        highestModSeq:
          row.highestModSeq != null ? row.highestModSeq.toString() : null,
      }));
  }

  async createFolder(mailboxId: string, dto: CreateFolderDto, user: JwtUser) {
    await this.assertMailboxOwner(mailboxId, user);
    const row = await this.prisma.mailboxFolder.create({
      data: { mailboxId, name: dto.name },
      select: {
        id: true,
        name: true,
        type: true,
        uidValidity: true,
        uidNext: true,
        highestModSeq: true,
        parentId: true,
        messageCount: true,
        unreadCount: true,
        syncStatus: true,
      },
    });

    return {
      ...row,
      uidValidity: row.uidValidity != null ? row.uidValidity.toString() : null,
      uidNext: row.uidNext != null ? row.uidNext.toString() : null,
      highestModSeq:
        row.highestModSeq != null ? row.highestModSeq.toString() : null,
    };
  }

  async deleteFolder(mailboxId: string, folderId: string, user: JwtUser) {
    await this.assertMailboxOwner(mailboxId, user);
    const folder = await this.prisma.mailboxFolder.findFirst({
      where: { id: folderId, mailboxId },
    });
    if (!folder) throw new NotFoundException('Folder not found');
    await this.prisma.mailboxFolder.delete({ where: { id: folderId } });
    return { message: 'Folder deleted' };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async assertMailboxOwner(mailboxId: string, user: JwtUser) {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: mailboxId,
        organizationId: user.organizationId,
        deletedAt: null,
      },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');
    return mailbox;
  }

  private async cancelQueuedSyncJobs(mailboxId: string): Promise<number> {
    const jobs = await this.emailSyncQueue.getJobs([
      'waiting',
      'delayed',
      'prioritized',
      'paused',
      'waiting-children',
    ]);
    let removed = 0;

    for (const job of jobs) {
      const jobMailboxId = String(
        (job.data as { mailboxId?: string } | null)?.mailboxId || '',
      );
      if (jobMailboxId !== mailboxId) continue;

      await job.remove();
      removed += 1;
    }

    return removed;
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
        `Failed to write mailbox audit log for ${input.action}: ${(error as Error).message}`,
      );
    }
  }
}
