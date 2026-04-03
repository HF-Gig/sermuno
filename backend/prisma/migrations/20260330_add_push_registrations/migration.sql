CREATE TYPE "PushProvider" AS ENUM ('web_push', 'fcm');

CREATE TABLE "push_registrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "PushProvider" NOT NULL,
    "registrationKey" TEXT NOT NULL,
    "endpoint" TEXT,
    "token" TEXT,
    "subscription" JSONB,
    "deviceName" TEXT,
    "browserName" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_registrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_registrations_registrationKey_key" ON "push_registrations"("registrationKey");
CREATE INDEX "push_registrations_userId_active_revokedAt_idx" ON "push_registrations"("userId", "active", "revokedAt");
CREATE INDEX "push_registrations_organizationId_provider_active_idx" ON "push_registrations"("organizationId", "provider", "active");

ALTER TABLE "push_registrations" ADD CONSTRAINT "push_registrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_registrations" ADD CONSTRAINT "push_registrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
