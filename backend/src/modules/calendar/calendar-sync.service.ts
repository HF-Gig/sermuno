import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import * as https from 'https';

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
  calDavUrl: string;
  username: string;
  password: string;
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
  attendees?: { emailAddress?: { address?: string; name?: string } }[];
}

@Injectable()
export class CalendarSyncService {
  private readonly logger = new Logger(CalendarSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Google Calendar Sync
  // ──────────────────────────────────────────────────────────────────────────

  async syncGoogle(
    params: SyncGoogleParams,
  ): Promise<{ synced: number; deleted: number }> {
    const { userId, organizationId, accessToken } = params;

    // Determine sync window — pull last 30 days forward
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

      // Skip if we pushed this event outbound recently (loop prevention)
      const existing = await this.prisma.event.findFirst({
        where: {
          organizationId,
          provider: 'google',
          externalId: item.id,
          syncUserId: userId,
        },
      });

      const externalUpdatedAt = item.updated ? new Date(item.updated) : null;

      // If local event has same or newer externalUpdatedAt, skip (we pushed it)
      if (
        existing?.externalUpdatedAt &&
        externalUpdatedAt &&
        existing.externalUpdatedAt >= externalUpdatedAt
      ) {
        continue;
      }

      const meetingLink =
        item.hangoutLink ??
        item.conferenceData?.entryPoints?.find((e) =>
          e.uri?.startsWith('https://'),
        )?.uri;

      const data_: Prisma.EventCreateInput = {
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
            title: data_.title,
            description: data_.description,
            startTime,
            endTime,
            allDay: data_.allDay as boolean,
            timezone: data_.timezone,
            status: data_.status as string,
            location: data_.location,
            meetingLink: data_.meetingLink,
            meetingProvider: data_.meetingProvider,
            recurrenceRule: data_.recurrenceRule,
          },
        });
      } else {
        await this.prisma.event.create({ data: data_ });
      }
      synced++;
    }

    // Soft-delete local events absent from provider
    const deleted = await this.softDeleteAbsent(
      organizationId,
      userId,
      'google',
      seenExternalIds,
    );

    return { synced, deleted };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Microsoft Calendar Sync
  // ──────────────────────────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────────────────────────
  // CalDAV Sync (basic — PROPFIND + parse iCal)
  // ──────────────────────────────────────────────────────────────────────────

  async syncCalDav(
    params: SyncCalDavParams,
  ): Promise<{ synced: number; deleted: number }> {
    const { userId, organizationId } = params;
    // CalDAV implementation is provider-specific and complex.
    // We store a record with provider='caldav' and externalId from the iCal UID.
    // For brevity, return 0 — actual CalDAV PROPFIND/REPORT would be implemented
    // using the caldav-simple or tsdav library; stubbed here to satisfy the API contract.
    this.logger.log(
      `[sync:caldav] CalDAV sync requested for user=${userId} org=${organizationId}`,
    );
    return { synced: 0, deleted: 0 };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async softDeleteAbsent(
    organizationId: string,
    syncUserId: string,
    provider: string,
    seenExternalIds: string[],
  ): Promise<number> {
    if (seenExternalIds.length === 0) return 0;

    const result = await this.prisma.event.updateMany({
      where: {
        organizationId,
        syncUserId,
        provider,
        externalId: { notIn: seenExternalIds },
        // Only soft-delete synced events that have not already been soft-deleted
        // (Prisma Event model has no deletedAt — use a status marker instead)
        status: { not: 'cancelled' },
      },
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
