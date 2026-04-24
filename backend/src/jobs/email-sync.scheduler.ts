import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagsService } from '../config/feature-flags.service';
import { EMAIL_SYNC_QUEUE } from './queues/email-sync.queue';
import type { EmailSyncJobData } from './processors/email-sync.processor';

const DEFAULT_SYNC_INTERVAL_MS = 3_000;
const MIN_SYNC_INTERVAL_MS = 2_000;

@Injectable()
export class EmailSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailSyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private isTickRunning = false;
  private intervalMs = DEFAULT_SYNC_INTERVAL_MS;

  constructor(
    @InjectQueue(EMAIL_SYNC_QUEUE)
    private readonly emailSyncQueue: Queue<EmailSyncJobData>,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  private start(): void {
    if (this.timer) return;

    const configuredInterval = Number(
      process.env.EMAIL_SYNC_NEAR_REALTIME_INTERVAL_MS ??
        process.env.EMAIL_SYNC_INTERVAL_MS ??
        DEFAULT_SYNC_INTERVAL_MS,
    );
    const intervalMs = Number.isFinite(configuredInterval)
      ? Math.max(Math.floor(configuredInterval), MIN_SYNC_INTERVAL_MS)
      : DEFAULT_SYNC_INTERVAL_MS;
    this.intervalMs = intervalMs;

    this.logger.log(
      `[email-sync-scheduler] started with intervalMs=${intervalMs}`,
    );

    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);

    // Prime immediately on boot so inboxes become current without waiting for the first interval.
    void this.tick();
  }

  private stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.isTickRunning) return;
    if (this.featureFlags.get('DISABLE_IMAP_SYNC')) return;
    if (!this.featureFlags.get('ENABLE_IMAP_SYNC')) return;

    this.isTickRunning = true;
    try {
      const now = new Date();
      const staleBefore = new Date(now.getTime() - this.intervalMs);
      const streamingMode =
        this.configService.get<boolean>('featureFlags.enableStreamingSync') ??
        false;

      const mailboxes = await this.prisma.mailbox.findMany({
        where: {
          deletedAt: null,
          NOT: {
            provider: 'OUTLOOK',
            oauthProvider: 'microsoft',
          },
          AND: [
            { syncStatus: { not: 'SYNCING' } },
            {
              OR: [{ lastSyncAt: null }, { lastSyncAt: { lte: staleBefore } }],
            },
            {
              OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
            },
            {
              OR: [
                { imapPass: { not: null } },
                { oauthAccessToken: { not: null } },
                { googleAccessToken: { not: null } },
              ],
            },
          ],
        },
        select: {
          id: true,
          organizationId: true,
        },
        orderBy: [
          { lastSyncAt: 'asc' },
          { createdAt: 'asc' },
        ],
      });

      if (mailboxes.length === 0) return;

      let enqueued = 0;
      let skippedDuplicate = 0;
      let failed = 0;

      for (const mailbox of mailboxes) {
        try {
          await this.emailSyncQueue.add(
            'sync',
            {
              mailboxId: mailbox.id,
              organizationId: mailbox.organizationId,
              streamingMode,
              folderTypeHints: ['inbox'],
            },
            {
              jobId: `auto-sync-${mailbox.id}`,
              attempts: 1,
              removeOnComplete: true,
              removeOnFail: 100,
            },
          );
          enqueued += 1;
        } catch (error) {
          if (this.isDuplicateJobError(error)) {
            skippedDuplicate += 1;
            continue;
          }
          failed += 1;
          this.logger.warn(
            `[email-sync-scheduler] enqueue failed mailbox=${mailbox.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      if (enqueued > 0 || skippedDuplicate > 0 || failed > 0) {
        this.logger.log(
          `[email-sync-scheduler] tick mailboxes=${mailboxes.length} enqueued=${enqueued} duplicate=${skippedDuplicate} failed=${failed}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[email-sync-scheduler] tick failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.isTickRunning = false;
    }
  }

  private isDuplicateJobError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const message =
      'message' in error && typeof (error as { message?: unknown }).message === 'string'
        ? ((error as { message: string }).message || '').toLowerCase()
        : '';
    return message.includes('job') && message.includes('already exists');
  }
}
