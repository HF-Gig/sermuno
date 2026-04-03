import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Event, type EventAttendee, type User } from '@prisma/client';
import { ICalAttendeeStatus, ICalEventStatus } from 'ical-generator';
import * as crypto from 'crypto';
import * as https from 'https';
import * as ical from 'node-ical';
import { createDAVClient, type DAVCalendar, type DAVCalendarObject } from 'tsdav';
import { PrismaService } from '../../database/prisma.service';
import { IcsGeneratorService } from './ics-generator.service';

const CALDAV_SYNC_PAST_DAYS = 30;
const CALDAV_SYNC_FUTURE_DAYS = 365;

type UserPreferences = Record<string, string>;

interface StoredCalDavConnection {
  url: string;
  username: string;
  password: string;
  calendarUrl: string | null;
  calendarDisplayName: string | null;
}

interface ParsedCalDavAttendee {
  email: string;
  name: string | null;
  rsvpStatus: string;
}

interface ParsedCalDavEvent {
  uid: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  allDay: boolean;
  timezone: string | null;
  status: string;
  location: string | null;
  meetingLink: string | null;
  recurrenceRule: string | null;
  updatedAt: Date;
  attendees: ParsedCalDavAttendee[];
}

export interface SyncGoogleParams {
  userId: string;
  organizationId: string;
  accessToken: string;
}

export interface SyncMicrosoftParams {
  userId: string;
  organizationId: string;
  accessToken: string;
}

export interface SyncCalDavParams {
  userId: string;
  organizationId: string;
  calDavUrl?: string;
  username?: string;
  password?: string;
}

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  location?: string;
  updated?: string;
  recurrence?: string[];
  attendees?: { email?: string; displayName?: string }[];
  conferenceData?: { entryPoints?: { uri?: string }[] };
  hangoutLink?: string;
}

