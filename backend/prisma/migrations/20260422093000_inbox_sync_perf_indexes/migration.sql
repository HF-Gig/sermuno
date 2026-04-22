CREATE INDEX IF NOT EXISTS "messages_mailboxId_messageId_deletedAt_idx"
ON "messages"("mailboxId", "messageId", "deletedAt");

CREATE INDEX IF NOT EXISTS "messages_mailboxId_folderId_deletedAt_imapUid_idx"
ON "messages"("mailboxId", "folderId", "deletedAt", "imapUid");
