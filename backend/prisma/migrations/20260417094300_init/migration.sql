-- CreateEnum
CREATE TYPE "AttachmentScanStatus" AS ENUM ('UNSCANNED', 'PENDING', 'CLEAN', 'INFECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'USER');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('lead', 'member');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('trial', 'starter', 'professional', 'enterprise');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'canceled', 'trialing');

-- CreateEnum
CREATE TYPE "MailboxProvider" AS ENUM ('GMAIL', 'OUTLOOK', 'SMTP');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('NEW', 'OPEN', 'PENDING', 'CLOSED', 'ARCHIVED', 'TRASH', 'SNOOZED');

-- CreateEnum
CREATE TYPE "ThreadPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "RuleTrigger" AS ENUM ('INCOMING_EMAIL', 'TICKET_CREATED', 'TICKET_UPDATED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('unknown', 'healthy', 'degraded', 'failed');

-- CreateEnum
CREATE TYPE "ReadStateMode" AS ENUM ('personal', 'shared', 'hybrid');

-- CreateEnum
CREATE TYPE "PushProvider" AS ENUM ('web_push', 'fcm');

-- CreateEnum
CREATE TYPE "NotificationDigestStatus" AS ENUM ('pending', 'processed', 'failed');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "maxMailboxes" INTEGER NOT NULL DEFAULT 1,
    "maxUsers" INTEGER NOT NULL DEFAULT 1,
    "maxStorageGb" INTEGER NOT NULL DEFAULT 1,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "emailFooter" TEXT,
    "enforceMfa" BOOLEAN NOT NULL DEFAULT false,
    "logoUrl" TEXT,
    "notificationSettings" JSONB DEFAULT '{}',
    "aiCategorizationCredits" DECIMAL(10,2) NOT NULL DEFAULT 50,
    "plan" "PlanTier" NOT NULL DEFAULT 'trial',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "preferences" JSONB,
    "last_login" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mfaSecret" TEXT,
    "inviteToken" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "invitedByName" TEXT,
    "avatarUrl" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'email',
    "method" TEXT NOT NULL DEFAULT 'email',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'member',

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailboxes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "provider" "MailboxProvider" NOT NULL,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "imapUser" TEXT,
    "imapPass" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "imapHost" TEXT,
    "imapPort" INTEGER DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT,
    "smtpPort" INTEGER DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "googleAccessToken" TEXT,
    "googleRefreshToken" TEXT,
    "googleTokenExpiresAt" TIMESTAMP(3),
    "oauthProvider" TEXT,
    "oauthAccessToken" TEXT,
    "oauthRefreshToken" TEXT,
    "oauthTokenExpiresAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "healthStatus" "HealthStatus" NOT NULL DEFAULT 'unknown',
    "readStateMode" "ReadStateMode" NOT NULL DEFAULT 'personal',
    "nextRetryAt" TIMESTAMP(3),
    "syncErrorCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncError" TEXT,
    "organizationMailAccountId" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_folders" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "uidValidity" BIGINT,
    "uidNext" BIGINT,
    "highestModSeq" BIGINT,
    "parentId" TEXT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "lastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "mailbox_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mailbox_access" (
    "id" TEXT NOT NULL,
    "mailbox_id" TEXT NOT NULL,
    "user_id" TEXT,
    "team_id" TEXT,
    "can_read" BOOLEAN NOT NULL DEFAULT false,
    "can_send" BOOLEAN NOT NULL DEFAULT false,
    "can_manage" BOOLEAN NOT NULL DEFAULT false,
    "can_set_imap_flags" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mailbox_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT,
    "companyId" TEXT,
    "assignedUserId" TEXT,
    "assignedTeamId" TEXT,
    "slaPolicyId" TEXT,
    "subject" TEXT NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'NEW',
    "priority" "ThreadPriority" NOT NULL DEFAULT 'NORMAL',
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "snoozedUntil" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "previousStatus" TEXT,
    "firstResponseAt" TIMESTAMP(3),
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "messageId" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "to" JSONB NOT NULL,
    "cc" JSONB,
    "bcc" JSONB,
    "subject" TEXT,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "isOutbound" BOOLEAN NOT NULL DEFAULT false,
    "inReplyTo" TEXT,
    "references" JSONB,
    "snippet" TEXT,
    "replyTo" JSONB,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "folderId" TEXT,
    "imapUid" INTEGER,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "scanStatus" "AttachmentScanStatus" NOT NULL DEFAULT 'UNSCANNED',
    "scannerName" TEXT,
    "scannerVersion" TEXT,
    "scannedAt" TIMESTAMP(3),
    "scanFailureReason" TEXT,
    "malwareSignature" TEXT,
    "quarantinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'organization',
    "ownerId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_tags" (
    "threadId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "thread_tags_pkey" PRIMARY KEY ("threadId","tagId")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "fullName" TEXT,
    "additionalEmails" JSONB DEFAULT '[]',
    "lifecycleStage" TEXT NOT NULL DEFAULT 'lead',
    "phone" TEXT,
    "phoneNumbers" JSONB DEFAULT '[]',
    "addresses" JSONB DEFAULT '[]',
    "socialProfiles" JSONB DEFAULT '[]',
    "customFields" JSONB DEFAULT '{}',
    "assignedToUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "lastContactedAt" TIMESTAMP(3),
    "avatarUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "primaryDomain" TEXT,
    "additionalDomains" JSONB DEFAULT '[]',
    "customFields" JSONB DEFAULT '{}',
    "logoUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signatures" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "mailboxId" TEXT,
    "name" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "contentHtml" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'organization',
    "ownerId" TEXT,
    "ownerType" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "variables" JSONB,
    "assignedMailboxIds" JSONB DEFAULT '[]',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT,
    "userId" TEXT,
    "mailboxId" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 2,
    "conditionLogic" TEXT NOT NULL DEFAULT 'AND',
    "trigger" "RuleTrigger" NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "executionMode" TEXT NOT NULL DEFAULT 'merge',
    "timesTriggered" INTEGER NOT NULL DEFAULT 0,
    "lastTriggeredAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizerId" TEXT NOT NULL,
    "syncUserId" TEXT,
    "provider" TEXT,
    "externalId" TEXT,
    "externalUpdatedAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "visibility" TEXT NOT NULL DEFAULT 'default',
    "recurrenceRule" TEXT,
    "recurrenceEnd" TIMESTAMP(3),
    "reminders" JSONB DEFAULT '[]',
    "color" TEXT,
    "linkedThreadId" TEXT,
    "linkedContactId" TEXT,
    "linkedCompanyId" TEXT,
    "templateId" TEXT,
    "meetingProvider" TEXT,
    "meetingId" TEXT,
    "meetingPassword" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "meetingLink" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "location" TEXT,
    "meetingLink" TEXT,
    "variableDefinitions" JSONB DEFAULT '[]',
    "requiredFields" JSONB DEFAULT '[]',
    "invitationTemplate" TEXT,
    "meetingProvider" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_attendees" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "contactId" TEXT,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "rsvpStatus" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "event_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "data" JSONB,
    "resourceId" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "notificationType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "push" BOOLEAN NOT NULL DEFAULT false,
    "desktop" BOOLEAN NOT NULL DEFAULT false,
    "slack" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "quietHoursTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "quietHoursChannels" JSONB NOT NULL DEFAULT '[]',
    "slackWebhookUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "secretKey" TEXT NOT NULL DEFAULT '',
    "headers" JSONB DEFAULT '{}',
    "filterMailboxIds" JSONB DEFAULT '[]',
    "filterTeamIds" JSONB DEFAULT '[]',
    "filterTagIds" JSONB DEFAULT '[]',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "retryDelaySeconds" INTEGER NOT NULL DEFAULT 60,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastTriggeredAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "format" TEXT NOT NULL DEFAULT 'json',
    "resources" JSONB NOT NULL DEFAULT '[]',
    "resourceCounts" JSONB NOT NULL DEFAULT '{}',
    "payload" JSONB,
    "artifactUrl" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "maxDownloads" INTEGER NOT NULL DEFAULT 5,
    "progressPercentage" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "expiresAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "thread_notes_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "scheduled_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "threadId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "rrule" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "subject" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'personal',
    "variables" JSONB DEFAULT '[]',
    "category" TEXT,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targets" JSONB NOT NULL DEFAULT '{}',
    "businessHours" JSONB,
    "holidays" JSONB DEFAULT '[]',
    "escalationRules" JSONB DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "threadsCovered" INTEGER NOT NULL DEFAULT 0,
    "breachesCount" INTEGER NOT NULL DEFAULT 0,
    "complianceRate" DECIMAL(65,30) DEFAULT 1.0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteToken_key" ON "users"("inviteToken");

-- CreateIndex
CREATE INDEX "users_organizationId_deletedAt_idx" ON "users"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_expiresAt_idx" ON "refresh_tokens"("userId", "revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "teams_organizationId_deletedAt_idx" ON "teams"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_userId_teamId_key" ON "team_members"("userId", "teamId");

-- CreateIndex
CREATE INDEX "mailboxes_organizationId_idx" ON "mailboxes"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_folders_mailboxId_name_key" ON "mailbox_folders"("mailboxId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_access_mailbox_id_user_id_key" ON "mailbox_access"("mailbox_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mailbox_access_mailbox_id_team_id_key" ON "mailbox_access"("mailbox_id", "team_id");

-- CreateIndex
CREATE INDEX "threads_organizationId_mailboxId_status_idx" ON "threads"("organizationId", "mailboxId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_messages_imap_uid" ON "messages"("mailboxId", "folderId", "imapUid");

-- CreateIndex
CREATE INDEX "tags_organizationId_deletedAt_idx" ON "tags"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_organizationId_email_key" ON "contacts"("organizationId", "email");

-- CreateIndex
CREATE INDEX "signatures_organizationId_deletedAt_idx" ON "signatures"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "events_organizationId_syncUserId_provider_idx" ON "events"("organizationId", "syncUserId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "events_org_provider_external_sync_user_unique" ON "events"("organizationId", "provider", "externalId", "syncUserId");

-- CreateIndex
CREATE INDEX "calendar_templates_organizationId_deletedAt_idx" ON "calendar_templates"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_notificationType_key" ON "notification_preferences"("userId", "notificationType");

-- CreateIndex
CREATE INDEX "contact_notification_preferences_organizationId_notificatio_idx" ON "contact_notification_preferences"("organizationId", "notificationType");

-- CreateIndex
CREATE UNIQUE INDEX "contact_notification_preferences_userId_contactId_notificat_key" ON "contact_notification_preferences"("userId", "contactId", "notificationType");

-- CreateIndex
CREATE INDEX "push_registrations_userId_active_revokedAt_idx" ON "push_registrations"("userId", "active", "revokedAt");

-- CreateIndex
CREATE INDEX "push_registrations_organizationId_provider_active_idx" ON "push_registrations"("organizationId", "provider", "active");

-- CreateIndex
CREATE INDEX "push_registrations_provider_registrationKey_idx" ON "push_registrations"("provider", "registrationKey");

-- CreateIndex
CREATE UNIQUE INDEX "push_registrations_org_user_provider_key_unique" ON "push_registrations"("organizationId", "userId", "provider", "registrationKey");

-- CreateIndex
CREATE INDEX "notification_digest_items_status_emailDeliveryMode_windowEn_idx" ON "notification_digest_items"("status", "emailDeliveryMode", "windowEnd");

-- CreateIndex
CREATE INDEX "notification_digest_items_userId_notificationType_windowKey_idx" ON "notification_digest_items"("userId", "notificationType", "windowKey");

-- CreateIndex
CREATE INDEX "export_jobs_organizationId_createdAt_idx" ON "export_jobs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "import_jobs_organizationId_createdAt_idx" ON "import_jobs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "thread_note_mentions_organizationId_mentionKey_idx" ON "thread_note_mentions"("organizationId", "mentionKey");

-- CreateIndex
CREATE INDEX "thread_note_mentions_mentionedUserId_createdAt_idx" ON "thread_note_mentions"("mentionedUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "thread_note_mentions_noteId_mentionedUserId_key" ON "thread_note_mentions"("noteId", "mentionedUserId");

-- CreateIndex
CREATE INDEX "email_templates_organizationId_deletedAt_idx" ON "email_templates"("organizationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_folders" ADD CONSTRAINT "mailbox_folders_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_access" ADD CONSTRAINT "mailbox_access_mailbox_id_fkey" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_access" ADD CONSTRAINT "mailbox_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mailbox_access" ADD CONSTRAINT "mailbox_access_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_assignedTeamId_fkey" FOREIGN KEY ("assignedTeamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "mailbox_folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_tags" ADD CONSTRAINT "thread_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_tags" ADD CONSTRAINT "thread_tags_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_templates" ADD CONSTRAINT "calendar_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_templates" ADD CONSTRAINT "calendar_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_templates" ADD CONSTRAINT "calendar_templates_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notification_preferences" ADD CONSTRAINT "contact_notification_preferences_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notification_preferences" ADD CONSTRAINT "contact_notification_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_notification_preferences" ADD CONSTRAINT "contact_notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_registrations" ADD CONSTRAINT "push_registrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_registrations" ADD CONSTRAINT "push_registrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_digest_items" ADD CONSTRAINT "notification_digest_items_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_digest_items" ADD CONSTRAINT "notification_digest_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_digest_items" ADD CONSTRAINT "notification_digest_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_notes" ADD CONSTRAINT "thread_notes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_notes" ADD CONSTRAINT "thread_notes_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_notes" ADD CONSTRAINT "thread_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_note_mentions" ADD CONSTRAINT "thread_note_mentions_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "thread_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_note_mentions" ADD CONSTRAINT "thread_note_mentions_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_mailboxId_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailboxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
