## 1. Push Notifications Implementation

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

