## Push Notifications Implementation

### Requirements
- Install FCM or Web Push integration
- Store pushToken per user/device
- Push delivery logic in notification dispatch
- ENABLE_PUSH_NOTIFICATIONS feature flag implementation
- Token registration/revoke endpoints
- Desktop/browser notification channel
- Desktop sound support

### What Was Implemented
- Implemented browser Web Push flow (VAPID config, subscription, backend delivery); FCM modeled in DTO/provider enum but active delivery is Web Push
- Persisted registrations per user/device using `push_registrations` with endpoint, subscription, device/browser metadata, sound setting, and lifecycle fields
- Notification dispatch routes `channel='push'` to push service, sends payload to active registrations, tracks failures, and deactivates stale tokens
- Feature flag `ENABLE_PUSH_NOTIFICATIONS` enforced in dispatch and push service before sending notifications
- Authenticated endpoints for push config/list/register/revoke fully implemented and connected to service logic
- Foreground desktop notifications handled in app context; background handled via service worker push events with click routing
- Optional sound toggle stored locally; sound playback triggered for notifications; service worker respects silent flag

### Key References
- frontend/src/lib/pushNotifications.ts
- backend/src/modules/notifications/push-notifications.service.ts
- backend/src/modules/notifications/dto/notification.dto.ts
- backend/prisma/schema.prisma
- backend/src/jobs/processors/notification-dispatch.processor.ts
- backend/src/config/feature-flags.service.ts
- backend/src/modules/notifications/notifications.controller.ts
- backend/src/modules/notifications/notifications.service.ts
- frontend/src/context/NotificationContext.tsx
- frontend/public/sermuno-push-sw.js

## 2. CalDAV Sync (Section 2.15.5)

### Requirements
- Install & integrate CalDAV client (`tsdav`)
- Calendar discovery (PROPFIND)
- Fetch events (REPORT)
- Parse iCal responses
- Two-way sync (create/update/delete)
- Store credentials per user
- Conflict handling

### What Was Implemented
- Added `tsdav`, implemented client creation & authentication in sync service
- Used `createDAVClient` + `fetchCalendars`, auto-selects stored or VEVENT calendar
- Implemented `fetchCalendarObjects({ timeRange })` for remote events
- Used `node-ical` to parse ICS and map VEVENT fields (uid, title, time, status, attendees, rrule, location, link)
- Inbound sync via `syncCalDav`; outbound create/update via `syncEventToCalDavIfConnected`; delete via `deleteEventFromCalDavIfConnected`
- Stored credentials in `user.preferences` with encryption, including sync metadata, errors, calendar identity, and UI integration
- Conflict handling via `externalUpdatedAt` (last-write-wins), no manual UI

### Key References
- backend/package.json
- backend/src/modules/calendar/calendar-sync.service.ts
- backend/src/modules/calendar/calendar.service.ts
- backend/src/modules/integrations/integrations.service.ts
- backend/src/modules/integrations/integrations.controller.ts
- frontend/src/pages/dashboard/settings/SettingsPage.tsx

## 3. Mention System (Section 2.12)

### Requirements
- Parse @mentions in thread notes (`POST /threads/:id/notes`)
- Resolve @mentions to user IDs
- Trigger `mention` notification when a user is @mentioned
- Return mentioned user IDs in note/message response

### What Was Implemented
- `ThreadsService` extracts `@mention` keys from internal note text and resolves active organization users by email local-part
- Mention links are persisted in `thread_note_mentions` and returned as `mentionedUsers` in note responses
- Mention dispatch creates `type='mention'` notifications for newly mentioned users and skips self-mentions
- Inbox UI consumes `mentionedUsers` from internal note responses and renders mention chips in the thread view

### Key References
- backend/src/modules/threads/threads.service.ts
- backend/src/modules/notifications/notifications.service.ts
- backend/prisma/schema.prisma
- frontend/src/pages/dashboard/inbox/InboxPage.tsx

## 4. Virus Scanning on Attachments (Section 2.17)

### Requirements
- Integrate antivirus/malware scanning (ClamAV or similar)
- Scan attachments on upload (before storing in S3)
- Optional scan on download
- Quarantine or reject infected files
- Log scan results

