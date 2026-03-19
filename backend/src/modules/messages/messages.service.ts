import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  ListMessagesDto,
  BulkReadDto,
  MoveMessageDto,
  SendMessageDto,
} from './dto/message.dto';
import { EMAIL_SEND_QUEUE } from '../../jobs/queues/email-send.queue';
import { SCHEDULED_MESSAGES_QUEUE } from '../../jobs/queues/scheduled-messages.queue';
import { MessageDirection, Prisma } from '@prisma/client';
import type { EmailSendJobData } from '../../jobs/processors/email-send.processor';
import type { ScheduledMessageJobData } from '../../jobs/processors/scheduled-messages.processor';

@Injectable()
export class MessagesService {
  private readonly s3: S3Client | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @InjectQueue(EMAIL_SEND_QUEUE)
    private readonly emailSendQueue: Queue<EmailSendJobData>,
    @InjectQueue(SCHEDULED_MESSAGES_QUEUE)
    private readonly scheduledQueue: Queue<ScheduledMessageJobData>,
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
    return {
      items,
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
        attachments: true,
        folder: { select: { id: true, name: true } },
      },
    });
    if (!message) throw new NotFoundException('Message not found');
    return message;
  }

  async bulkRead(dto: BulkReadDto, user: JwtUser) {
    const ids: string[] = Array.isArray(dto.ids) ? dto.ids : [];
    if (ids.length === 0) return { updated: 0 };
    await this.prisma.message.updateMany({
      where: {
        id: { in: ids },
        mailbox: { organizationId: user.organizationId },
      },
      data: { isRead: dto.isRead ?? true },
    });
    return { updated: ids.length };
  }

  async move(messageId: string, dto: MoveMessageDto, user: JwtUser) {
    const message = await this.findOne(messageId, user);
    // Verify folder belongs to the same mailbox
    const folder = await this.prisma.mailboxFolder.findFirst({
      where: { id: dto.folderId, mailboxId: message.mailboxId },
    });
    if (!folder) throw new NotFoundException('Folder not found in mailbox');
    return this.prisma.message.update({
      where: { id: messageId },
      data: { folderId: dto.folderId },
    });
  }

  async send(dto: SendMessageDto, user: JwtUser) {
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
          payload:
            message as unknown as import('@prisma/client').Prisma.InputJsonValue,
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
    }

    return message;
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
    const url = await this.buildDownloadUrl(
      attachment.storageKey,
      attachment.filename,
    );
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
    const url = await this.buildDownloadUrl(
      attachment.storageKey,
      attachment.filename,
    );
    return { url };
  }

  private async buildDownloadUrl(
    storageKey: string,
    filename: string,
  ): Promise<string> {
    const storageType =
      this.configService.get<string>('attachment.storageType') ?? 'local';

    if (storageType === 's3' && this.s3) {
      const bucket =
        this.configService.get<string>('attachment.s3Bucket') ?? '';
      const cmd = new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      });
      return getSignedUrl(this.s3, cmd, { expiresIn: 3600 });
    }

    // Local storage: return a path relative to /attachments
    return `/attachments/${encodeURIComponent(storageKey)}`;
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
}
