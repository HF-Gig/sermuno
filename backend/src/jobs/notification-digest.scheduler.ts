import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { NOTIFICATION_DIGEST_QUEUE } from './queues/notification-digest.queue';

@Injectable()
export class NotificationDigestScheduler implements OnModuleInit {
  private readonly logger = new Logger(NotificationDigestScheduler.name);

  constructor(
    @InjectQueue(NOTIFICATION_DIGEST_QUEUE)
    private readonly digestQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.digestQueue.add(
      'hourly',
      {},
      {
        jobId: 'notification-digest-hourly',
        repeat: {
          every: 60 * 60 * 1000,
        },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    await this.digestQueue.add(
      'daily',
      {},
      {
        jobId: 'notification-digest-daily',
        repeat: {
          every: 60 * 60 * 1000,
        },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    this.logger.log('[notification-digest] Repeatable hourly/daily jobs ensured');
  }
}
