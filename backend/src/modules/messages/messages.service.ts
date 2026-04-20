import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as path from 'path';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { readFile } from 'node:fs/promises';
import type { Readable } from 'stream';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { AttachmentScanService } from '../attachments/attachment-scan.service';
import { AttachmentStorageService } from '../attachments/attachment-storage.service';
import type {
  ListMessagesDto,
  BulkReadDto,
  MoveMessageDto,
  SendMessageDto,
} from './dto/message.dto';
import { EMAIL_SEND_QUEUE } from '../../jobs/queues/email-send.queue';
import { SCHEDULED_MESSAGES_QUEUE } from '../../jobs/queues/scheduled-messages.queue';
import { AttachmentScanStatus, MessageDirection, Prisma } from '@prisma/client';
import type { EmailSendJobData } from '../../jobs/processors/email-send.processor';
import type { ScheduledMessageJobData } from '../../jobs/processors/scheduled-messages.processor';
import { NotificationsService } from '../notifications/notifications.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { AuditService } from '../audit/audit.service';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { EventsGateway } from '../websockets/events.gateway';

@Injectable()
export class MessagesService {
  private readonly s3: S3Client | null = null;
  private readonly logger = new Logger(MessagesService.name);
  private readonly encryptionAlgorithm = 'aes-256-gcm';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly attachmentScan: AttachmentScanService,
    private readonly attachmentStorage: AttachmentStorageService,
    @InjectQueue(EMAIL_SEND_QUEUE)
    private readonly emailSendQueue: Queue<EmailSendJobData>,
    @InjectQueue(SCHEDULED_MESSAGES_QUEUE)
    private readonly scheduledQueue: Queue<ScheduledMessageJobData>,
    private readonly notifications: NotificationsService,
    private readonly auditService: AuditService,
    private readonly eventsGateway: EventsGateway,
  ) {
    const storageType =
      this.configService.get<string>('attachment.storageType') ?? 'local';
    if (storageType === 's3') {
      this.s3 = new S3Client({
        region:
          this.configService.get<string>('attachment.s3Region') ?? 'us-east-1',
        endpoint:
          this.configService.get<string>('attachment.s3Endpoint') || undefined,
        credentials: {
          accessKeyId:
            this.configService.get<string>('attachment.s3AccessKey') ?? '',
          secretAccessKey:
            this.configService.get<string>('attachment.s3SecretKey') ?? '',
        },
      });
    }
  }

  // ─── Messages ─────────────────────────────────────────────────────────────

  async findAll(query: ListMessagesDto, user: JwtUser) {
    const limit = Math.min(Number(query.limit ?? 50), 200);

    const where: Prisma.MessageWhereInput = {
      mailbox: { organizationId: user.organizationId },
      ...(query.threadId && { threadId: query.threadId }),
      ...(query.mailboxId && { mailboxId: query.mailboxId }),
      ...(query.folderId && { folderId: query.folderId }),
      ...(query.isRead !== undefined && { isRead: query.isRead }),
      ...(query.cursor && { id: { lt: query.cursor } }),
      deletedAt: null,
    };

    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: {
        attachments: {
          where: this.getVisibleAttachmentWhere(),
          select: {
            id: true,
            filename: true,
            contentType: true,
            sizeBytes: true,
          },
        },
      },
    });

    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, limit) : messages;
    const itemsWithSchedule = await this.attachScheduledMetadata(
      items,
      user.organizationId,
    );
    return {
      items: itemsWithSchedule,
      nextCursor: hasMore ? items[items.length - 1].id : undefined,
      hasMore,
    };
  }

  async findOne(id: string, user: JwtUser) {
    const message = await this.prisma.message.findFirst({
      where: {
        id,
        mailbox: { organizationId: user.organizationId },
        deletedAt: null,
      },
      include: {
        attachments: {
          where: this.getVisibleAttachmentWhere(),
        },
        folder: { select: { id: true, name: true } },
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  async bulkRead(dto: BulkReadDto, user: JwtUser, meta: RequestMeta = {}) {
    const ids: string[] = Array.isArray(dto.ids) ? dto.ids : [];
    if (ids.length === 0) return { updated: 0 };

    const targetMessages = await this.prisma.message.findMany({
      where: {
        id: { in: ids },
        mailbox: { organizationId: user.organizationId },
      },
      select: {
        id: true,
        isRead: true,
      },
    });
    if (targetMessages.length === 0) {
      return { updated: 0 };
    }

    const nextReadState = dto.isRead ?? true;
    await this.prisma.message.updateMany({
      where: {
        id: { in: targetMessages.map((message) => message.id) },
        mailbox: { organizationId: user.organizationId },
      },
      data: { isRead: nextReadState },
    });

    const action = nextReadState ? 'MARK_READ' : 'MARK_UNREAD';
    await Promise.all(
      targetMessages.map((message) =>
        this.logAuditSafe({
          organizationId: user.organizationId,
          userId: user.sub,
          action,
          entityType: 'message',
          entityId: message.id,
          previousValue: { isRead: message.isRead },
          newValue: { isRead: nextReadState },
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        }),
      ),
    );

    return { updated: targetMessages.length };
  }

  async move(
    messageId: string,
    dto: MoveMessageDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const message = await this.findOne(messageId, user);
    // Verify folder belongs to the same mailbox
    const folder = await this.prisma.mailboxFolder.findFirst({
      where: { id: dto.folderId, mailboxId: message.mailboxId },
    });
    if (!folder) throw new NotFoundException('Folder not found in mailbox');
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { folderId: dto.folderId },
    });

    await this.logAuditSafe({
      organizationId: user.organizationId,
      userId: user.sub,
      action: 'MOVE_FOLDER',
      entityType: 'message',
      entityId: updated.id,
      previousValue: {
        folderId: message.folderId,
      },
      newValue: {
        folderId: updated.folderId,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return updated;
  }

  async send(dto: SendMessageDto, user: JwtUser) {
    if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
      this.logger.warn(
        `[messages] DISABLE_SMTP_SEND active; blocked send mailbox=${dto.mailboxId} org=${user.organizationId} user=${user.sub}`,
      );
      throw new ServiceUnavailableException(
        'Email sending is temporarily disabled by an emergency kill switch',
      );
    }

    // Verify mailbox belongs to org
    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        id: dto.mailboxId,
        organizationId: user.organizationId,
        deletedAt: null,
      },
    });
    if (!mailbox) throw new NotFoundException('Mailbox not found');

    let threadId = dto.threadId;
    let existingThreadAssignee: string | null = null;
    if (threadId) {
      const existingThread = await this.prisma.thread.findFirst({
        where: {
          id: threadId,
          organizationId: user.organizationId,
        },
        select: { assignedUserId: true, subject: true },
      });
      existingThreadAssignee = existingThread?.assignedUserId ?? null;
    }
    if (!threadId) {
      // Create a new thread
      const thread = await this.prisma.thread.create({
        data: {
          mailboxId: dto.mailboxId,
          organizationId: user.organizationId,
          subject: dto.subject ?? '(no subject)',
          status: 'OPEN',
        },
      });
      threadId = thread.id;
    }

    const message = await this.prisma.message.create({
      data: {
        threadId,
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
        inReplyTo: dto.inReplyTo,
        references: (dto.references ??
          []) as unknown as import('@prisma/client').Prisma.InputJsonValue,
        isOutbound: true,
        isDraft: dto.scheduledAt != null,
      },
    });

    if (dto.scheduledAt) {
      const scheduledAt = dto.scheduledAt;
      // Enqueue to scheduled-messages queue
      const scheduled = await this.prisma.scheduledMessage.create({
        data: {
          organizationId: user.organizationId,
          userId: user.sub,
          mailboxId: dto.mailboxId,
          threadId,
          payload: {
            messageId: message.id,
            threadId,
            threadStatusAfterSend: dto.threadStatusAfterSend ?? null,
          } as unknown as import('@prisma/client').Prisma.InputJsonValue,
          scheduledAt,
          timezone: dto.timezone ?? 'UTC',
          rrule: dto.rrule,
          status: 'pending',
        },
      });
      await this.scheduledQueue.add(
        'send',
        {
          scheduledMessageId: scheduled.id,
          messageId: message.id,
          mailboxId: dto.mailboxId,
          organizationId: user.organizationId,
          scheduledAt: scheduledAt.toISOString(),
          rrule: dto.rrule,
        },
        {
          delay: Math.max(0, scheduledAt.getTime() - Date.now()),
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
        },
      );
      void this.emitMailboxEvent(dto.mailboxId, 'thread:updated', {
        threadId,
        mailboxId: dto.mailboxId,
        scheduledStatus: 'pending',
        scheduledAt: scheduledAt.toISOString(),
        messageId: message.id,
      });
      void this.emitMailboxEvent(dto.mailboxId, 'message:new', {
        id: message.id,
        threadId,
        mailboxId: dto.mailboxId,
        direction: MessageDirection.OUTBOUND,
        createdAt: message.createdAt,
        scheduledStatus: 'pending',
        scheduledAt: scheduledAt.toISOString(),
      });
    } else {
      // Enqueue for immediate send
      await this.emailSendQueue.add(
        'send',
        {
          messageId: message.id,
          mailboxId: dto.mailboxId,
          organizationId: user.organizationId,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
      );
      void this.emitMailboxEvent(dto.mailboxId, 'thread:updated', {
        threadId,
        mailboxId: dto.mailboxId,
        queued: true,
        messageId: message.id,
      });
      void this.emitMailboxEvent(dto.mailboxId, 'message:new', {
        id: message.id,
        threadId,
        mailboxId: dto.mailboxId,
        direction: MessageDirection.OUTBOUND,
        createdAt: message.createdAt,
        queued: true,
      });
    }

    if (dto.threadId && existingThreadAssignee && existingThreadAssignee !== user.sub) {
      await this.notifications
        .dispatch({
          userId: existingThreadAssignee,
          organizationId: user.organizationId,
          type: 'thread_reply',
          title: 'A reply was sent on an assigned thread',
          message: `${user.email} replied in thread ${threadId}`,
          resourceId: threadId,
          data: {
            threadId,
            mailboxId: dto.mailboxId,
            assignedToUserId: existingThreadAssignee,
            repliedByUserId: user.sub,
          },
        })
        .catch(() => undefined);
    }

    return message;
  }

  async deliverQueuedMessage(messageId: string, organizationId: string) {
    if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
      this.logger.warn(
        `[messages] DISABLE_SMTP_SEND active; blocked queued send message=${messageId} org=${organizationId}`,
      );
      throw new ServiceUnavailableException(
        'Email sending is temporarily disabled by an emergency kill switch',
      );
    }

    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        deletedAt: null,
        mailbox: { organizationId, deletedAt: null },
      },
      include: {
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
        attachments: {
          where: this.getVisibleAttachmentWhere(),
          select: {
            id: true,
            filename: true,
            contentType: true,
            storageKey: true,
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException(`Message ${messageId} not found`);
    }

    if (!message.isDraft && message.messageId) {
      return {
        messageId: message.id,
        providerMessageId: message.messageId,
        threadId: message.threadId,
        mailboxId: message.mailboxId,
      };
    }

    const to = this.normalizeAddressJson(message.to);
    const cc = this.normalizeAddressJson(message.cc);
    const bcc = this.normalizeAddressJson(message.bcc);

    if (to.length === 0) {
      throw new BadRequestException(
        `Message ${messageId} has no valid recipients`,
      );
    }

    const references = this.normalizeReferencesJson(message.references);
    const { transport, fromEmail, replyTo } = this.buildTransport(message.mailbox, {
      fallbackFrom: message.fromEmail || '',
    });
    const attachments = await this.resolveMessageAttachments(message.attachments);
    const inlinePrepared = await this.embedSignatureImagesAsInlineAttachments(
      message.bodyHtml || undefined,
    );
    const outgoingAttachments = [...attachments, ...inlinePrepared.attachments];

    try {
      const info = await transport.sendMail({
        from: message.mailbox.name
          ? `"${message.mailbox.name}" <${fromEmail}>`
          : fromEmail,
        replyTo,
        to,
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
        subject: message.subject || '(no subject)',
        html: inlinePrepared.html,
        text: message.bodyText || undefined,
        inReplyTo: message.inReplyTo || undefined,
        references: references.length > 0 ? references : undefined,
        attachments:
          outgoingAttachments.length > 0 ? outgoingAttachments : undefined,
      });

      const providerMessageId =
        typeof info?.messageId === 'string' ? info.messageId : null;
      if (!providerMessageId) {
        throw new InternalServerErrorException(
          'Provider send completed without a message id',
        );
      }

      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          fromEmail,
          isDraft: false,
          messageId: providerMessageId,
        },
      });

      await this.prisma.thread
        .updateMany({
          where: {
            id: message.threadId,
            firstResponseAt: null,
          },
          data: {
            firstResponseAt: new Date(),
          },
        })
        .catch(() => undefined);

      void this.emitMailboxEvent(message.mailboxId, 'message:new', {
        id: message.id,
        threadId: message.threadId,
        mailboxId: message.mailboxId,
        direction: MessageDirection.OUTBOUND,
        createdAt: message.createdAt,
        messageId: providerMessageId,
        deliveryState: 'sent',
      });
      void this.emitMailboxEvent(message.mailboxId, 'thread:updated', {
        threadId: message.threadId,
        mailboxId: message.mailboxId,
        messageId: message.id,
        providerMessageId,
        deliveryState: 'sent',
      });

      return {
        messageId: message.id,
        providerMessageId,
        threadId: message.threadId,
        mailboxId: message.mailboxId,
      };
    } catch (error) {
      const providerMessage =
        error instanceof Error ? error.message : 'Unknown provider error';
      this.logger.error(
        `[messages] queued-send-failed ${JSON.stringify({
          messageId: message.id,
          mailboxId: message.mailboxId,
          threadId: message.threadId,
          to,
          cc,
          bcc,
          providerMessage,
        })}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        `Failed to deliver email to provider: ${providerMessage}`,
      );
    }
  }

  private normalizeAddressJson(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => String(entry || '').trim())
      .filter((entry) => entry.length > 0);
  }

  private async emitMailboxEvent(
    mailboxId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    try {
      await this.eventsGateway.emitToMailbox(mailboxId, event, payload);
    } catch (error) {
      this.logger.warn(
        `[messages] failed to emit ${event} for mailbox=${mailboxId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async attachScheduledMetadata<T extends { id: string }>(
    messages: T[],
    organizationId: string,
  ): Promise<Array<T & { scheduledAt?: Date | null; scheduledStatus?: string | null }>> {
    if (!Array.isArray(messages) || messages.length === 0) {
      return messages as Array<
        T & { scheduledAt?: Date | null; scheduledStatus?: string | null }
      >;
    }

    const ids = messages.map((message) => String(message.id));
    const payloadOr: Prisma.ScheduledMessageWhereInput[] = ids.flatMap((id) => [
      { payload: { path: ['messageId'], equals: id } },
      { payload: { path: ['id'], equals: id } },
    ]);

    const scheduledRows = await this.prisma.scheduledMessage.findMany({
      where: {
        organizationId,
        OR: payloadOr,
        status: { in: ['pending', 'processing', 'failed', 'cancelled'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        payload: true,
        scheduledAt: true,
        status: true,
      },
    });

    const scheduledByMessageId = new Map<
      string,
      { scheduledAt: Date; status: string }
    >();
    for (const row of scheduledRows) {
      const payload =
        row.payload &&
        typeof row.payload === 'object' &&
        !Array.isArray(row.payload)
          ? (row.payload as Record<string, unknown>)
          : null;
      const messageId = String(payload?.messageId ?? payload?.id ?? '').trim();
      if (!messageId || scheduledByMessageId.has(messageId)) continue;
      scheduledByMessageId.set(messageId, {
        scheduledAt: row.scheduledAt,
        status: row.status,
      });
    }

    return messages.map((message) => {
      const scheduled = scheduledByMessageId.get(String(message.id));
      if (!scheduled) {
        return {
          ...message,
          scheduledAt: null,
          scheduledStatus: null,
        };
      }

      return {
        ...message,
        scheduledAt: scheduled.scheduledAt,
        scheduledStatus: scheduled.status,
      };
    });
  }

  private normalizeReferencesJson(value: unknown): string[] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value
        .map((entry) => String(entry || '').trim())
        .filter((entry) => entry.length > 0);
    }
    const raw = String(value || '').trim();
    if (!raw) return [];
    return raw
      .split(/\s+/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
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
    const decipher = crypto.createDecipheriv(this.encryptionAlgorithm, key, iv);
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

  private buildTransport(
    mailbox: {
      id: string;
      name: string | null;
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
      lastSyncError: string | null;
    },
    options: { fallbackFrom?: string },
  ): {
    transport: nodemailer.Transporter;
    fromEmail: string;
    replyTo: string;
  } {
    const globalHost = this.configService.get<string>('smtp.host') ?? '';
    const globalPort = this.configService.get<number>('smtp.port') ?? 587;
    const globalUser = this.configService.get<string>('smtp.user') ?? '';
    const globalPass = this.configService.get<string>('smtp.pass') ?? '';
    const globalFrom = this.configService.get<string>('smtp.from') ?? '';

    const host = mailbox.smtpHost || globalHost;
    const port = mailbox.smtpPort || globalPort;
    const secure = mailbox.smtpSecure ?? port === 465;
    const smtpUser = mailbox.smtpUser || globalUser;
    const smtpPass = this.decryptSecretIfNeeded(mailbox.smtpPass) || globalPass;

    const oauthAccessToken =
      this.decryptSecretIfNeeded(mailbox.oauthAccessToken) ||
      this.decryptSecretIfNeeded(mailbox.googleAccessToken);
    const oauthRefreshToken =
      this.decryptSecretIfNeeded(mailbox.oauthRefreshToken) ||
      this.decryptSecretIfNeeded(mailbox.googleRefreshToken);
    const googleClientId = this.configService.get<string>('google.clientId') ?? '';
    const googleClientSecret =
      this.configService.get<string>('google.clientSecret') ?? '';

    const isDisconnectedOauthMailbox =
      (mailbox.provider === 'GMAIL' || mailbox.provider === 'OUTLOOK') &&
      !mailbox.oauthProvider &&
      mailbox.lastSyncError === 'OAuth disconnected';

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

    const fromEmail = mailbox.email || options.fallbackFrom || globalFrom;
    if (!fromEmail) {
      throw new BadRequestException(
        'From email is not configured for this mailbox.',
      );
    }

    let authMode: 'oauth2' | 'password' | 'none' = 'none';
    let transportAuth: Record<string, unknown> = {};

    if (oauthAccessToken) {
      authMode = 'oauth2';
      transportAuth = {
        auth: {
          type: 'OAuth2' as const,
          user: mailbox.email || fromEmail,
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

    return {
      transport: nodemailer.createTransport({
        host,
        port,
        secure,
        ...transportAuth,
      }),
      fromEmail,
      replyTo: mailbox.email || fromEmail,
    };
  }

  private async readAttachmentBuffer(storageKey: string): Promise<Buffer> {
    if (!this.attachmentStorage.isS3Storage()) {
      return this.attachmentStorage.getLocalBuffer(storageKey);
    }
    const stream = await this.attachmentStorage.getReadStream(storageKey);
    return this.streamToBuffer(stream);
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async resolveMessageAttachments(
    attachments: Array<{
      filename: string;
      contentType: string | null;
      storageKey: string;
    }>,
  ): Promise<
    Array<{
      filename: string;
      contentType?: string;
      content: Buffer;
      cid?: string;
      contentDisposition?: 'inline' | 'attachment';
    }>
  > {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return [];
    }

    const resolved = await Promise.all(
      attachments.map(async (attachment) => {
        const content = await this.readAttachmentBuffer(attachment.storageKey);
        return {
          filename: attachment.filename,
          contentType: attachment.contentType || undefined,
          content,
        };
      }),
    );

    return resolved;
  }

  private async embedSignatureImagesAsInlineAttachments(
    html: string | undefined,
  ): Promise<{
    html: string | undefined;
    attachments: Array<{
      filename: string;
      contentType: string;
      content: Buffer;
      cid: string;
      contentDisposition: 'inline';
    }>;
  }> {
    const rawHtml = String(html || '');
    if (!rawHtml.trim()) {
      return { html, attachments: [] };
    }

    const signatureImageBaseDir = path.resolve(
      process.cwd(),
      'uploads',
      'signatures',
    );
    const imageRegex = /<img\b[^>]*\bsrc=(["'])(.*?)\1/gi;
    const planned = new Map<
      string,
      {
        cid: string;
        filename: string;
        contentType: string;
        content: Buffer;
      }
    >();

    let match: RegExpExecArray | null = imageRegex.exec(rawHtml);
    while (match) {
      const src = String(match[2] || '').trim();
      if (!src) {
        match = imageRegex.exec(rawHtml);
        continue;
      }

      const localPath = this.resolveLocalSignatureImagePath(src);
      if (!localPath) {
        match = imageRegex.exec(rawHtml);
        continue;
      }

      const normalizedPath = path.resolve(localPath);
      if (
        !normalizedPath.startsWith(signatureImageBaseDir + path.sep) &&
        normalizedPath !== signatureImageBaseDir
      ) {
        match = imageRegex.exec(rawHtml);
        continue;
      }

      if (!planned.has(src)) {
        try {
          const content = await readFile(normalizedPath);
          const filename = path.basename(normalizedPath) || 'signature-image';
          const extension = path.extname(filename).toLowerCase();
          const contentType =
            extension === '.jpg' || extension === '.jpeg'
              ? 'image/jpeg'
              : extension === '.gif'
                ? 'image/gif'
                : extension === '.webp'
                  ? 'image/webp'
                  : extension === '.svg'
                    ? 'image/svg+xml'
                    : 'image/png';
          const cid = `sig-${crypto
            .createHash('sha1')
            .update(src)
            .digest('hex')}@sermuno`;
          planned.set(src, { cid, filename, contentType, content });
        } catch {
          // Keep original image src when local file cannot be read.
        }
      }

      match = imageRegex.exec(rawHtml);
    }

    if (planned.size === 0) {
      return { html, attachments: [] };
    }

    let nextHtml = rawHtml;
    for (const [src, entry] of planned.entries()) {
      nextHtml = nextHtml.replaceAll(`src="${src}"`, `src="cid:${entry.cid}"`);
      nextHtml = nextHtml.replaceAll(`src='${src}'`, `src='cid:${entry.cid}'`);
    }

    return {
      html: nextHtml,
      attachments: Array.from(planned.values()).map((entry) => ({
        filename: entry.filename,
        contentType: entry.contentType,
        content: entry.content,
        cid: entry.cid,
        contentDisposition: 'inline' as const,
      })),
    };
  }

  private resolveLocalSignatureImagePath(src: string): string | null {
    const trimmed = String(src || '').trim();
    if (!trimmed) return null;

    let pathname = '';
    if (trimmed.startsWith('/uploads/signatures/')) {
      pathname = trimmed;
    } else {
      try {
        const parsed = new URL(trimmed);
        pathname = parsed.pathname;
      } catch {
        return null;
      }
    }

    if (!pathname.startsWith('/uploads/signatures/')) {
      return null;
    }

    const relative = decodeURIComponent(pathname.replace(/^\//, ''));
    return path.resolve(process.cwd(), relative);
  }

  // ─── Attachments ──────────────────────────────────────────────────────────

  async getAttachmentDownloadLink(
    messageId: string,
    attachmentId: string,
    user: JwtUser,
  ): Promise<{ url: string; expiresIn: number }> {
    const attachment = await this.assertAttachmentAccess(
      messageId,
      attachmentId,
      user,
    );
    const approvedAttachment =
      await this.attachmentScan.ensureAttachmentDownloadAllowed(
        attachment,
        user.sub,
      );
    const url = await this.buildDownloadUrl(approvedAttachment);
    return { url, expiresIn: 3600 };
  }

  async getPublicDownloadUrl(
    messageId: string,
    attachmentId: string,
    user: JwtUser,
  ): Promise<{ url: string }> {
    const attachment = await this.assertAttachmentAccess(
      messageId,
      attachmentId,
      user,
    );
    const approvedAttachment =
      await this.attachmentScan.ensureAttachmentDownloadAllowed(
        attachment,
        user.sub,
      );
    const url = await this.buildDownloadUrl(approvedAttachment);
    return { url };
  }

  private async buildDownloadUrl(attachment: {
    id: string;
    storageKey: string;
    filename: string;
  }): Promise<string> {
    const storageType =
      this.configService.get<string>('attachment.storageType') ?? 'local';

    if (storageType === 's3' && this.s3) {
      const bucket =
        this.configService.get<string>('attachment.s3Bucket') ?? '';
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: attachment.storageKey,
        ResponseContentDisposition: `attachment; filename="${attachment.filename}"`,
      });
      return getSignedUrl(this.s3, cmd, { expiresIn: 3600 });
    }

    return `/attachments/${encodeURIComponent(attachment.id)}/download`;
  }

  private async assertAttachmentAccess(
    messageId: string,
    attachmentId: string,
    user: JwtUser,
  ) {
    const message = await this.findOne(messageId, user);
    const attachment = await this.prisma.attachment.findFirst({
      where: { id: attachmentId, messageId },
    });
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }

  private getVisibleAttachmentWhere(): Prisma.AttachmentWhereInput {
    return {
      quarantinedAt: null,
      scanStatus: {
        in: [AttachmentScanStatus.UNSCANNED, AttachmentScanStatus.CLEAN],
      },
    };
  }

  private async logAuditSafe(input: {
    organizationId: string;
    userId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    previousValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
    ipAddress?: string;
    userAgent?: string;
  }) {
    try {
      await this.auditService.log(input);
    } catch (error) {
      this.logger.warn(
        `Failed to write message audit log for ${input.action}: ${(error as Error).message}`,
      );
    }
  }
}
