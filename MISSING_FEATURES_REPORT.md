# SERMUNO - Missing Features Report

## Based on: Unidesk Developer Summary v2.0 (February 6, 2026)

**Date:** March 30, 2026
**Status:** Code Review Complete - Items Below Need Implementation

---

## 1. PUSH & DESKTOP NOTIFICATIONS (Section 2.12)

The spec requires **4 notification channels**: in_app, email, push, desktop.
Currently only **in_app** and **email** are working.

### What's missing:

**Push Notifications:**

- No Firebase Cloud Messaging (FCM) or Web Push API integration
- No `pushToken` field stored per user/device
- No push delivery logic in notification dispatch
- Feature flag `ENABLE_PUSH_NOTIFICATIONS` exists but has zero implementation behind it
- Needs: FCM setup, token registration endpoint, push delivery in notification-dispatch processor

**Desktop Notifications:**

- No desktop/browser notification channel implementation
- No sound notification support
- Spec requires: desktop browser notifications with optional sound

### Spec Reference:

```
Channel    | Details
push       | Mobile push (iOS/Android/Web) via pushToken
desktop    | Desktop browser notifications with optional sound
```

---

## 2. CalDAV SYNC (Section 2.15.5)

The `syncCalDav()` method exists but is a **complete stub** that returns `{ synced: 0, deleted: 0 }`.

### What's missing:

- No actual CalDAV PROPFIND/REPORT implementation
- No tsdav or caldav-simple library integration
- No two-way sync with CalDAV providers (Apple Calendar, Nextcloud, etc.)
- No CalDAV credential storage

### Spec Reference:

```
Provider   | Method          | Details
CalDAV     | CalDAV protocol | For other providers (Apple, Nextcloud, etc.)
```

### What needs to be built:

- Install and integrate tsdav or caldav-simple library
- Implement PROPFIND to discover calendars
- Implement REPORT to fetch events
- Parse iCal format from CalDAV responses
- Two-way sync: create/update/delete events on CalDAV server
- Store CalDAV credentials (URL, username, password) per user
- Conflict handling (last-write-wins or manual)

---

## 3. @MENTION SYSTEM (Section 2.12)

The notification type `mention` is defined but there is NO actual mention functionality.

### What's missing:

- No @mention parsing in thread notes or messages
- No UI or API logic to detect `@username` in text
- No linking of mentions to users
- No mention notification triggering when someone is @mentioned
- The notification type exists but is never triggered by anything

### What needs to be built:

- Parse @mentions in thread notes (POST /threads/:id/notes)
- Resolve @mentions to user IDs
- Trigger `mention` notification when a user is @mentioned
- Return mentioned user IDs in note/message response

---

## 4. VIRUS SCANNING ON ATTACHMENTS (Section 2.17)

The spec states: "Optional: scan attachments on upload/download"

### What's missing:

- No antivirus/malware scanning integration at all
- No ClamAV or similar integration
- No scan-on-upload or scan-on-download logic
- No quarantine mechanism for infected files

### What needs to be built:

- Integration with ClamAV (or similar) for attachment scanning
- Scan trigger on upload (before storing in S3)
- Scan trigger on download (optional)
- Quarantine/reject infected files
- Logging of scan results

---

## 5. PROVIDER-SPECIFIC RATE LIMITING (Section 3.2)

There is NO provider-specific rate limiting. Only global rate limiting (100 req/60s) exists.

### What's missing:

The entire token bucket rate limiting system per email provider:

```
Provider      | Batch size | Delay   | Rate limit
Gmail         | 5000       | 100ms   | 300 cap (3.33/s)
Outlook 365   | 2000       | 500ms   | 150 cap (1.67/s)
Strato/Ionos  | 500        | 1000ms  | 60 cap (0.5/s)
Yahoo         | 1500       | 400ms   | Moderate
Default       | 1000       | 250ms   | 100 cap (1/s)
```

### What needs to be built:

- Token bucket rate limiter per provider
- Provider detection based on mailbox host/domain
- Batch size limits per provider in email-sync processor
- Delay between requests per provider
- Rate limit cap enforcement per provider
- Configuration should be adjustable (env vars or config file)

---

## 6. AUDIT LOGGING - SEVERELY INCOMPLETE (Section 5)

