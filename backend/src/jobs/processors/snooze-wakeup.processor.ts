import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SNOOZE_WAKEUP_QUEUE } from '../queues/snooze-wakeup.queue';
import { PrismaService } from '../../database/prisma.service';
import { ThreadStatus } from '@prisma/client';

export interface SnoozeWakeupJobData {
  organizationId?: string;
}

// Repeatable job running every 60s to wake up snoozed threads
@Processor(SNOOZE_WAKEUP_QUEUE, {
  concurrency: 1,
})
export class SnoozeWakeupProcessor extends WorkerHost {
  private readonly logger = new Logger(SnoozeWakeupProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(_job: Job<SnoozeWakeupJobData>): Promise<void> {
    this.logger.log('[snooze-wakeup] Checking for threads to wake up');

    const now = new Date();

    // Find all snoozed threads whose snoozedUntil has passed
    const threads = await this.prisma.thread.findMany({
      where: {
        snoozedUntil: { lte: now },
        status: ThreadStatus.SNOOZED,
      },
      select: { id: true, previousStatus: true, organizationId: true },
    });

    if (threads.length === 0) return;

    this.logger.log(`[snooze-wakeup] Waking up ${threads.length} thread(s)`);

    for (const thread of threads) {
      const restoredStatus =
        (thread.previousStatus as ThreadStatus) ?? ThreadStatus.OPEN;

      await this.prisma.thread.update({
        where: { id: thread.id },
        data: {
          snoozedUntil: null,
          previousStatus: null,
          status: restoredStatus,
        },
      });

      // Log audit event
      await this.prisma.auditLog.create({
        data: {
          organizationId: thread.organizationId,
          entityType: 'thread',
          entityId: thread.id,
          action: 'thread.unsnoozed',
          newValue: { restoredStatus },
        },
      });
    }
  }
}
