export const THREAD_DELETE_QUEUE = 'thread-delete';

export interface ThreadDeleteJobData {
  threadId: string;
  organizationId: string;
  mailboxId: string;
  requestedByUserId?: string | null;
  ipAddress?: string;
  userAgent?: string;
}