This is the **biggest gap**. The spec requires 18+ specific audit actions but only ~5 are actually logged.

### Currently logged:

- USER_INVITED ✅
- USER_CREATED ✅
- USER_DEACTIVATED ✅
- USER_UPDATED ✅
- MAILBOX_DISCONNECTED ✅
- rule.triggered ✅

### NOT logged (all missing):

| Audit Action           | Description                       | Where to add          |
| ---------------------- | --------------------------------- | --------------------- |
| MARK_READ              | Message marked as read            | Messages service      |
| MARK_UNREAD            | Message marked as unread          | Messages service      |
| MOVE_FOLDER            | Message moved to different folder | Messages service      |
| TAG_ADD                | Tag added to thread               | Threads service       |
| TAG_REMOVE             | Tag removed from thread           | Threads service       |
| ASSIGN                 | Thread assigned to user/team      | Threads service       |
| STATUS_CHANGE          | Thread status changed             | Threads service       |
| NOTE_ADD               | Note added to thread              | Threads service       |
| REPLY_SENT             | Reply sent                        | Threads service       |
| FORWARD_SENT           | Forward sent                      | Threads service       |
| MAILBOX_CREATED        | Mailbox created                   | Mailboxes service     |
| MAILBOX_DELETED        | Mailbox deleted                   | Mailboxes service     |
| SETTINGS_UPDATED       | Settings changed                  | Organizations service |
| CALENDAR_EVENT_CREATED | Calendar event created            | Calendar service      |
| CALENDAR_INVITE_SENT   | Calendar invitation sent          | Calendar service      |

### Spec Reference:

```
Per log entry: action, entityType (message/thread/mailbox/user/team/rule/
organization/calendar_event), entityId, previousValue, newValue, userId,
ipAddress, userAgent, createdAt.
```

### What needs to be built:

- Add audit log calls in EVERY service method listed above
- Each audit entry must include: action, entityType, entityId, previousValue, newValue
- Must capture userId, ipAddress, userAgent from request context
- This means injecting audit service + request context into all affected services

---

## 7. BACKPRESSURE MONITORING (Section 3.4)

### Spec requires:

```
Dynamic | ENABLE_BACKPRESSURE | Memory backpressure monitoring
Dynamic | ENABLE_SMART_BACKOFF | Smart backoff on errors
```

### What's missing:

- No memory backpressure monitoring system
- No smart backoff mechanism that adapts based on error patterns
- These are operational features for production stability

### What needs to be built:

- Memory usage monitoring in job processors
- Pause/slow down processing when memory usage is high
- Smart backoff: increase delays when errors spike, decrease when stable
- Feature flags for both (ENABLE_BACKPRESSURE, ENABLE_SMART_BACKOFF)

---

## 8. EXPORT: DOWNLOAD LIMIT, PROGRESS & CHECKSUM (Section 2.19)

Export has expiration (7 days) but is missing 3 features from the spec.

### 8a. Download Limit - MISSING

```
Spec: "Download limit: Default max 5 downloads per export"
```

- No `downloadCount` field tracking how many times an export was downloaded
- No `maxDownloads` field (default 5) to limit downloads
- No enforcement blocking downloads after limit is reached

### 8b. Progress Percentage - MISSING

```
Spec: "Progress: progressPercentage (0-100) for large exports"
```

- No `progressPercentage` field in ExportJob model
- No progress updates during export processing
- No way for frontend to show export progress

### 8c. SHA256 Checksum - MISSING

```
Spec: "Checksum: SHA256 checksum of the export file"
```

- No checksum generation after export file is created
- No `checksum` field in ExportJob model
- No checksum verification on download

### What needs to be built:

- Add `downloadCount`, `maxDownloads`, `progressPercentage`, `checksum` fields to ExportJob model
- Update Prisma schema + create migration
- Track download count, block after max reached
- Update progress during export processing (0-100)
- Generate SHA256 hash after file creation, store in DB
- Return checksum in API response for verification

---

## 9. KILL SWITCHES (Section 3.4)

Feature flags exist as `ENABLE_*` but the spec requires specific **kill switches** (DISABLE\_\*) for emergency shutdown.

### What's missing:

