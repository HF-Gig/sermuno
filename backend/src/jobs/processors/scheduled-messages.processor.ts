import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SCHEDULED_MESSAGES_QUEUE } from '../queues/scheduled-messages.queue';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { MessagesService } from '../../modules/messages/messages.service';
import { EventsGateway } from '../../modules/websockets/events.gateway';

export interface ScheduledMessageJobData {
  scheduledMessageId?: string;
  messageId: string;
  mailboxId: string;
  organizationId: string;
  scheduledAt: string; // ISO8601
  /** RRULE string for recurring messages */
  rrule?: string;
}

@Processor(SCHEDULED_MESSAGES_QUEUE, {
  concurrency: 3,
})
export class ScheduledMessagesProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledMessagesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly messagesService: MessagesService,
    private readonly eventsGateway: EventsGateway,
  ) {
    super();
  }

  async process(job: Job<ScheduledMessageJobData>): Promise<void> {
    const { messageId, rrule, scheduledMessageId } = job.data;
    if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
      this.logger.warn(
        `[scheduled-messages] DISABLE_SMTP_SEND active; skipping scheduled message=${messageId}`,
      );
      return;
    }

    this.logger.log(
      `[scheduled-messages] Sending scheduled message=${messageId} rrule=${rrule ?? 'none'}`,
    );

    const scheduled = scheduledMessageId
      ? await this.prisma.scheduledMessage.findUnique({
          where: { id: scheduledMessageId },
        })
      : await this.prisma.scheduledMessage.findFirst({
          where: {
            status: 'pending',
            OR: [
              { payload: { path: ['messageId'], equals: messageId } },
              { payload: { path: ['id'], equals: messageId } },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });

    if (!scheduled) {
      this.logger.warn(
        `[scheduled-messages] No scheduled record for message=${messageId}`,
      );
      return;
    }

    if (scheduled.status === 'cancelled') {
      this.logger.log(
        `[scheduled-messages] Scheduled message ${scheduled.id} already cancelled`,
      );
      return;
    }

    if (new Date() < scheduled.scheduledAt) {
      this.logger.log(
        `[scheduled-messages] Message ${scheduled.id} not due yet`,
      );
      return;
    }

    await this.prisma.scheduledMessage.update({
      where: { id: scheduled.id },
      data: { status: 'processing' },
    });
    await this.emitScheduledStatusEvent(
      scheduled.mailboxId,
      scheduled.threadId,
      messageId,
      'processing',
      scheduled.scheduledAt,
    );

    try {
      const deliveryResult = await this.messagesService.deliverQueuedMessage(
        messageId,
        scheduled.organizationId,
      );
      if (!deliveryResult.providerMessageId) {
        throw new Error(
          `Provider delivery missing message id for scheduled ${scheduled.id}`,
        );
      }

      const deliveredMessage = await this.prisma.message.findFirst({
        where: {
          id: messageId,
          mailbox: { organizationId: scheduled.organizationId },
          deletedAt: null,
        },
        select: {
          isDraft: true,
          messageId: true,
        },
      });
      if (!deliveredMessage || deliveredMessage.isDraft || !deliveredMessage.messageId) {
        throw new Error(
          `Persisted message state invalid after delivery for scheduled ${scheduled.id}`,
        );
      }

      const payloadRecord =
        scheduled.payload &&
        typeof scheduled.payload === 'object' &&
        !Array.isArray(scheduled.payload)
          ? (scheduled.payload as Record<string, unknown>)
          : null;
      const requestedThreadStatus = String(
        payloadRecord?.threadStatusAfterSend ?? '',
      ).toUpperCase();
      const supportedThreadStatuses = new Set([
        'NEW',
        'OPEN',
        'PENDING',
        'CLOSED',
        'ARCHIVED',
      ]);
      if (
        scheduled.threadId &&
        supportedThreadStatuses.has(requestedThreadStatus)
      ) {
        await this.prisma.thread.updateMany({
          where: {
            id: scheduled.threadId,
            organizationId: scheduled.organizationId,
          },
          data: {
            status: requestedThreadStatus as
              | 'NEW'
              | 'OPEN'
              | 'PENDING'
              | 'CLOSED'
              | 'ARCHIVED',
          },
        });
      }

      await this.prisma.scheduledMessage.update({
        where: { id: scheduled.id },
        data: {
          status: 'sent',
          nextRunAt: this.computeNextRun(
            scheduled.scheduledAt,
            scheduled.rrule ?? undefined,
          ),
          lastError: null,
        },
      });
      await this.emitScheduledStatusEvent(
        scheduled.mailboxId,
        scheduled.threadId,
        messageId,
        'sent',
        scheduled.scheduledAt,
      );

      if (scheduled.rrule) {
        const nextAt = this.computeNextRun(
          scheduled.scheduledAt,
          scheduled.rrule,
        );
        if (nextAt) {
          await this.prisma.scheduledMessage.create({
            data: {
              organizationId: scheduled.organizationId,
              userId: scheduled.userId,
              mailboxId: scheduled.mailboxId,
              threadId: scheduled.threadId,
              payload: (scheduled.payload ??
                Prisma.JsonNull) as Prisma.InputJsonValue,
              status: 'pending',
              scheduledAt: nextAt,
              timezone: scheduled.timezone,
              rrule: scheduled.rrule,
              retryCount: 0,
              maxRetries: scheduled.maxRetries,
            },
          });
        }
      }
    } catch (err) {
      const retryCount = scheduled.retryCount + 1;
      const maxRetries = scheduled.maxRetries ?? 3;
      await this.prisma.scheduledMessage.update({
        where: { id: scheduled.id },
        data: {
          retryCount,
          status: retryCount >= maxRetries ? 'failed' : 'pending',
          lastError: String(err),
        },
      });
      await this.emitScheduledStatusEvent(
        scheduled.mailboxId,
        scheduled.threadId,
        messageId,
        retryCount >= maxRetries ? 'failed' : 'pending',
        scheduled.scheduledAt,
      );
      throw err;
    }
  }

  private computeNextRun(base: Date, rrule?: string): Date | null {
    if (!rrule) return null;
    const upper = rrule.toUpperCase();
    if (upper.includes('FREQ=DAILY'))
      return new Date(base.getTime() + 24 * 60 * 60 * 1000);
    if (upper.includes('FREQ=WEEKLY'))
      return new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (upper.includes('FREQ=MONTHLY')) {
      const d = new Date(base);
      d.setMonth(d.getMonth() + 1);
      return d;
    }
    return null;
  }

  private async emitScheduledStatusEvent(
    mailboxId: string,
    threadId: string | null,
    messageId: string,
    scheduledStatus: 'pending' | 'processing' | 'sent' | 'failed',
    scheduledAt: Date,
  ): Promise<void> {
    try {
      await this.eventsGateway.emitToMailbox(mailboxId, 'thread:updated', {
        mailboxId,
        threadId,
        messageId,
        scheduledStatus,
        scheduledAt: scheduledAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `[scheduled-messages] failed to emit status=${scheduledStatus} for mailbox=${mailboxId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
