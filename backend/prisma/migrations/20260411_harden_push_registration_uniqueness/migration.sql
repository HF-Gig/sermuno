DROP INDEX IF EXISTS "push_registrations_registrationKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "push_registrations_org_user_provider_key_unique"
ON "push_registrations" ("organizationId", "userId", "provider", "registrationKey");

CREATE INDEX IF NOT EXISTS "push_registrations_provider_registrationKey_idx"
ON "push_registrations" ("provider", "registrationKey");