### What Was Implemented
- Integrated ClamAV via `AttachmentVirusScannerService` and wired it into attachment scan workflows
- Implemented scan-on-upload for direct uploads and S3 staged (presign + confirm) uploads
- Enforced download gate to block quarantined/infected files with optional scan-on-download support
- Implemented quarantine system with status states: `INFECTED`, `FAILED`, `CLEAN`
- Logged scan results and malware detections (`attachment.scan.infected`) in audit logs

### Key References
- backend/src/modules/attachments/attachment-virus-scanner.service.ts
- backend/src/modules/attachments/attachment-scan.service.ts
- backend/src/modules/attachments/attachments.controller.ts
- backend/prisma/schema.prisma
- frontend/src/lib/attachmentUploads.ts


## 5. Provider-Specific Rate Limiting (Section 3.2)

### Requirements
- Implement token bucket rate limiter per provider
- Detect provider based on mailbox host/domain
- Apply batch size limits per provider
- Add delay between requests per provider
- Enforce provider-specific rate caps
- Make configuration adjustable via env/config

### What Was Implemented
- Implemented provider detection using mailbox provider, OAuth provider, host fragments, and domain
- Built provider policy table with defined defaults (Gmail, Outlook 365, Strato/Ionos, Yahoo, Default)
- Implemented token bucket rate limiter with per-provider buckets, refill logic, and enforced delays
- Applied rate limiting in email sync processor before IMAP/Outlook network calls
- Enforced batch size limits and chunking for streaming mode
- Made all provider configurations adjustable via environment variables and config mapping

### Key References
- backend/src/jobs/processors/email-sync-provider-policy.ts
- backend/src/jobs/processors/email-sync.processor.ts
- backend/src/config/configuration.ts
- backend/.env.example

## 6. Audit Logging (Section 5)

### Requirements
- Log all missing audit actions (MARK_READ, MARK_UNREAD, MOVE_FOLDER, TAG_ADD, TAG_REMOVE, ASSIGN, STATUS_CHANGE, NOTE_ADD, REPLY_SENT, FORWARD_SENT, MAILBOX_CREATED, MAILBOX_DELETED, SETTINGS_UPDATED, CALENDAR_EVENT_CREATED, CALENDAR_INVITE_SENT)
- Ensure each audit entry includes: action, entityType, entityId, previousValue, newValue
- Capture request metadata: userId, ipAddress, userAgent
- Inject audit service and request context into all relevant services

### What Was Implemented
- Added audit logs for message read/unread flows including previous/new values and request metadata
- Implemented audit logging for message move (folder change) operations
- Added audit logs for thread tag add/remove flows with request metadata
- Implemented audit logging for thread assignment including previous/new assignment values
- Added audit logs across all thread status-changing flows (update, bulkUpdate, archive, unarchive, snooze, unsnooze)
- Implemented audit logging for thread note creation
- Added audit logs for reply sent flow after successful send
- Implemented audit logs for mailbox create and delete flows with request metadata
- Added audit logging for organization settings updates including previous/new values
- Implemented audit logs for calendar event creation with `entityType='calendar_event'`
- Added audit logging for calendar invite sending
- Built shared request metadata extractor and wired it across all audited controllers/services
- Implemented forward flow with dedicated audit logging

### Key References
- backend/src/modules/messages/messages.service.ts
- backend/src/modules/messages/messages.controller.ts
- backend/src/modules/threads/threads.service.ts
- backend/src/modules/threads/threads.controller.ts
- backend/src/modules/threads/dto/thread.dto.ts
- backend/src/modules/mailboxes/mailboxes.service.ts
- backend/src/modules/mailboxes/mailboxes.controller.ts
- backend/src/modules/organizations/organizations.service.ts
- backend/src/modules/organizations/organizations.controller.ts
- backend/src/modules/calendar/calendar.service.ts
- backend/src/modules/calendar/calendar.controller.ts
- backend/src/common/http/request-meta.ts

## 7. Backpressure Monitoring (Section 3.4)

