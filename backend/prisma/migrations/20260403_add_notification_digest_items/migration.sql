-- CreateEnum
CREATE TYPE "NotificationDigestStatus" AS ENUM ('pending', 'processed', 'failed');

-- CreateTable
CREATE TABLE "notification_digest_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT,
    "notificationType" TEXT NOT NULL,
    "emailDeliveryMode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "resourceId" TEXT,
    "data" JSONB,
    "windowKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" "NotificationDigestStatus" NOT NULL DEFAULT 'pending',
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_digest_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_digest_items_status_emailDeliveryMode_windowEnd_idx" ON "notification_digest_items"("status", "emailDeliveryMode", "windowEnd");

-- CreateIndex
CREATE INDEX "notification_digest_items_userId_notificationType_windowKey_idx" ON "notification_digest_items"("userId", "notificationType", "windowKey");

-- AddForeignKey
ALTER TABLE "notification_digest_items" ADD CONSTRAINT "notification_digest_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_digest_items" ADD CONSTRAINT "notification_digest_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_digest_items" ADD CONSTRAINT "notification_digest_items_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
