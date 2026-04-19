import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EMAIL_SEND_QUEUE } from '../queues/email-send.queue';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { MessagesService } from '../../modules/messages/messages.service';

export interface EmailSendJobData {
  messageId: string;
  mailboxId: string;
  organizationId: string;
  scheduledMessageId?: string;
  /** Password-reset emails use 5 attempts with exponential backoff, 1s base delay */
  jobType?: 'password-reset' | 'regular';
}

@Processor(EMAIL_SEND_QUEUE, {
  concurrency: 5,
})
export class EmailSendProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailSendProcessor.name);

  constructor(
    private readonly featureFlags: FeatureFlagsService,
    private readonly messagesService: MessagesService,
  ) {
    super();
  }

  async process(job: Job<EmailSendJobData>): Promise<void> {
    const { messageId, mailboxId, organizationId } = job.data;
    if (this.featureFlags.get('DISABLE_SMTP_SEND')) {
      this.logger.warn(
        `[email-send] DISABLE_SMTP_SEND active; skipping message=${messageId} mailbox=${mailboxId}`,
      );
      return;
    }

    this.logger.log(
      `[email-send] Sending message=${messageId} via mailbox=${mailboxId}`,
    );
    await this.messagesService.deliverQueuedMessage(messageId, organizationId);
  }
}
