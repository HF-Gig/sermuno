-- CreateTable
CREATE TABLE "thread_note_mentions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "mentionedUserId" TEXT NOT NULL,
    "mentionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_note_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "thread_note_mentions_organizationId_mentionKey_idx" ON "thread_note_mentions"("organizationId", "mentionKey");

-- CreateIndex
CREATE INDEX "thread_note_mentions_mentionedUserId_createdAt_idx" ON "thread_note_mentions"("mentionedUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "thread_note_mentions_noteId_mentionedUserId_key" ON "thread_note_mentions"("noteId", "mentionedUserId");

-- AddForeignKey
ALTER TABLE "thread_note_mentions" ADD CONSTRAINT "thread_note_mentions_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "thread_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_note_mentions" ADD CONSTRAINT "thread_note_mentions_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