### Requirements
- Implement memory backpressure monitoring in job processors
- Pause or slow processing when memory usage is high
- Implement smart backoff based on error patterns
- Increase delays on error spikes and reduce when stable
- Add feature flags (ENABLE_BACKPRESSURE, ENABLE_SMART_BACKOFF)

### What Was Implemented
- Implemented feature flags `ENABLE_BACKPRESSURE` and `ENABLE_SMART_BACKOFF` with runtime control via feature flag service/API
- Added memory backpressure monitoring using V8 heap usage ratio (`heapUsed / heapLimit`) with configurable thresholds and bounded throttling
- Applied adaptive throttling in email sync processor before provider request acquisition, during paging loops, and between message chunks
- Implemented smart backoff with per-mailbox in-memory state tracking errors and successes
- Increased delay dynamically on failures and reduced delay gradually on successful operations
- Integrated adaptive retry scheduling using smart backoff when enabled, while preserving default retry behavior when disabled
- Made all tuning parameters configurable via environment variables (`BACKPRESSURE_*`, `SMART_BACKOFF_*`)

### Key References
- backend/src/config/feature-flags.service.ts
- backend/src/config/configuration.ts
- backend/src/jobs/processors/email-sync-adaptive-throttle.ts
- backend/src/jobs/processors/email-sync.processor.ts
- backend/.env.example

## 8. Export: Download Limit, Progress & Checksum (Section 2.19)

### 8a. Download Limit

#### Requirements
- Limit downloads per export
- Default maximum should be 5 downloads
- Block downloads after limit is reached
- Count only successful downloads

#### What Was Implemented
- Added `downloadCount` and `maxDownloads` fields to `ExportJob`
- Set default `maxDownloads` to `5`
- Implemented atomic download reservation using `downloadCount < maxDownloads`
- Blocked the 6th download attempt with `403`
- Added rollback on stream failure so only successful downloads are counted

#### Key References
- backend/prisma/schema.prisma
- backend/prisma/migrations/20260407_add_export_job_limits_progress_checksum/migration.sql
- backend/src/modules/export-import/export-import.service.ts
- backend/src/modules/export-import/export-import.controller.ts
- backend/src/modules/export-import/export-import-public.controller.ts
- test/backend/src/modules/export-import/export-import.spec.ts

### 8b. Progress Percentage

#### Requirements
- Track export progress from 0–100
- Store progress in `ExportJob`
- Expose progress in API
- Support frontend progress display

#### What Was Implemented
- Added `progressPercentage` field to `ExportJob`
- Implemented deterministic progress milestones (`10 -> 40 -> 80 -> 95 -> 100`)
- Returned progress fields through the API
- Added frontend progress bar and percentage display
- Enabled auto-refresh while export jobs are `pending` or `processing`

#### Key References
- backend/prisma/schema.prisma
- backend/prisma/migrations/20260407_add_export_job_limits_progress_checksum/migration.sql
- backend/src/modules/export-import/export-import.service.ts
- backend/src/modules/export-import/export-import.controller.ts
- frontend/src/pages/dashboard/export/ExportPage.tsx
- test/backend/src/modules/export-import/export-import.spec.ts

### 8c. SHA256 Checksum

#### Requirements
- Generate SHA256 checksum for export file
- Store checksum in `ExportJob`
- Return checksum in API responses
- Include checksum in download response headers

#### What Was Implemented
- Generated SHA256 checksum from the final export artifact bytes
- Stored checksum in the `checksum` field
- Returned checksum in export APIs for frontend display/copy
- Included `X-Export-Checksum-SHA256` in download responses
- Added explicit attachment filename and extension via `Content-Disposition`

#### Key References
- backend/prisma/schema.prisma
- backend/prisma/migrations/20260407_add_export_job_limits_progress_checksum/migration.sql
- backend/src/modules/export-import/export-import.service.ts
- backend/src/modules/export-import/export-import.controller.ts
- backend/src/modules/export-import/export-import-public.controller.ts
- frontend/src/pages/dashboard/export/ExportPage.tsx
- test/backend/src/modules/export-import/export-import.spec.ts

