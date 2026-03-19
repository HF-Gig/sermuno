import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EMAIL_SEND_QUEUE } from '../queues/email-send.queue';

export interface EmailSendJobData {
  messageId: string;
  mailboxId: string;
  organizationId: string;
  /** Password-reset emails use 5 attempts with exponential backoff, 1s base delay */
  jobType?: 'password-reset' | 'regular';
}

@Processor(EMAIL_SEND_QUEUE, {
  concurrency: 5,
})
export class EmailSendProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailSendProcessor.name);

  async process(job: Job<EmailSendJobData>): Promise<void> {
    const { messageId, mailboxId } = job.data;
    this.logger.log(
      `[email-send] Sending message=${messageId} via mailbox=${mailboxId}`,
    );
    // TODO Phase 2.5: full SMTP send implementation
  }
}
