CREATE TABLE "contact_notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "notificationType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "desktop" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_notification_preferences_userId_contactId_notificationType_key" ON "contact_notification_preferences"("userId", "contactId", "notificationType");
CREATE INDEX "contact_notification_preferences_organizationId_notificationType_idx" ON "contact_notification_preferences"("organizationId", "notificationType");

ALTER TABLE "contact_notification_preferences" ADD CONSTRAINT "contact_notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_notification_preferences" ADD CONSTRAINT "contact_notification_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contact_notification_preferences" ADD CONSTRAINT "contact_notification_preferences_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;