## 9. Kill Switches (Section 3.4)

### Requirements
- Add runtime kill switches (`DISABLE_*`) for critical systems
- Ensure kill switches immediately stop operations without restart
- Check kill switches inside job processors before each operation
- Skip execution, log warning, and prevent processing when active
- Allow runtime toggling via feature flags service/API

### What Was Implemented
- Implemented runtime kill switches:
  - `DISABLE_IMAP_SYNC`
  - `DISABLE_SMTP_SEND`
  - `DISABLE_RULES_EVALUATION`
  - `DISABLE_THREADING`
- Added strict validation in feature flags API (`PATCH /feature-flags`) to reject unknown keys with `400`
- `DISABLE_IMAP_SYNC`:
  - Blocks mailbox sync trigger endpoints (`503`)
  - Prevents OAuth auto-sync enqueue
  - Enforced in email-sync processor with safe early stop and warning logs
- `DISABLE_SMTP_SEND`:
  - Blocks user send flows (messages, replies, forwards) with `503`
  - Skips SMTP dispatch across processors (notification, scheduled messages, email send, invite emails)
- `DISABLE_RULES_EVALUATION`:
  - Stops rules engine execution at entry and per-rule processing
  - Fully bypasses rules during inbound sync
- `DISABLE_THREADING`:
  - Disables automatic threading in inbound email sync
  - Skips thread match/create logic with warning logs
- Kill switches are evaluated at runtime via feature-flags service and applied instantly without restart
- Safe skip/block behavior implemented with contextual warning logs for observability

### Key References
- backend/src/config/feature-flags.service.ts
- backend/src/modules/feature-flags/feature-flags.controller.ts
- backend/src/modules/mailboxes/mailboxes.service.ts
- backend/src/modules/auth/auth.service.ts
- backend/src/modules/messages/messages.service.ts
- backend/src/modules/threads/threads.service.ts
- backend/src/modules/users/users.service.ts
- backend/src/modules/rules/rules-engine.service.ts
- backend/src/jobs/processors/email-sync.processor.ts
- backend/src/jobs/processors/email-send.processor.ts
- backend/src/jobs/processors/scheduled-messages.processor.ts
- backend/src/jobs/processors/notification-dispatch.processor.ts
- backend/.env.example

## 10. Webhook Event: calendar.rsvp_received (Section 2.18)

### Requirements
- Emit `calendar.rsvp_received` webhook event
- Trigger webhook after RSVP processing
- Support both API RSVP and iCal ingestion paths
- Include attendee info, event info, and response status in payload
- Ensure consistency with existing calendar webhook events

### What Was Implemented
- Added webhook event types:
  - `calendar.event_created`
  - `calendar.event_updated`
  - `calendar.event_cancelled`
  - `calendar.rsvp_received`
- Implemented webhook dispatch for calendar create/update/delete flows
- Implemented RSVP webhook firing in both:
  - authenticated RSVP API (`rsvp`)
  - iCal reply ingestion (`ingestRsvp`)
- Payload includes:
  - event details
  - attendee details
  - response status
  - source (API or iCal)
  - occurrence timestamp
- Added compatibility aliases for legacy `calendar_event.*` webhook names

### Key References
- backend/src/modules/calendar/calendar.service.ts
- backend/src/modules/webhooks/webhooks.service.ts
- frontend/src/pages/dashboard/webhooks/WebhooksPage.tsx

## 10A. Skeleton Loading

### What Was Implemented
- Built shared adaptive skeleton primitives for table, list, and grid layouts
- Implemented adaptive row/item count logic using reusable hooks/utilities
- Replaced hardcoded loading loops in key dashboard pages and components
- Added skeleton hardcoding guard script to enforce best practices
- Ensured consistency across frontend codebases (root and mirrored structure)

### Key References
- frontend/src/components/ui/Skeleton.tsx
- frontend/src/hooks/useAdaptiveCount.ts
- frontend/scripts/check-skeleton-hardcoding.mjs
- frontend/src/components/skeletons/

## 11. AI Categorization (Section 3.4)

