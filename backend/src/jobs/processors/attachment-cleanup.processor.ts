import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ATTACHMENT_CLEANUP_QUEUE } from '../queues/attachment-cleanup.queue';
import { PrismaService } from '../../database/prisma.service';
import { AttachmentStorageService } from '../../modules/attachments/attachment-storage.service';
import { AuditService } from '../../modules/audit/audit.service';

export interface AttachmentCleanupJobData {
  /** When set, clean only this specific attachment. When absent, run full sweep. */
  attachmentId?: string;
}

// Attachment cleanup jobs: 1 attempt only per spec
@Processor(ATTACHMENT_CLEANUP_QUEUE, {
  concurrency: 1,
})
export class AttachmentCleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(AttachmentCleanupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: AttachmentStorageService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<AttachmentCleanupJobData>): Promise<void> {
    const { attachmentId } = job.data;

    if (attachmentId) {
      await this.cleanSingle(attachmentId);
    } else {
      await this.cleanAll();
    }
  }

  /** Clean a single attachment by ID. */
  private async cleanSingle(attachmentId: string): Promise<void> {
    const attachment = await this.prisma.attachment.findUnique({
      where: { id: attachmentId },
      include: {
        message: { select: { id: true, deletedAt: true, threadId: true } },
      },
    });

    if (!attachment) {
      this.logger.warn(
        `[cleanup] attachment=${attachmentId} not found — skipping`,
      );
      return;
    }

    await this.deleteAttachment(attachment);
  }

  /**
   * Repeatable sweep: find all attachments whose linked message is soft-deleted.
   * Runs daily (scheduled externally).
   */
  private async cleanAll(): Promise<void> {
    this.logger.log('[cleanup] Starting full attachment cleanup sweep');

    const stale = await this.prisma.attachment.findMany({
      where: {
        message: {
          deletedAt: { not: null },
        },
      },
      include: {
        message: { select: { id: true, deletedAt: true, threadId: true } },
      },
      take: 1000, // process up to 1000 per run
    });

    this.logger.log(`[cleanup] Found ${stale.length} stale attachments`);

    for (const attachment of stale) {
      await this.deleteAttachment(attachment).catch((err) =>
        this.logger.error(
          `[cleanup] Failed to delete attachment=${attachment.id}: ${String(err)}`,
        ),
      );
    }

    this.logger.log('[cleanup] Sweep complete');
  }

  private async deleteAttachment(attachment: {
    id: string;
    storageKey: string;
    message: { id: string; threadId: string };
  }): Promise<void> {
    this.logger.log(
      `[cleanup] Deleting attachment=${attachment.id} key=${attachment.storageKey}`,
    );

    // Delete from storage backend
    await this.storage.delete(attachment.storageKey);

    // Delete from DB
    await this.prisma.attachment.delete({ where: { id: attachment.id } });

    // Get org context from thread
    const thread = await this.prisma.thread.findUnique({
      where: { id: attachment.message.threadId },
      select: { organizationId: true },
    });

    if (thread) {
      await this.audit.log({
        organizationId: thread.organizationId,
        action: 'attachment.deleted',
        entityType: 'attachment',
        entityId: attachment.id,
        newValue: { storageKey: attachment.storageKey },
      });
    }
  }
}
