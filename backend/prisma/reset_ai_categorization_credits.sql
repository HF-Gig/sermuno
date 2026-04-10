-- Manual credit reset script for AI categorization.
-- Replace the organization ID below when resetting one tenant.

-- Reset a single organization:
-- UPDATE "organizations"
-- SET "aiCategorizationCredits" = 50
-- WHERE "id" = 'your-organization-id';

-- Reset all organizations:
UPDATE "organizations"
SET "aiCategorizationCredits" = 50;