interface MicrosoftCalendarEvent {
  id: string;
  subject?: string;
  body?: { content?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string };
  location?: { displayName?: string };
  lastModifiedDateTime?: string;
  isAllDay?: boolean;
  onlineMeeting?: { joinUrl?: string };
}

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly icsGenerator: IcsGeneratorService,
  ) {}

  async syncGoogle(
    params: SyncGoogleParams,
  ): Promise<{ synced: number; deleted: number }> {
    const { userId, organizationId, accessToken } = params;

    const syncFrom = new Date();
    syncFrom.setDate(syncFrom.getDate() - 30);

    const timeMin = syncFrom.toISOString();
    const path = `/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&singleEvents=true&maxResults=250`;

    let body: string;
    try {
      body = await this.httpsGet('www.googleapis.com', path, {
        Authorization: `Bearer ${accessToken}`,
      });
    } catch (err) {
      this.logger.error(`[sync:google] Failed to fetch events: ${String(err)}`);
      return { synced: 0, deleted: 0 };
    }

    const data = JSON.parse(body) as { items?: GoogleCalendarEvent[] };
    const items = data.items ?? [];

    let synced = 0;
    const seenExternalIds: string[] = [];

    for (const item of items) {
      if (!item.id) continue;
      seenExternalIds.push(item.id);

      const startRaw = item.start?.dateTime ?? item.start?.date ?? '';
      const endRaw = item.end?.dateTime ?? item.end?.date ?? '';
      const startTime = new Date(startRaw);
      const endTime = new Date(endRaw);
      if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) continue;

      const existing = await this.prisma.event.findFirst({
        where: {
          organizationId,
          provider: 'google',
          externalId: item.id,
          syncUserId: userId,
        },
      });

      const externalUpdatedAt = item.updated ? new Date(item.updated) : null;

      if (
        existing?.externalUpdatedAt &&
        externalUpdatedAt &&
        existing.externalUpdatedAt >= externalUpdatedAt
      ) {
        continue;
      }

      const meetingLink =
        item.hangoutLink ??
        item.conferenceData?.entryPoints?.find((entry) =>
          entry.uri?.startsWith('https://'),
        )?.uri;

      const createData: Prisma.EventCreateInput = {
        organization: { connect: { id: organizationId } },
        organizer: { connect: { id: userId } },
        syncUserId: userId,
        provider: 'google',
        externalId: item.id,
        externalUpdatedAt,
        title: item.summary ?? '(No title)',
        description: item.description,
        startTime,
        endTime,
        allDay: !item.start?.dateTime,
        timezone: item.start?.timeZone,
        status: item.status ?? 'confirmed',
        location: item.location,
        meetingLink,
        meetingProvider: meetingLink ? 'google_meet' : null,
        recurrenceRule: item.recurrence?.[0]?.replace(/^RRULE:/, '') ?? null,
      };

      if (existing) {
        await this.prisma.event.update({
          where: { id: existing.id },
          data: {
            externalUpdatedAt,
            title: createData.title,
            description: createData.description,
            startTime,
            endTime,
            allDay: createData.allDay as boolean,
            timezone: createData.timezone,
            status: createData.status as string,
            location: createData.location,
            meetingLink: createData.meetingLink,
            meetingProvider: createData.meetingProvider,
            recurrenceRule: createData.recurrenceRule,
          },
        });
      } else {
        await this.prisma.event.create({ data: createData });
      }
      synced++;
    }

    const deleted = await this.softDeleteAbsent(
      organizationId,
      userId,
      'google',
      seenExternalIds,
    );

    return { synced, deleted };
  }

  async syncMicrosoft(
    params: SyncMicrosoftParams,
  ): Promise<{ synced: number; deleted: number }> {
    const { userId, organizationId, accessToken } = params;

    const syncFrom = new Date();
    syncFrom.setDate(syncFrom.getDate() - 30);
    const startDateTime = syncFrom.toISOString();

    const path = `/v1.0/me/calendarView?startDateTime=${encodeURIComponent(startDateTime)}&endDateTime=${encodeURIComponent(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString())}&$top=250`;

    let body: string;
    try {
      body = await this.httpsGet('graph.microsoft.com', path, {
        Authorization: `Bearer ${accessToken}`,
      });
    } catch (err) {
      this.logger.error(
        `[sync:microsoft] Failed to fetch events: ${String(err)}`,
      );
      return { synced: 0, deleted: 0 };
    }

    const data = JSON.parse(body) as { value?: MicrosoftCalendarEvent[] };
    const items = data.value ?? [];

    let synced = 0;
    const seenExternalIds: string[] = [];

    for (const item of items) {
      if (!item.id) continue;
      seenExternalIds.push(item.id);

      const startRaw = item.start?.dateTime ?? '';
      const endRaw = item.end?.dateTime ?? '';
      const startTime = new Date(startRaw);
      const endTime = new Date(endRaw);
      if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) continue;

      const externalUpdatedAt = item.lastModifiedDateTime
        ? new Date(item.lastModifiedDateTime)
        : null;

      const existing = await this.prisma.event.findFirst({
        where: {
          organizationId,
          provider: 'microsoft',
          externalId: item.id,
          syncUserId: userId,
        },
      });

      if (
        existing?.externalUpdatedAt &&
        externalUpdatedAt &&
        existing.externalUpdatedAt >= externalUpdatedAt
      ) {
        continue;
      }

      const meetingLink = item.onlineMeeting?.joinUrl;

      const createData: Prisma.EventCreateInput = {
        organization: { connect: { id: organizationId } },
        organizer: { connect: { id: userId } },
        syncUserId: userId,
        provider: 'microsoft',
        externalId: item.id,
        externalUpdatedAt,
        title: item.subject ?? '(No title)',
        description: item.body?.content,
        startTime,
        endTime,
        allDay: item.isAllDay ?? false,
        timezone: item.start?.timeZone,
        status: 'confirmed',
        location: item.location?.displayName,
        meetingLink,
        meetingProvider: meetingLink ? 'microsoft_teams' : null,
      };

      if (existing) {
        await this.prisma.event.update({
          where: { id: existing.id },
          data: {
            externalUpdatedAt,
            title: createData.title,
            description: createData.description,
            startTime,
            endTime,
            allDay: createData.allDay as boolean,
            timezone: createData.timezone,
            status: createData.status as string,
            location: createData.location,
            meetingLink: createData.meetingLink,
            meetingProvider: createData.meetingProvider,
          },
        });
      } else {
        await this.prisma.event.create({ data: createData });
      }
      synced++;
    }

    const deleted = await this.softDeleteAbsent(
      organizationId,
      userId,
      'microsoft',
      seenExternalIds,
    );
    return { synced, deleted };
  }

  async syncCalDav(
    params: SyncCalDavParams,
  ): Promise<{ synced: number; deleted: number }> {
    const { userId, organizationId } = params;

    const connectionInput = await this.resolveCalDavConnection(params);
    if (!connectionInput) {
      this.logger.warn(
        `[sync:caldav] Missing credentials for user=${userId} org=${organizationId}`,
      );
      return { synced: 0, deleted: 0 };
    }

    try {
      const client = await this.createCalDavClient(connectionInput);
      const calendar = await this.resolveCalendar(client, connectionInput);
      if (!calendar) {
        await this.persistCalDavMetadata(userId, {
          ...connectionInput,
          calendarUrl: null,
          calendarDisplayName: null,
          lastError: 'No writable CalDAV calendars found.',
        });
        this.logger.warn(
          `[sync:caldav] No calendars found for user=${userId} org=${organizationId}`,
        );
        return { synced: 0, deleted: 0 };
      }

      const remoteObjects = await client.fetchCalendarObjects({
        calendar,
        timeRange: this.buildCalDavTimeRange(),
      });

      let synced = 0;
      const seenExternalIds: string[] = [];

      for (const remoteObject of remoteObjects) {
        const parsed = this.parseCalDavObject(remoteObject);
        if (!parsed) continue;

        seenExternalIds.push(parsed.uid);
        const didUpsert = await this.upsertRemoteCalDavEvent({
          organizationId,
          userId,
          parsed,
        });
        if (didUpsert) synced++;
      }

      const deleted = await this.softDeleteAbsent(
        organizationId,
        userId,
        'caldav',
        seenExternalIds,
        true,
      );

      const outboundSynced = await this.pushUnsyncedLocalEventsToCalDav({
        organizationId,
        userId,
        client,
        calendar,
      });

      await this.persistCalDavMetadata(userId, {
        ...connectionInput,
        calendarUrl: calendar.url,
        calendarDisplayName: this.getCalendarDisplayName(calendar),
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      });

      return {
        synced: synced + outboundSynced,
        deleted,
      };
    } catch (err) {
      await this.persistCalDavMetadata(userId, {
        ...connectionInput,
        lastError: this.stringifyError(err),
      });
      this.logger.error(
        `[sync:caldav] Failed for user=${userId} org=${organizationId}: ${this.stringifyError(err)}`,
      );
      return { synced: 0, deleted: 0 };
    }
  }

  async syncEventToCalDavIfConnected(params: {
    eventId: string;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    const { eventId, userId, organizationId } = params;

    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId },
      include: { attendees: true },
    });

    if (!event) return;
    if (event.provider && event.provider !== 'caldav') return;
    if (event.status === 'cancelled') return;

    const organizer = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!organizer) return;

    const connection = await this.getStoredCalDavConnection(userId);
    if (!connection) return;

    try {
      const client = await this.createCalDavClient(connection);
      const calendar = await this.resolveCalendar(client, connection);
      if (!calendar) {
        await this.persistCalDavMetadata(userId, {
          ...connection,
          lastError: 'No writable CalDAV calendars found.',
        });
        return;
      }

      const uid = event.externalId ?? event.id;
      const remoteObject = await this.findCalDavObjectByUid(client, calendar, uid);
      const iCalString = this.buildCalDavIcs({
        event,
        attendees: event.attendees,
        organizer,
        uid,
      });

      if (remoteObject) {
        remoteObject.data = iCalString;
        await client.updateCalendarObject({ calendarObject: remoteObject });
      } else {
        await client.createCalendarObject({
          calendar,
          iCalString,
          filename: `${this.sanitizeCalendarObjectFilename(uid)}.ics`,
        });
      }

      await this.prisma.event.update({
        where: { id: event.id },
        data: {
          provider: 'caldav',
          syncUserId: userId,
          externalId: uid,
          externalUpdatedAt: new Date(),
        },
      });

      await this.persistCalDavMetadata(userId, {
        ...connection,
        calendarUrl: calendar.url,
        calendarDisplayName: this.getCalendarDisplayName(calendar),
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      });
    } catch (err) {
      this.logger.error(
        `[sync:caldav] Outbound sync failed for event=${event.id} user=${userId}: ${this.stringifyError(err)}`,
      );
      await this.persistCalDavMetadata(userId, {
        ...connection,
        lastError: this.stringifyError(err),
      });
    }
  }

  async deleteEventFromCalDavIfConnected(params: {
    event: Pick<Event, 'id' | 'externalId' | 'provider'>;
    userId: string;
  }): Promise<void> {
    const { event, userId } = params;

    if (event.provider !== 'caldav' || !event.externalId) return;

    const connection = await this.getStoredCalDavConnection(userId);
    if (!connection) return;

    try {
      const client = await this.createCalDavClient(connection);
      const calendar = await this.resolveCalendar(client, connection);
      if (!calendar) return;

      const remoteObject = await this.findCalDavObjectByUid(
        client,
        calendar,
        event.externalId,
      );
      if (!remoteObject) return;

      await client.deleteCalendarObject({ calendarObject: remoteObject });
      await this.persistCalDavMetadata(userId, {
        ...connection,
        calendarUrl: calendar.url,
        calendarDisplayName: this.getCalendarDisplayName(calendar),
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      });
    } catch (err) {
      this.logger.error(
        `[sync:caldav] Delete failed for event=${event.id} user=${userId}: ${this.stringifyError(err)}`,
      );
      await this.persistCalDavMetadata(userId, {
        ...connection,
        lastError: this.stringifyError(err),
      });
    }
  }

  private async upsertRemoteCalDavEvent(params: {
    organizationId: string;
    userId: string;
    parsed: ParsedCalDavEvent;
  }): Promise<boolean> {
    const { organizationId, userId, parsed } = params;

    const existing = await this.prisma.event.findFirst({
      where: {
        organizationId,
        provider: 'caldav',
        externalId: parsed.uid,
        syncUserId: userId,
      },
    });

    if (
      existing?.externalUpdatedAt &&
      existing.externalUpdatedAt >= parsed.updatedAt
    ) {
      return false;
    }

    if (existing) {
      await this.prisma.event.update({
        where: { id: existing.id },
        data: {
          title: parsed.title,
          description: parsed.description,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          allDay: parsed.allDay,
          timezone: parsed.timezone,
          status: parsed.status,
          location: parsed.location,
          meetingLink: parsed.meetingLink,
          meetingProvider: parsed.meetingLink ? 'caldav' : null,
          recurrenceRule: parsed.recurrenceRule,
          externalUpdatedAt: parsed.updatedAt,
        },
      });
      await this.replaceRemoteAttendees(existing.id, organizationId, parsed.attendees);
      return true;
    }

    const created = await this.prisma.event.create({
      data: {
        organizationId,
        organizerId: userId,
        syncUserId: userId,
        provider: 'caldav',
        externalId: parsed.uid,
        externalUpdatedAt: parsed.updatedAt,
        title: parsed.title,
        description: parsed.description,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        allDay: parsed.allDay,
        timezone: parsed.timezone,
        status: parsed.status,
        location: parsed.location,
        meetingLink: parsed.meetingLink,
        meetingProvider: parsed.meetingLink ? 'caldav' : null,
        recurrenceRule: parsed.recurrenceRule,
      },
    });
    await this.replaceRemoteAttendees(created.id, organizationId, parsed.attendees);
    return true;
  }

  private async replaceRemoteAttendees(
    eventId: string,
    organizationId: string,
    attendees: ParsedCalDavAttendee[],
  ): Promise<void> {
    await this.prisma.eventAttendee.deleteMany({ where: { eventId } });

    for (const attendee of attendees) {
      const contact = await this.prisma.contact.findFirst({
        where: {
          organizationId,
          email: attendee.email,
        },
        select: { id: true },
      });

      await this.prisma.eventAttendee.create({
        data: {
          eventId,
          email: attendee.email,
          name: attendee.name,
          contactId: contact?.id ?? null,
          rsvpStatus: attendee.rsvpStatus,
        },
      });
    }
  }

  private async pushUnsyncedLocalEventsToCalDav(params: {
    organizationId: string;
    userId: string;
    client: Awaited<ReturnType<typeof createDAVClient>>;
    calendar: DAVCalendar;
  }): Promise<number> {
    const { organizationId, userId, client, calendar } = params;

    const organizer = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!organizer) return 0;

    const localEvents = await this.prisma.event.findMany({
      where: {
        organizationId,
        organizerId: userId,
        provider: null,
        status: { not: 'cancelled' },
      },
      include: { attendees: true },
    });

    let synced = 0;

    for (const event of localEvents) {
      const uid = event.id;
      const iCalString = this.buildCalDavIcs({
        event,
        attendees: event.attendees,
        organizer,
        uid,
      });

      await client.createCalendarObject({
        calendar,
        iCalString,
        filename: `${this.sanitizeCalendarObjectFilename(uid)}.ics`,
      });

      await this.prisma.event.update({
        where: { id: event.id },
        data: {
          provider: 'caldav',
          syncUserId: userId,
          externalId: uid,
          externalUpdatedAt: new Date(),
        },
      });
      synced++;
    }

    return synced;
  }

  private parseCalDavObject(
    calendarObject: DAVCalendarObject,
  ): ParsedCalDavEvent | null {
    const raw = String(calendarObject.data ?? '').trim();
    if (!raw) return null;

    try {
      const parsedCalendar = ical.sync.parseICS(raw);
      const vevent = Object.values(parsedCalendar).find(
        (entry): entry is ical.VEvent =>
          Boolean(entry && entry.type === 'VEVENT' && !entry.recurrenceid),
      );
      if (!vevent?.uid || !vevent.start) return null;

      const startTime = this.toValidDate(vevent.start);
      const fallbackEnd = new Date(
        startTime.getTime() +
          (vevent.datetype === 'date' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000),
      );
      const endTime = vevent.end ? this.toValidDate(vevent.end) : fallbackEnd;

      return {
        uid: vevent.uid,
        title: this.toTextValue(vevent.summary) ?? '(No title)',
        description: this.toTextValue(vevent.description),
        startTime,
        endTime,
        allDay: vevent.datetype === 'date',
        timezone: this.extractTimezone(vevent.start),
        status: this.mapCalDavStatus(vevent.status),
        location: this.toTextValue(vevent.location),
        meetingLink: this.extractMeetingLink(vevent),
        recurrenceRule: vevent.rrule
          ? vevent.rrule.toString().replace(/^RRULE:/, '')
          : null,
        updatedAt:
          this.toNullableDate(vevent.lastmodified) ??
          this.toNullableDate(vevent.dtstamp) ??
          new Date(),
        attendees: this.parseCalDavAttendees(vevent.attendee),
      };
    } catch (err) {
      this.logger.warn(
        `[sync:caldav] Failed to parse calendar object ${calendarObject.url}: ${this.stringifyError(err)}`,
      );
      return null;
    }
  }

  private parseCalDavAttendees(attendeeValue: unknown): ParsedCalDavAttendee[] {
    const attendees = Array.isArray(attendeeValue)
      ? attendeeValue
      : attendeeValue
        ? [attendeeValue]
        : [];

    return attendees
      .map((attendee) => {
        const rawEmail =
          this.toTextValue((attendee as { val?: unknown }).val) ??
          this.toTextValue((attendee as { email?: unknown }).email) ??
          null;
        if (!rawEmail) return null;

        const normalizedEmail = rawEmail.replace(/^mailto:/i, '').trim();
        if (!normalizedEmail) return null;

        const params =
          (attendee as { params?: Record<string, string> }).params ?? {};
        return {
          email: normalizedEmail,
          name: this.toTextValue(params['CN'] ?? null),
          rsvpStatus: this.mapCalDavAttendeeStatus(params['PARTSTAT']),
        };
      })
      .filter((attendee): attendee is ParsedCalDavAttendee => attendee !== null);
  }

  private buildCalDavIcs(params: {
    event: Event;
    attendees: EventAttendee[];
    organizer: Pick<User, 'email' | 'fullName'>;
    uid: string;
  }): string {
    const { event, attendees, organizer, uid } = params;

    return this.icsGenerator.generate({
      id: uid,
      title: event.title,
      description: event.description ?? undefined,
      startTime: event.startTime,
      endTime: event.endTime,
      allDay: event.allDay,
      timezone: event.timezone ?? undefined,
      location: event.location ?? undefined,
      meetingLink: event.meetingLink ?? undefined,
      meetingProvider: event.meetingProvider ?? undefined,
      organizerEmail: organizer.email,
      organizerName: organizer.fullName,
      attendees: attendees.map((attendee) => ({
        email: attendee.email,
        name: attendee.name ?? undefined,
        status: this.mapLocalAttendeeStatus(attendee.rsvpStatus),
      })),
      recurrenceRule: event.recurrenceRule ?? undefined,
      recurrenceEnd: event.recurrenceEnd ?? undefined,
      status: this.mapLocalEventStatus(event.status),
      lastModified: event.updatedAt,
    });
  }

  private async findCalDavObjectByUid(
    client: Awaited<ReturnType<typeof createDAVClient>>,
    calendar: DAVCalendar,
    uid: string,
  ): Promise<DAVCalendarObject | null> {
    const remoteObjects = await client.fetchCalendarObjects({
      calendar,
      timeRange: this.buildCalDavTimeRange(),
    });

    for (const remoteObject of remoteObjects) {
      const parsed = this.parseCalDavObject(remoteObject);
      if (parsed?.uid === uid) {
        return remoteObject;
      }
    }

    return null;
  }

  private async resolveCalDavConnection(
    params: SyncCalDavParams,
  ): Promise<StoredCalDavConnection | null> {
    const stored = await this.getStoredCalDavConnection(params.userId);
    const url = params.calDavUrl?.trim() || stored?.url || '';
    const username = params.username?.trim() || stored?.username || '';
    const password = params.password || stored?.password || '';

    if (!url || !username || !password) return null;

    return {
      url,
      username,
      password,
      calendarUrl: stored?.calendarUrl ?? null,
      calendarDisplayName: stored?.calendarDisplayName ?? null,
    };
  }

  private async getStoredCalDavConnection(
    userId: string,
  ): Promise<StoredCalDavConnection | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });

    const prefs = this.getPreferences(user?.preferences);
    const encryptedPassword = prefs['calDavPassword'];
    if (!prefs['calDavUrl'] || !prefs['calDavUsername'] || !encryptedPassword) {
      return null;
    }

    const password = this.decrypt(encryptedPassword);
    if (!password) return null;

    return {
      url: prefs['calDavUrl'],
      username: prefs['calDavUsername'],
      password,
      calendarUrl: prefs['calDavCalendarUrl'] || null,
      calendarDisplayName: prefs['calDavCalendarDisplayName'] || null,
    };
  }

  private async persistCalDavMetadata(
    userId: string,
    values: Partial<
      StoredCalDavConnection & { lastSyncedAt: string; lastError: string | null }
    >,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    const prefs = this.getPreferences(user?.preferences);

    if (values.url !== undefined) {
      prefs['calDavUrl'] = values.url;
    }
    if (values.username !== undefined) {
      prefs['calDavUsername'] = values.username;
    }
    if (values.password !== undefined) {
      prefs['calDavPassword'] = this.encrypt(values.password);
    }
    if (values.calendarUrl !== undefined) {
      if (values.calendarUrl) {
        prefs['calDavCalendarUrl'] = values.calendarUrl;
      } else {
        delete prefs['calDavCalendarUrl'];
      }
    }
    if (values.calendarDisplayName !== undefined) {
      if (values.calendarDisplayName) {
        prefs['calDavCalendarDisplayName'] = values.calendarDisplayName;
      } else {
        delete prefs['calDavCalendarDisplayName'];
      }
    }
    if (values.lastSyncedAt !== undefined) {
      prefs['calDavLastSyncedAt'] = values.lastSyncedAt;
    }
    if (values.lastError !== undefined) {
      if (values.lastError) {
        prefs['calDavLastError'] = values.lastError;
      } else {
        delete prefs['calDavLastError'];
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        preferences: prefs as Prisma.InputJsonValue,
      },
    });
  }

  private async createCalDavClient(connection: StoredCalDavConnection) {
    return createDAVClient({
      serverUrl: connection.url,
      credentials: {
        username: connection.username,
        password: connection.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
  }

  private async resolveCalendar(
    client: Awaited<ReturnType<typeof createDAVClient>>,
    connection: Pick<StoredCalDavConnection, 'calendarUrl'>,
  ): Promise<DAVCalendar | null> {
    const calendars = await client.fetchCalendars();
    if (calendars.length === 0) return null;

    if (connection.calendarUrl) {
      const existing = calendars.find(
        (calendar) => calendar.url === connection.calendarUrl,
      );
      if (existing) return existing;
    }

    const eventCalendar = calendars.find((calendar) =>
      (calendar.components ?? []).some(
        (component) => component.toUpperCase() === 'VEVENT',
      ),
    );

    return eventCalendar ?? calendars[0] ?? null;
  }

  private getCalendarDisplayName(calendar: DAVCalendar): string {
    const value = calendar.displayName;
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'value' in value) {
      return this.toTextValue((value as { value?: unknown }).value) ?? 'CalDAV';
    }
    return 'CalDAV';
  }

  private buildCalDavTimeRange() {
    const start = new Date();
    start.setDate(start.getDate() - CALDAV_SYNC_PAST_DAYS);

    const end = new Date();
    end.setDate(end.getDate() + CALDAV_SYNC_FUTURE_DAYS);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  private getPreferences(preferences: Prisma.JsonValue | null | undefined) {
    if (!preferences || typeof preferences !== 'object') {
      return {} as UserPreferences;
    }

    return { ...(preferences as UserPreferences) };
  }

  private mapCalDavStatus(value: string | undefined): string {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'CANCELLED') return 'cancelled';
    if (normalized === 'TENTATIVE') return 'tentative';
    return 'confirmed';
  }

  private mapCalDavAttendeeStatus(value: string | undefined): string {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (normalized === 'ACCEPTED') return 'accepted';
    if (normalized === 'DECLINED') return 'declined';
    if (normalized === 'TENTATIVE') return 'tentative';
    return 'pending';
  }

  private mapLocalEventStatus(status: string | null): ICalEventStatus {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (normalized === 'cancelled') return ICalEventStatus.CANCELLED;
    if (normalized === 'tentative') return ICalEventStatus.TENTATIVE;
    return ICalEventStatus.CONFIRMED;
  }

  private mapLocalAttendeeStatus(
    status: string | null,
  ): ICalAttendeeStatus {
    const normalized = String(status ?? '').trim().toLowerCase();
    if (normalized === 'accepted') return ICalAttendeeStatus.ACCEPTED;
    if (normalized === 'declined') return ICalAttendeeStatus.DECLINED;
    if (normalized === 'tentative') return ICalAttendeeStatus.TENTATIVE;
    return ICalAttendeeStatus.NEEDSACTION;
  }

  private extractMeetingLink(event: ical.VEvent): string | null {
    const directUrl = this.toTextValue(event.url);
    if (directUrl?.startsWith('https://')) return directUrl;

    const searchSpace = [
      this.toTextValue(event.location),
      this.toTextValue(event.description),
    ]
      .filter(Boolean)
      .join(' ');

    const match = /(https:\/\/[^\s]+)/i.exec(searchSpace);
    return match?.[1] ?? null;
  }

  private extractTimezone(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    if ('tz' in (value as { tz?: unknown })) {
      return this.toTextValue((value as { tz?: unknown }).tz) ?? null;
    }
    if ('timezone' in (value as { timezone?: unknown })) {
      return this.toTextValue((value as { timezone?: unknown }).timezone) ?? null;
    }
    return null;
  }

  private toTextValue(value: unknown): string | null {
    if (typeof value === 'string') return value.trim() || null;
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (typeof value === 'object') {
      const withVal = value as { val?: unknown };
      if (withVal.val !== undefined) return this.toTextValue(withVal.val);
      if ('toString' in value && typeof value.toString === 'function') {
        const rendered = value.toString();
        return rendered === '[object Object]' ? null : rendered.trim() || null;
      }
    }
    return null;
  }

  private toNullableDate(value: unknown): Date | null {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(String(value));
    if (isNaN(date.getTime())) return null;
    return date;
  }

  private toValidDate(value: unknown): Date {
    const date = this.toNullableDate(value);
    if (!date) {
      throw new Error(`Invalid calendar date: ${String(value)}`);
    }
    return date;
  }

  private sanitizeCalendarObjectFilename(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]/g, '-');
  }

  private stringifyError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  private encrypt(plaintext: string): string {
    const key = this.config.get<string>('encryption.key') ?? '';
    if (!key) {
      throw new Error('Missing encryption key');
    }

    const iv = crypto.randomBytes(12);
    const keyBuffer = Buffer.from(
      crypto.createHash('sha256').update(key).digest(),
    );
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString('hex'),
      authTag.toString('hex'),
      ciphertext.toString('hex'),
    ].join(':');
  }

  private decrypt(encrypted: string): string {
    const key = this.config.get<string>('encryption.key') ?? '';
    if (!key || !encrypted) return '';

    const parts = encrypted.split(':');
    if (parts.length !== 3) return '';
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');

    try {
      const keyBuffer = Buffer.from(
        crypto.createHash('sha256').update(key).digest(),
      );
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
      decipher.setAuthTag(authTag);
      return (
        decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
      );
    } catch {
      try {
        const legacyKeyBuffer = Buffer.from(key.padEnd(32).slice(0, 32));
        const legacyDecipher = crypto.createDecipheriv(
          'aes-256-gcm',
          legacyKeyBuffer,
          iv,
        );
        legacyDecipher.setAuthTag(authTag);
        return (
          legacyDecipher.update(ciphertext).toString('utf8') +
          legacyDecipher.final('utf8')
        );
      } catch {
        return '';
      }
    }
  }

  private async softDeleteAbsent(
    organizationId: string,
    syncUserId: string,
    provider: string,
    seenExternalIds: string[],
    allowEmpty = false,
  ): Promise<number> {
    if (!allowEmpty && seenExternalIds.length === 0) return 0;

    const where: Prisma.EventWhereInput = {
      organizationId,
      syncUserId,
      provider,
      status: { not: 'cancelled' },
    };

    if (seenExternalIds.length > 0) {
      where.externalId = { notIn: seenExternalIds };
    }

    const result = await this.prisma.event.updateMany({
      where,
      data: { status: 'cancelled' },
    });
    return result.count;
  }

  private httpsGet(
    hostname: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname,
        path,
        method: 'GET',
        headers,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}
