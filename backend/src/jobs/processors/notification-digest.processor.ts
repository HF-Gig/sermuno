import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { NOTIFICATION_DIGEST_QUEUE } from '../queues/notification-digest.queue';
import { NOTIFICATION_DISPATCH_QUEUE } from '../queues/notification-dispatch.queue';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

type DigestMode = 'hourly_digest' | 'daily_digest';

@Processor(NOTIFICATION_DIGEST_QUEUE, {
  concurrency: 2,
})
export class NotificationDigestProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationDigestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATION_DISPATCH_QUEUE)
    private readonly dispatchQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'daily') {
      await this.flushMode('daily_digest');
      return;
    }
    await this.flushMode('hourly_digest');
  }

  private async flushMode(mode: DigestMode): Promise<void> {
    const now = new Date();
    const pendingItems = await this.prisma.notificationDigestItem.findMany({
      where: {
        status: 'pending',
        emailDeliveryMode: mode,
        windowEnd: { lte: now },
      },
      orderBy: [{ userId: 'asc' }, { createdAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      take: 500,
    });

    if (pendingItems.length === 0) {
      return;
    }

    const groups = new Map<string, typeof pendingItems>();
    for (const item of pendingItems) {
      const key = `${item.userId}:${item.windowKey}`;
      const entries = groups.get(key) ?? [];
      entries.push(item);
      groups.set(key, entries);
    }

    for (const [, items] of groups) {
      await this.processGroup(items, mode);
    }
  }

  private async processGroup(
    items: Array<{
      id: string;
      userId: string;
      title: string;
      message: string | null;
      notificationType: string;
      resourceId: string | null;
      notificationId: string | null;
      windowStart: Date;
      windowEnd: Date;
      user: {
        id: string;
        fullName: string;
        email: string;
      };
    }>,
    mode: DigestMode,
  ) {
    if (items.length === 0) {
      return;
    }

    const first = items[0];
    const modeLabel = mode === 'hourly_digest' ? 'Hourly' : 'Daily';
    const subject = `${modeLabel} notification digest (${items.length})`;
    const heading = `${modeLabel} notification digest for ${first.user.fullName || first.user.email}`;
    const lines = items.map((item) => {
      const lineMessage = item.message ? ` - ${item.message}` : '';
      return `- [${item.notificationType}] ${item.title}${lineMessage}`;
    });
    const text = [
      heading,
      '',
      `Window: ${first.windowStart.toISOString()} -> ${first.windowEnd.toISOString()}`,
      '',
      ...lines,
    ].join('\n');

    try {
      await this.dispatchQueue.add('dispatch', {
        channel: 'email',
        userId: first.userId,
        subject,
        text,
      });

      const notificationIds = items
        .map((item) => item.notificationId)
        .filter((item): item is string => Boolean(item));

      await this.prisma.$transaction(async (tx) => {
        await tx.notificationDigestItem.updateMany({
          where: {
            id: { in: items.map((item) => item.id) },
          },
          data: {
            status: 'processed',
            processedAt: new Date(),
            failedAt: null,
            error: null,
          },
        });

        if (notificationIds.length > 0) {
          await tx.notification.updateMany({
            where: { id: { in: notificationIds } },
            data: {
              sentAt: new Date(),
              failedAt: null,
              error: null,
            },
          });
        }
      });

      this.logger.log(
        `[notification-digest] Delivered mode=${mode} user=${first.userId} items=${items.length}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.notificationDigestItem.updateMany({
        where: {
          id: { in: items.map((item) => item.id) },
        },
        data: {
          status: 'failed',
          failedAt: new Date(),
          error: message,
        },
      });
      this.logger.error(
        `[notification-digest] Failed mode=${mode} user=${first.userId}: ${message}`,
      );
    }
  }
}
