import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  THREAD_DELETE_QUEUE,
  type ThreadDeleteJobData,
} from '../../jobs/queues/thread-delete.queue';
import { ThreadsService } from './threads.service';

@Processor(THREAD_DELETE_QUEUE, {
  concurrency: 2,
})
export class ThreadDeleteProcessor extends WorkerHost {
  private readonly logger = new Logger(ThreadDeleteProcessor.name);

  constructor(private readonly threadsService: ThreadsService) {
    super();
  }

  async process(job: Job<ThreadDeleteJobData>): Promise<void> {
    this.logger.log(
      `[thread-delete] processing thread=${job.data.threadId} mailbox=${job.data.mailboxId}`,
    );
    await this.threadsService.processQueuedThreadDelete(job.data);
  }
}