### Requirements
- Implement feature flag `FEATURE_AI_CATEGORIZATION`
- Automatically categorize incoming emails during sync
- Integrate AI model for categorization
- Persist categorization results to thread/tag system
- Ensure safe fallback when feature is disabled or fails

### What Was Implemented
- Implemented runtime feature flag `FEATURE_AI_CATEGORIZATION` via feature-flags service/API
- Built AI categorization service using Anthropic Claude with configurable model, timeout, and input limits
- Integrated categorization into inbound email sync processor (IMAP + Outlook flows)
- Persisted categorization output using existing tagging system (`tags` + `thread_tags`) with `AI:*` labels
- Added per-organization credit system (`aiCategorizationCredits`) with configurable deduction per request
- Implemented safe fallback behavior: skips categorization when disabled, no API key, insufficient credits, or provider failure without breaking sync

### Key References
- backend/src/config/feature-flags.service.ts
- backend/src/config/configuration.ts
- backend/src/modules/ai-categorization/ai-categorization.service.ts
- backend/src/jobs/processors/email-sync.processor.ts
- backend/src/jobs/jobs.module.ts
- backend/prisma/schema.prisma
- backend/prisma/migrations/20260410_add_ai_categorization_credits/migration.sql
- backend/.env
- backend/.env.example

## 12. Notification: contact_activity Type (Section 2.12)

### Requirements
- Support `contact_activity` notification type
- Trigger notifications on contact-related activity (email, thread updates, contact changes)
- Allow per-contact enable/disable configuration
- Allow per-contact channel selection (in-app, email, push, desktop)
- Ensure preferences are respected during notification dispatch

### What Was Implemented
- Implemented `contact_activity` as an active notification type in the notifications pipeline
- Added runtime triggers for:
  - contact create/update activity
  - outbound email activity linked to a resolved contact (`email_sent`)
  - thread updates linked to a resolved contact (`thread_updated`)
- Implemented per-contact notification preference storage
- Enforced per-contact enable/disable logic during dispatch resolution
- Enforced per-contact channel selection (in-app, email, push, desktop overrides)
- Added contact-scoped API endpoints for managing notification preferences
- Removed dependency on profile-level `contactIds` filtering in favor of dedicated contact-level controls

### Key References
- backend/prisma/schema.prisma
- backend/prisma/migrations/20260409_add_contact_notification_preferences/migration.sql
- backend/src/modules/notifications/notifications.service.ts
- backend/src/modules/crm/crm.controller.ts
- backend/src/modules/crm/crm.service.ts
- backend/src/modules/crm/dto/crm.dto.ts
- backend/src/modules/threads/threads.service.ts
- backend/src/jobs/processors/email-sync.processor.ts
- frontend/src/pages/dashboard/contacts/ContactsPage.tsx
- frontend/src/pages/dashboard/profile/ProfilePage.tsx

## 13. Logging Configuration (Section 4.2)

### Requirements
- Support `LOG_LEVEL` (debug/info/warn/error) to control logger levels
- Support `LOG_FORMAT` (pretty/json) to switch output format
- Validate environment values and fail on invalid configuration
- Provide sensible defaults aligned with spec
- Ensure configuration is applied at runtime

### What Was Implemented
- Implemented `LOG_LEVEL` mapping to effective NestJS log levels:
  - `debug` → `error,warn,log,debug`
  - `info` → `error,warn,log`
  - `warn` → `error,warn`
  - `error` → `error`
- Implemented `LOG_FORMAT` handling:
  - `pretty` → human-readable Nest logs
  - `json` → structured JSON logging
- Added strict validation: invalid `LOG_LEVEL` or `LOG_FORMAT` values fail application startup with clear errors
- Set explicit defaults:
  - `LOG_LEVEL=info`
  - `LOG_FORMAT=pretty`
- Ensured environment variables are defined and available in both runtime and example env files

### Key References
- backend/src/main.ts
- backend/src/logging/logging-config.ts
- backend/src/logging/json-logger.service.ts
- backend/src/config/configuration.ts
- backend/.env
- backend/.env.example
- test/backend/src/logging/logging-config.spec.ts
- test/backend/src/logging/json-logger.service.spec.ts