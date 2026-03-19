import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SCHEDULED_MESSAGES_QUEUE } from '../queues/scheduled-messages.queue';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';

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

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ScheduledMessageJobData>): Promise<void> {
    const { messageId, rrule, scheduledMessageId } = job.data;
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
            payload: { path: ['id'], equals: messageId },
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

    try {
      // Actual SMTP dispatch is handled by email-send queue integration.
      // Here we mark lifecycle state transitions for scheduling workflow.
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
}