| Kill Switch              | Function                           | Status  |
| ------------------------ | ---------------------------------- | ------- |
| DISABLE_IMAP_SYNC        | Immediately stop all IMAP sync     | Missing |
| DISABLE_SMTP_SEND        | Immediately stop all email sending | Missing |
| DISABLE_RULES_EVALUATION | Immediately stop rule processing   | Missing |
| DISABLE_THREADING        | Immediately stop threading worker  | Missing |

### Difference from feature flags:

- Feature flags = enable/disable features at startup
- Kill switches = **immediately** halt running processes in production emergencies
- Kill switches must be checked INSIDE job processors before each operation
- Must be readable at runtime without restart

### What needs to be built:

- Add DISABLE\_\* environment variables to feature-flags service
- Check kill switches inside each job processor (email-sync, email-send, rules-engine)
- When kill switch is active: skip job, log warning, do not process
- Should be toggleable without application restart (read from env/Redis each time)

---

## 10. WEBHOOK EVENT: calendar.rsvp_received (Section 2.18)

### What's missing:

- The webhook events list includes calendar events (created/updated/deleted) but `calendar.rsvp_received` is NOT fired as a webhook event
- When an RSVP is received and processed in calendar.service.ts, it broadcasts a WebSocket event but does NOT trigger the webhook system

### Spec Reference:

```
Events: ... calendar.event_created/updated/cancelled, calendar.rsvp_received
```

### What needs to be built:

- After processing an RSVP response in `ingestRsvp()`, call `webhooksService.fireEvent('calendar.rsvp_received', payload)`
- Include attendee info, event info, and response status in webhook payload

---

## 11. AI CATEGORIZATION (Section 3.4)

### What's missing:

- Feature flag `FEATURE_AI_CATEGORIZATION` is mentioned in the spec
- No AI categorization feature flag or implementation exists
- This would automatically categorize incoming emails

### Spec Reference:

```
Feature flag | FEATURE_AI_CATEGORIZATION | Enable/disable AI categorization
```

---

## 12. NOTIFICATION: contact_activity TYPE (Section 2.12)

### Spec requires:

```
contact_activity | Per contact enable/disable, channel selection
```

### What to verify:

- The notification type `contact_activity` exists (it does in the type definitions)
- But verify it is actually TRIGGERED when contacts have activity (new email, thread update)
- Per-contact enable/disable configuration

---

## 13. LOGGING CONFIGURATION (Section 4.2)

### Spec requires:

```
Logging: LOG_LEVEL (debug/info/warn/error), LOG_FORMAT (pretty/json)
```

### What to verify:

- LOG_LEVEL environment variable controls NestJS logger level
- LOG_FORMAT switches between pretty (development) and JSON (production) output
- Both are configurable via environment variables

---

# SUMMARY TABLE

| #   | Feature                                    | Severity | Effort |
| --- | ------------------------------------------ | -------- | ------ |
| 1   | Push & Desktop Notifications               | HIGH     | Large  |
| 2   | CalDAV Sync                                | MEDIUM   | Large  |
| 3   | @Mention System                            | MEDIUM   | Medium |
| 4   | Virus Scanning                             | LOW      | Medium |
| 5   | Provider-Specific Rate Limiting            | HIGH     | Medium |
| 6   | Audit Logging (12+ missing actions)        | HIGH     | Medium |
| 7   | Backpressure & Smart Backoff               | MEDIUM   | Medium |
| 8   | Export: Download Limit, Progress, Checksum | MEDIUM   | Small  |
| 9   | Kill Switches (DISABLE\_\*)                | HIGH     | Small  |
| 10  | Webhook: calendar.rsvp_received            | LOW      | Small  |
| 11  | AI Categorization Feature Flag             | LOW      | Small  |
| 12  | Contact Activity Notifications - Verify    | LOW      | Verify |
| 13  | Logging Configuration - Verify             | LOW      | Verify |

**Critical items to fix first:** #7 (Audit Logging), #5 (Provider Rate Limiting), #8 (Kill Switches), #1 (Push/Desktop Notifications)

---

_This report was generated by comparing the full Sermuno codebase against the Unidesk Developer Summary v2.0 document. Every section of the original spec (2.1 through 5) was reviewed._
