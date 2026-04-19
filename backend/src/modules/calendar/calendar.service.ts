import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { ConfigService } from '@nestjs/config';
import { IcsGeneratorService } from './ics-generator.service';
import { VideoConferencingService } from './video-conferencing.service';
import { CalendarSyncService } from './calendar-sync.service';
import { CalendarTemplatesService } from './calendar-templates.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { EventsGateway } from '../websockets/events.gateway';
import type { CreateCalendarEventDto } from './dto/calendar-event.dto';
import type { UpdateCalendarEventDto } from './dto/calendar-event.dto';
import type { RsvpDto, IngestRsvpDto, SendInviteDto } from './dto/rsvp.dto';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { RequestMeta } from '../../common/http/request-meta';
import { AuditService } from '../audit/audit.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class CalendarService {
  private readonly logger = new Logger(CalendarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly icsGenerator: IcsGeneratorService,
    private readonly videoConf: VideoConferencingService,
    private readonly calendarSync: CalendarSyncService,
    private readonly templates: CalendarTemplatesService,
    @Inject(forwardRef(() => 'NOTIFICATIONS_SERVICE'))
    private readonly notifications: NotificationsService | null,
    private readonly eventsGateway: EventsGateway,
    private readonly auditService: AuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Events CRUD
  // ──────────────────────────────────────────────────────────────────────────

  async findAll(user: JwtUser) {
    return this.prisma.event.findMany({
      where: {
        organizationId: user.organizationId,
        status: { not: 'cancelled_deleted' },
      },
      orderBy: { startTime: 'asc' },
      include: { attendees: true },
    });
  }

  async create(
    dto: CreateCalendarEventDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    let meetingLink: string | null | undefined = undefined;
    let meetingId: string | null | undefined = undefined;
    let meetingPassword: string | null | undefined = undefined;
    let meetingProvider = dto.meetingProvider ?? null;

    // Auto-create meeting link if provider requested
    if (dto.meetingProvider) {
      const accessToken = await this.resolveAccessToken(
        user.sub,
        dto.meetingProvider,
      );
      if (dto.meetingProvider === 'google_meet' && !accessToken) {
        throw new BadRequestException(
          'Google Meet is selected but no valid Google OAuth token is available.',
        );
      }
      if (accessToken) {
        try {
          if (dto.meetingProvider === 'zoom') {
            const durationMs = dto.endTime.getTime() - dto.startTime.getTime();
            const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
            const result = await this.videoConf.createZoomMeeting(
              accessToken,
              dto.title,
              dto.startTime,
              durationMinutes,
            );
            meetingLink = result.meetingLink;
            meetingId = result.meetingId;
            meetingPassword = result.meetingPassword;
            meetingProvider = result.meetingProvider;
          } else if (dto.meetingProvider === 'microsoft_teams') {
            const result = await this.videoConf.createTeamsMeeting(
              accessToken,
              dto.title,
              dto.startTime,
              dto.endTime,
            );
            meetingLink = result.meetingLink;
            meetingId = result.meetingId;
            meetingProvider = result.meetingProvider;
          }
        } catch (err) {
          this.logger.warn(
            `[calendar] Video conf create failed: ${String(err)}`,
          );
        }
      }
    }

    const event = await this.prisma.event.create({
      data: {
        organizationId: user.organizationId,
        organizerId: user.sub,
        title: dto.title,
        description: dto.description ?? null,
        startTime: dto.startTime,
        endTime: dto.endTime,
        allDay: dto.allDay ?? false,
        timezone: dto.timezone ?? null,
        status: dto.status ?? 'confirmed',
        visibility: dto.visibility ?? 'default',
        recurrenceRule: dto.recurrenceRule ?? null,
        recurrenceEnd: dto.recurrenceEnd ?? null,
        reminders: (dto.reminders ?? []) as Prisma.InputJsonValue,
        color: dto.color ?? null,
        linkedThreadId: dto.linkedThreadId ?? null,
        linkedContactId: dto.linkedContactId ?? null,
        linkedCompanyId: dto.linkedCompanyId ?? null,
        templateId: dto.templateId ?? null,
        meetingProvider,
        meetingLink: meetingLink ?? null,
        meetingId: meetingId ?? null,
        meetingPassword: meetingPassword ?? null,
        location: dto.location ?? null,
      },
      include: { attendees: true },
    });

    // Create attendees if provided
    if (dto.attendees?.length) {
      await this.upsertAttendees(event.id, dto.attendees);
    }

    const createdEvent = await this.prisma.event.findUnique({
      where: { id: event.id },
      include: { attendees: true },
    });
    await this.auditLog(
      user,
      'CALENDAR_EVENT_CREATED',
      'calendar_event',
      event.id,
      null,
      createdEvent,
      meta,
    );
    if (createdEvent) {
      await this.dispatchCalendarEventWebhook(
        user.organizationId,
        'calendar.event_created',
        createdEvent,
        'created',
      );
      this.eventsGateway.emitToOrganization(
        user.organizationId,
        'calendar:event_updated',
        { eventId: createdEvent.id, action: 'created' },
      );
      if (createdEvent.meetingLink) {
        this.eventsGateway.emitToOrganization(
          user.organizationId,
          'calendar:meeting_created',
          {
            eventId: createdEvent.id,
            meetingLink: createdEvent.meetingLink,
            meetingProvider: createdEvent.meetingProvider,
          },
        );
      }
      await this.calendarSync.syncEventToCalDavIfConnected({
        eventId: createdEvent.id,
        userId: user.sub,
        organizationId: user.organizationId,
      });
      await this.calendarSync.syncEventToGoogleIfConnected({
        eventId: createdEvent.id,
        userId: user.sub,
        organizationId: user.organizationId,
      });
    }

    if (!createdEvent) return createdEvent;

    const finalCreatedEvent = await this.prisma.event.findUnique({
      where: { id: createdEvent.id },
      include: { attendees: true },
    });
    if (
      dto.meetingProvider === 'google_meet' &&
      finalCreatedEvent &&
      !finalCreatedEvent.meetingLink
    ) {
      throw new BadRequestException(
        'Failed to provision a valid Google Meet link for this event.',
      );
    }
    if (finalCreatedEvent && finalCreatedEvent.attendees.length > 0) {
      // Keep create-event invite delivery consistent with manual "Send Invitation".
      await this.sendInvite(
        finalCreatedEvent.id,
        { additionalEmails: [] },
        user,
        meta,
      );
    }
    return finalCreatedEvent;
  }

  async findOne(id: string, user: JwtUser) {
    const event = await this.prisma.event.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { attendees: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async update(id: string, dto: UpdateCalendarEventDto, user: JwtUser) {
    const existing = await this.findOne(id, user);

    let meetingPatch: Record<string, unknown> = {};
    const resolvedMeetingProvider =
      dto.meetingProvider ?? existing.meetingProvider;
    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;
    const title = dto.title ?? existing.title;
    if (
      resolvedMeetingProvider &&
      (dto.meetingProvider !== undefined ||
        dto.startTime !== undefined ||
        dto.endTime !== undefined ||
        dto.title !== undefined)
    ) {
      const accessToken = await this.resolveAccessToken(
        user.sub,
        resolvedMeetingProvider,
      );
      if (resolvedMeetingProvider === 'google_meet' && !accessToken) {
        throw new BadRequestException(
          'Google Meet is selected but no valid Google OAuth token is available.',
        );
      }
      if (accessToken) {
        try {
          if (resolvedMeetingProvider === 'zoom') {
            const durationMinutes = Math.max(
              1,
              Math.round((endTime.getTime() - startTime.getTime()) / 60000),
            );
            const result = await this.videoConf.createZoomMeeting(
              accessToken,
              title,
              startTime,
              durationMinutes,
            );
            meetingPatch = {
              meetingProvider: result.meetingProvider,
              meetingLink: result.meetingLink ?? null,
              meetingId: result.meetingId ?? null,
              meetingPassword: result.meetingPassword ?? null,
            };
          } else if (resolvedMeetingProvider === 'microsoft_teams') {
            const result = await this.videoConf.createTeamsMeeting(
              accessToken,
              title,
              startTime,
              endTime,
            );
            meetingPatch = {
              meetingProvider: result.meetingProvider,
              meetingLink: result.meetingLink ?? null,
              meetingId: result.meetingId ?? null,
              meetingPassword: null,
            };
          }
        } catch (err) {
          this.logger.warn(
            `[calendar] Video conf update failed: ${String(err)}`,
          );
        }
      }
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.startTime !== undefined && { startTime: dto.startTime }),
        ...(dto.endTime !== undefined && { endTime: dto.endTime }),
        ...(dto.allDay !== undefined && { allDay: dto.allDay }),
        ...(dto.timezone !== undefined && { timezone: dto.timezone }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
        ...(dto.recurrenceRule !== undefined && {
          recurrenceRule: dto.recurrenceRule,
        }),
        ...(dto.recurrenceEnd !== undefined && {
          recurrenceEnd: dto.recurrenceEnd,
        }),
        ...(dto.reminders !== undefined && {
          reminders: dto.reminders as Prisma.InputJsonValue,
        }),
        ...(dto.color !== undefined && { color: dto.color }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.linkedThreadId !== undefined && {
          linkedThreadId: dto.linkedThreadId,
        }),
        ...(dto.linkedContactId !== undefined && {
          linkedContactId: dto.linkedContactId,
        }),
        ...(dto.linkedCompanyId !== undefined && {
          linkedCompanyId: dto.linkedCompanyId,
        }),
        ...(dto.meetingProvider !== undefined && {
          meetingProvider: dto.meetingProvider,
        }),
        ...meetingPatch,
      },
      include: { attendees: true },
    });

    if (dto.attendees !== undefined) {
      await this.prisma.eventAttendee.deleteMany({ where: { eventId: id } });
      if (dto.attendees.length > 0) {
        await this.upsertAttendees(id, dto.attendees);
      }
    }

    const finalUpdated = await this.prisma.event.findUnique({
      where: { id },
      include: { attendees: true },
    });

    await this.auditLog(
      user,
      'calendar_event.updated',
      'Event',
      id,
      existing,
      finalUpdated,
    );
    if (finalUpdated) {
      await this.dispatchCalendarEventWebhook(
        user.organizationId,
        'calendar.event_updated',
        finalUpdated,
        'updated',
      );
    }
    this.eventsGateway.emitToOrganization(
      user.organizationId,
      'calendar:event_updated',
      { eventId: id, action: 'updated' },
    );
    if (
      finalUpdated?.meetingLink &&
      finalUpdated.meetingLink !== existing.meetingLink
    ) {
      this.eventsGateway.emitToOrganization(
        user.organizationId,
        'calendar:meeting_created',
        {
          eventId: id,
          meetingLink: finalUpdated.meetingLink,
          meetingProvider: finalUpdated.meetingProvider,
        },
      );
    }
    if (!finalUpdated) return finalUpdated;

    await this.calendarSync.syncEventToCalDavIfConnected({
      eventId: finalUpdated.id,
      userId: user.sub,
      organizationId: user.organizationId,
    });
    await this.calendarSync.syncEventToGoogleIfConnected({
      eventId: finalUpdated.id,
      userId: user.sub,
      organizationId: user.organizationId,
    });

    const finalEvent = await this.prisma.event.findUnique({
      where: { id: finalUpdated.id },
      include: { attendees: true },
    });
    if (
      resolvedMeetingProvider === 'google_meet' &&
      finalEvent &&
      !finalEvent.meetingLink
    ) {
      throw new BadRequestException(
        'Failed to provision a valid Google Meet link for this event.',
      );
    }
    return finalEvent;
  }

  async remove(id: string, user: JwtUser) {
    const event = await this.findOne(id, user);
    await this.calendarSync.deleteEventFromCalDavIfConnected({
      event: {
        id: event.id,
        externalId: event.externalId,
        provider: event.provider,
      },
      userId: user.sub,
    });
    await this.calendarSync.deleteEventFromGoogleIfConnected({
      event: {
        id: event.id,
        externalId: event.externalId,
        provider: event.provider,
      },
      userId: user.sub,
      organizationId: user.organizationId,
    });
    await this.prisma.eventAttendee.deleteMany({ where: { eventId: id } });
    await this.prisma.event.delete({ where: { id } });
    await this.auditLog(
      user,
      'calendar_event.deleted',
      'Event',
      id,
      event,
      null,
    );
    this.eventsGateway.emitToOrganization(
      user.organizationId,
      'calendar:event_updated',
      { eventId: id, action: 'deleted' },
    );
    await this.dispatchCalendarEventWebhook(
      user.organizationId,
      'calendar.event_cancelled',
      event,
      'cancelled',
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Attendees
  // ──────────────────────────────────────────────────────────────────────────

  async getAttendees(eventId: string, user: JwtUser) {
    await this.findOne(eventId, user); // ensure access
    return this.prisma.eventAttendee.findMany({ where: { eventId } });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Invite / ICS
  // ──────────────────────────────────────────────────────────────────────────

  async sendInvite(
    eventId: string,
    dto: SendInviteDto,
    user: JwtUser,
    meta: RequestMeta = {},
  ) {
    const event = await this.findOne(eventId, user);
    const organizer = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });

    // Build attendee list from existing + additional emails
    const existingAttendees = await this.prisma.eventAttendee.findMany({
      where: { eventId },
    });

    const extraEmails = dto.additionalEmails ?? [];
    const allEmails = [
      ...new Set([...existingAttendees.map((a) => a.email), ...extraEmails]),
    ];

    // Upsert any new emails as attendees
    for (const email of extraEmails) {
      const exists = existingAttendees.find((a) => a.email === email);
      if (!exists) {
        await this.prisma.eventAttendee.create({
          data: { eventId, email, rsvpStatus: 'pending' },
        });
      }
    }

    const attendees = allEmails.map((email) => ({ email }));
    if (attendees.length === 0) {
      throw new BadRequestException(
        'No attendees found. Add attendee emails before sending invites.',
      );
    }
    const formattedStart = event.startTime.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: event.timezone ?? 'UTC',
    });
    const formattedEnd = event.endTime.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: event.timezone ?? 'UTC',
    });
    const inviteText = [
      `Invitation: ${event.title}`,
      '',
      event.description ? `${event.description}` : null,
      event.description ? '' : null,
      `Start: ${formattedStart}`,
      `End: ${formattedEnd}`,
      `Timezone: ${event.timezone ?? 'UTC'}`,
      event.location ? `Location: ${event.location}` : null,
      event.meetingLink ? `Meeting link: ${event.meetingLink}` : null,
      '',
      'An ICS calendar attachment is included with this email.',
    ]
      .filter((line) => line !== null)
      .join('\n');
    const inviteHtml = [
      '<div style="margin:0;padding:24px 0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#111827;">',
      '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">',
      '    <tr>',
      '      <td align="center">',
      '        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,0.08);">',
      '          <tr>',
      '            <td style="background:#153f39;padding:28px 32px;color:#ffffff;">',
      `              <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.8;">Sermuno Calendar Invite</div>`,
      `              <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;font-weight:700;">${event.title}</h1>`,
      '            </td>',
      '          </tr>',
      '          <tr>',
      '            <td style="padding:28px 32px;">',
      event.description
        ? `              <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#374151;">${event.description}</p>`
        : '',
      '              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;border-spacing:0 12px;">',
      `                <tr><td style="width:140px;font-size:13px;font-weight:700;color:#111827;vertical-align:top;">Start</td><td style="font-size:14px;line-height:1.6;color:#374151;">${formattedStart}</td></tr>`,
      `                <tr><td style="width:140px;font-size:13px;font-weight:700;color:#111827;vertical-align:top;">End</td><td style="font-size:14px;line-height:1.6;color:#374151;">${formattedEnd}</td></tr>`,
      `                <tr><td style="width:140px;font-size:13px;font-weight:700;color:#111827;vertical-align:top;">Timezone</td><td style="font-size:14px;line-height:1.6;color:#374151;">${event.timezone ?? 'UTC'}</td></tr>`,
      event.location
        ? `                <tr><td style="width:140px;font-size:13px;font-weight:700;color:#111827;vertical-align:top;">Location</td><td style="font-size:14px;line-height:1.6;color:#374151;">${event.location}</td></tr>`
        : '',
      event.meetingLink
        ? `                <tr><td style="width:140px;font-size:13px;font-weight:700;color:#111827;vertical-align:top;">Meeting Link</td><td style="font-size:14px;line-height:1.6;color:#374151;"><a href="${event.meetingLink}" style="color:#0f766e;text-decoration:none;word-break:break-all;">${event.meetingLink}</a></td></tr>`
        : '',
      '              </table>',
      '              <div style="margin-top:24px;padding:18px 20px;border-radius:14px;background:#f8fafc;border:1px solid #e5e7eb;font-size:13px;line-height:1.6;color:#475569;">',
      '                An ICS calendar attachment is included with this email so you can add the event directly to your calendar client.',
      '              </div>',
      '            </td>',
      '          </tr>',
      '        </table>',
      '      </td>',
      '    </tr>',
      '  </table>',
      '</div>',
    ]
      .filter(Boolean)
      .join('');

    // Generate ICS
    const icsContent = this.icsGenerator.generate({
      id: event.id,
      title: event.title,
      description: event.description ?? undefined,
      startTime: event.startTime,
      endTime: event.endTime,
      timezone: event.timezone ?? undefined,
      location: event.location ?? undefined,
      meetingLink: event.meetingLink ?? undefined,
      meetingProvider: event.meetingProvider ?? undefined,
      organizerEmail: organizer?.email ?? 'noreply@sermuno.com',
      organizerName: organizer?.fullName,
      attendees,
      recurrenceRule: event.recurrenceRule ?? undefined,
      recurrenceEnd: event.recurrenceEnd ?? undefined,
    });

    const mailbox = await this.resolveInviteMailbox(
      user.organizationId,
      organizer?.email ?? null,
    );
    if (!mailbox) {
      throw new BadRequestException(
        'No connected mailbox is available to send calendar invites.',
      );
    }
    const { transport, fromEmail, replyTo } = this.buildInviteTransport(
      mailbox,
      organizer?.email ?? undefined,
    );

    let sent = 0;
    const failures: Array<{ email: string; error: string }> = [];
    for (const email of allEmails) {
      try {
        const info = await transport.sendMail({
          from: mailbox.name ? `"${mailbox.name}" <${fromEmail}>` : fromEmail,
          to: email,
          subject: `Invitation: ${event.title}`,
          text: inviteText,
          html: inviteHtml,
          replyTo,
          attachments: [
            {
              filename: 'invite.ics',
              content: icsContent,
              contentType: 'text/calendar',
            },
          ],
        });
        const rejected = Array.isArray((info as any)?.rejected)
          ? ((info as any).rejected as string[])
          : [];
        if (rejected.length > 0) {
          failures.push({
            email,
            error: `Provider rejected recipient(s): ${rejected.join(', ')}`,
          });
          continue;
        }
        sent++;
      } catch (err) {
        failures.push({
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (sent === 0 && failures.length > 0) {
      throw new BadRequestException(
        `Failed to deliver calendar invites to all attendees: ${failures
          .map((failure) => `${failure.email} (${failure.error})`)
          .join(', ')}`,
      );
    }

    // Dispatch notification
    await this.notifications?.dispatch({
      userId: user.sub,
      organizationId: user.organizationId,
      type: 'calendar.invite',
      title: `Invite sent for: ${event.title}`,
      message:
        failures.length > 0
          ? `Invites sent to ${sent} attendee(s). ${failures.length} failed.`
          : `Invites sent to ${sent} attendee(s).`,
      resourceId: event.id,
      channels: {
        email: false,
        push: false,
        desktop: false,
      },
    });

    await this.auditLog(
      user,
      'CALENDAR_INVITE_SENT',
      'calendar_event',
      eventId,
      null,
      { sent, failed: failures.length, attendees: allEmails, failures },
      meta,
    );
    this.eventsGateway.emitToOrganization(
      user.organizationId,
      'calendar:event_updated',
      { eventId, action: 'invited' },
    );

    return { sent, failed: failures.length, failures, ics: icsContent };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RSVP
  // ──────────────────────────────────────────────────────────────────────────

  async rsvp(eventId: string, dto: RsvpDto, user: JwtUser) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId },
    });
    if (!event) throw new NotFoundException('Event not found');

    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    if (!userRecord) throw new NotFoundException('User not found');

    const attendee = await this.prisma.eventAttendee.findFirst({
      where: { eventId, email: userRecord.email },
    });

    let result;
    if (attendee) {
      result = await this.prisma.eventAttendee.update({
        where: { id: attendee.id },
        data: { rsvpStatus: dto.status },
      });
    } else {
      result = await this.prisma.eventAttendee.create({
        data: {
          eventId,
          email: userRecord.email,
          userId: user.sub,
          rsvpStatus: dto.status,
        },
      });
    }
    this.eventsGateway.emitToOrganization(
      event.organizationId,
      'calendar:rsvp_received',
      {
        eventId,
        email: userRecord.email,
        status: dto.status,
      },
    );
    await this.dispatchCalendarRsvpWebhook(
      event.organizationId,
      event,
      result,
      dto.status,
      'api_rsvp',
    );
    return result;
  }

  async getRsvpPublic(eventId: string, token: string) {
    // Validate token = HMAC-SHA256 of eventId with JWT_SECRET
    const secret = this.config.get<string>('jwt.secret') ?? '';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(eventId)
      .digest('hex');

    if (token !== expected) {
      throw new BadRequestException('Invalid RSVP token');
    }

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { attendees: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async ingestRsvp(dto: IngestRsvpDto) {
    // Parse raw iCal METHOD:REPLY
    // Extract ATTENDEE:mailto:<email>;PARTSTAT=<status>
    const lines = dto.rawIcal.split(/\r?\n/);
    const updates: { email: string; status: string }[] = [];
    let eventUid: string | null = null;

    for (const line of lines) {
      if (line.startsWith('UID:')) {
        eventUid = line.slice(4).trim();
      }
      if (line.startsWith('ATTENDEE')) {
        const emailMatch = /mailto:([^\s;>]+)/i.exec(line);
        const partstatMatch = /PARTSTAT=([A-Z-]+)/i.exec(line);
        if (emailMatch && partstatMatch) {
          const email = emailMatch[1];
          const partstat = partstatMatch[1].toLowerCase();
          const statusMap: Record<string, string> = {
            accepted: 'accepted',
            declined: 'declined',
            tentative: 'tentative',
            'needs-action': 'pending',
          };
          updates.push({ email, status: statusMap[partstat] ?? 'pending' });
        }
      }
    }

    if (!eventUid || updates.length === 0) {
      return { updated: 0 };
    }

    // Find event by externalId or title-based UID
    const event = await this.prisma.event.findFirst({
      where: { externalId: eventUid },
    });
    if (!event) {
      this.logger.warn(`[rsvp:ingest] No event found for UID=${eventUid}`);
      return { updated: 0 };
    }

    let updated = 0;
    for (const { email, status } of updates) {
      const att = await this.prisma.eventAttendee.findFirst({
        where: { eventId: event.id, email },
      });
      if (att) {
        const updatedAttendee = await this.prisma.eventAttendee.update({
          where: { id: att.id },
          data: { rsvpStatus: status },
        });
        this.eventsGateway.emitToOrganization(
          event.organizationId,
          'calendar:rsvp_received',
          {
            eventId: event.id,
            email,
            status,
          },
        );
        await this.dispatchCalendarRsvpWebhook(
          event.organizationId,
          event,
          updatedAttendee,
          status,
          'ingest_rsvp',
        );
        updated++;
      }
    }

    return { updated };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // iCal Feed
  // ──────────────────────────────────────────────────────────────────────────

  async generateIcsFeed(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const events = await this.prisma.event.findMany({
      where: { organizerId: userId, status: { not: 'cancelled' } },
      include: { attendees: true },
      orderBy: { startTime: 'asc' },
    });

    if (events.length === 0) {
      // Return empty calendar
      return this.icsGenerator
        .generate({
          id: userId,
          title: 'Empty',
          startTime: new Date(),
          endTime: new Date(),
          organizerEmail: user.email,
          attendees: [],
        })
        .replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r?\n/, '');
    }

    // Generate individual ICS for each event and combine
    const parts: string[] = [];
    for (const event of events) {
      const ics = this.icsGenerator.generate({
        id: event.id,
        title: event.title,
        description: event.description ?? undefined,
        startTime: event.startTime,
        endTime: event.endTime,
        timezone: event.timezone ?? undefined,
        location: event.location ?? undefined,
        meetingLink: event.meetingLink ?? undefined,
        meetingProvider: event.meetingProvider ?? undefined,
        organizerEmail: user.email,
        organizerName: user.fullName,
        attendees: event.attendees.map((a) => ({
          email: a.email,
          name: a.name ?? undefined,
        })),
        recurrenceRule: event.recurrenceRule ?? undefined,
        recurrenceEnd: event.recurrenceEnd ?? undefined,
      });
      // Extract VEVENT block
      const match = /BEGIN:VEVENT[\s\S]*?END:VEVENT/m.exec(ics);
      if (match) parts.push(match[0]);
    }

    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Sermuno//Calendar//EN',
      ...parts,
      'END:VCALENDAR',
    ].join('\r\n');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Templates (delegate to CalendarTemplatesService)
  // ──────────────────────────────────────────────────────────────────────────

  async getTemplates(user: JwtUser) {
    return this.templates.findAll(user.organizationId);
  }

  async createTemplate(
    dto: import('./dto/calendar-template.dto').CreateCalendarTemplateDto,
    user: JwtUser,
  ) {
    return this.templates.create(dto, user.organizationId, user.sub);
  }

  async createEventFromTemplate(
    templateId: string,
    variables: Record<string, string>,
    user: JwtUser,
  ) {
    return this.templates.createEventFromTemplate(
      templateId,
      variables,
      user.organizationId,
      user.sub,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Sync (delegate to CalendarSyncService)
  // ──────────────────────────────────────────────────────────────────────────

  async syncGoogle(user: JwtUser, accessToken?: string) {
    return this.calendarSync.syncGoogle({
      userId: user.sub,
      organizationId: user.organizationId,
      accessToken,
    });
  }

  async syncMicrosoft(accessToken: string, user: JwtUser) {
    return this.calendarSync.syncMicrosoft({
      userId: user.sub,
      organizationId: user.organizationId,
      accessToken,
    });
  }

  async syncCalDav(
    calDavUrl: string | undefined,
    username: string | undefined,
    password: string | undefined,
    user: JwtUser,
  ) {
    return this.calendarSync.syncCalDav({
      userId: user.sub,
      organizationId: user.organizationId,
      calDavUrl,
      username,
      password,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private async dispatchCalendarEventWebhook(
    organizationId: string,
    eventType:
      | 'calendar.event_created'
      | 'calendar.event_updated'
      | 'calendar.event_cancelled',
    event: {
      id: string;
      title: string;
      startTime: Date;
      endTime: Date;
      organizationId: string;
      organizerId: string;
      status: string;
      externalId: string | null;
      attendees?: Array<{
        id: string;
        email: string;
        name: string | null;
        userId: string | null;
        contactId: string | null;
        rsvpStatus: string;
      }>;
    },
    action: 'created' | 'updated' | 'cancelled',
  ) {
    await this.webhooks.dispatch(organizationId, eventType, {
      event: {
        id: event.id,
        title: event.title,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        organizationId: event.organizationId,
        organizerId: event.organizerId,
        status: event.status,
        externalId: event.externalId,
      },
      attendees: (event.attendees ?? []).map((attendee) => ({
        id: attendee.id,
        email: attendee.email,
        name: attendee.name,
        userId: attendee.userId,
        contactId: attendee.contactId,
        rsvpStatus: attendee.rsvpStatus,
      })),
      action,
      occurredAt: new Date().toISOString(),
    });
  }

  private async dispatchCalendarRsvpWebhook(
    organizationId: string,
    event: {
      id: string;
      title: string;
      startTime: Date;
      endTime: Date;
      organizationId: string;
      organizerId: string;
      status: string;
      externalId: string | null;
    },
    attendee: {
      id: string;
      email: string;
      name: string | null;
      userId: string | null;
    },
    responseStatus: string,
    source: 'api_rsvp' | 'ingest_rsvp',
  ) {
    await this.webhooks.dispatch(organizationId, 'calendar.rsvp_received', {
      event: {
        id: event.id,
        title: event.title,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        organizationId: event.organizationId,
        organizerId: event.organizerId,
        status: event.status,
        externalId: event.externalId,
      },
      attendee: {
        id: attendee.id,
        email: attendee.email,
        name: attendee.name,
        userId: attendee.userId,
      },
      responseStatus,
      source,
      occurredAt: new Date().toISOString(),
    });
  }

  private async upsertAttendees(
    eventId: string,
    attendees: {
      email: string;
      name?: string;
      contactId?: string;
      userId?: string;
    }[],
  ) {
    for (const att of attendees) {
      const existing = await this.prisma.eventAttendee.findFirst({
        where: { eventId, email: att.email },
      });
      if (!existing) {
        // Try to auto-link to contact
        let contactId = att.contactId;
        if (!contactId) {
          const contact = await this.prisma.contact.findFirst({
            where: { email: att.email },
          });
          if (contact) contactId = contact.id;
        }

        await this.prisma.eventAttendee.create({
          data: {
            eventId,
            email: att.email,
            name: att.name ?? null,
            contactId: contactId ?? null,
            userId: att.userId ?? null,
            rsvpStatus: 'pending',
          },
        });
      }
    }
  }

  private async resolveAccessToken(
    userId: string,
    provider: string,
  ): Promise<string | null> {
    if (provider === 'google_meet') {
      return this.resolveGoogleMailboxAccessToken(userId);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.preferences) return null;

    const prefs = user.preferences as Record<string, string>;
    const encKey = this.config.get<string>('encryption.key') ?? '';

    if (provider === 'zoom') {
      const enc = prefs['zoomAccessToken'];
      if (!enc) return null;
      return this.decrypt(enc, encKey);
    } else if (provider === 'microsoft_teams') {
      const enc = prefs['microsoftAccessToken'];
      if (!enc) return null;
      return this.decrypt(enc, encKey);
    }
    return null;
  }

  private async resolveGoogleMailboxAccessToken(
    userId: string,
  ): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });
    if (!user?.organizationId) return null;

    const mailbox = await this.prisma.mailbox.findFirst({
      where: {
        organizationId: user.organizationId,
        provider: 'GMAIL',
        deletedAt: null,
        OR: [{ oauthAccessToken: { not: null } }, { googleAccessToken: { not: null } }],
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        oauthAccessToken: true,
        oauthRefreshToken: true,
        oauthTokenExpiresAt: true,
        googleAccessToken: true,
        googleRefreshToken: true,
        googleTokenExpiresAt: true,
      },
    });
    if (!mailbox) return null;

    const encryptedAccessToken =
      mailbox.oauthAccessToken || mailbox.googleAccessToken;
    if (!encryptedAccessToken) return null;

    const key = this.config.get<string>('encryption.key') ?? '';
    const decryptedAccessToken = this.decrypt(encryptedAccessToken, key);
    if (!decryptedAccessToken) return null;

    const expiresAt = mailbox.oauthTokenExpiresAt || mailbox.googleTokenExpiresAt;
    const expiringSoon = expiresAt
      ? expiresAt.getTime() - Date.now() < 2 * 60 * 1000
      : false;
    if (!expiringSoon) return decryptedAccessToken;

    const encryptedRefreshToken =
      mailbox.oauthRefreshToken || mailbox.googleRefreshToken;
    if (!encryptedRefreshToken) return decryptedAccessToken;
    const refreshToken = this.decrypt(encryptedRefreshToken, key);
    if (!refreshToken) return decryptedAccessToken;

    const clientId = this.config.get<string>('google.clientId') ?? '';
    const clientSecret = this.config.get<string>('google.clientSecret') ?? '';
    if (!clientId || !clientSecret) return decryptedAccessToken;

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      if (!response.ok) {
        this.logger.warn(
          `[calendar] Google token refresh failed status=${response.status}`,
        );
        return decryptedAccessToken;
      }

      const refreshed = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      if (!refreshed.access_token) return decryptedAccessToken;

      const encryptedNewAccessToken = this.encrypt(
        refreshed.access_token,
        key,
      );
      const encryptedNewRefreshToken = refreshed.refresh_token
        ? this.encrypt(refreshed.refresh_token, key)
        : encryptedRefreshToken;
      const newExpiresAt = refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000)
        : null;

      await this.prisma.mailbox.update({
        where: { id: mailbox.id },
        data: {
          oauthAccessToken: encryptedNewAccessToken,
          googleAccessToken: encryptedNewAccessToken,
          oauthRefreshToken: encryptedNewRefreshToken,
          googleRefreshToken: encryptedNewRefreshToken,
          ...(newExpiresAt
            ? {
                oauthTokenExpiresAt: newExpiresAt,
                googleTokenExpiresAt: newExpiresAt,
              }
            : {}),
        },
      });

      return refreshed.access_token;
    } catch (err) {
      this.logger.warn(
        `[calendar] Google token refresh exception: ${String(err)}`,
      );
      return decryptedAccessToken;
    }
  }

  private decrypt(encrypted: string, key: string): string {
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

  private encrypt(plaintext: string, key: string): string {
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

  private decryptSecretIfNeeded(value: string | null | undefined): string | null {
    if (!value) return null;
    if (!value.includes(':')) return value;
    const key = this.config.get<string>('encryption.key') ?? '';
    return this.decrypt(value, key) || null;
  }

  private async resolveInviteMailbox(
    organizationId: string,
    organizerEmail: string | null,
  ) {
    if (organizerEmail) {
      const organizerMailbox = await this.prisma.mailbox.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          email: organizerEmail,
        },
      });
      if (organizerMailbox) {
        return organizerMailbox;
      }
    }

    return this.prisma.mailbox.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private buildInviteTransport(
    mailbox: {
      name: string;
      email: string | null;
      smtpHost: string | null;
      smtpPort: number | null;
      smtpSecure: boolean;
      smtpUser: string | null;
      smtpPass: string | null;
      oauthAccessToken: string | null;
      oauthRefreshToken: string | null;
      googleAccessToken: string | null;
      googleRefreshToken: string | null;
    },
    fallbackFrom?: string,
  ): {
    transport: nodemailer.Transporter;
    fromEmail: string;
    replyTo: string;
  } {
    const globalHost = this.config.get<string>('smtp.host') ?? '';
    const globalPort = this.config.get<number>('smtp.port') ?? 587;
    const globalUser = this.config.get<string>('smtp.user') ?? '';
    const globalPass = this.config.get<string>('smtp.pass') ?? '';
    const globalFrom = this.config.get<string>('smtp.from') ?? '';

    const host = mailbox.smtpHost || globalHost;
    const port = mailbox.smtpPort || globalPort;
    const secure = mailbox.smtpSecure ?? port === 465;
    const smtpUser = mailbox.smtpUser || globalUser;
    const smtpPass =
      this.decryptSecretIfNeeded(mailbox.smtpPass) || globalPass || null;
    const oauthAccessToken =
      this.decryptSecretIfNeeded(mailbox.oauthAccessToken) ||
      this.decryptSecretIfNeeded(mailbox.googleAccessToken) ||
      null;
    const oauthRefreshToken =
      this.decryptSecretIfNeeded(mailbox.oauthRefreshToken) ||
      this.decryptSecretIfNeeded(mailbox.googleRefreshToken) ||
      null;

    if (!host) {
      throw new BadRequestException(
        'SMTP host is not configured for invite delivery.',
      );
    }

    const fromEmail = mailbox.email || fallbackFrom || globalFrom;
    if (!fromEmail) {
      throw new BadRequestException(
        'From email is not configured for invite delivery.',
      );
    }

    const transportOptions: any = {
      host,
      port,
      secure,
      tls: { rejectUnauthorized: false },
    };

    if (oauthAccessToken) {
      transportOptions.auth = {
        type: 'OAuth2',
        user: mailbox.email || fromEmail,
        accessToken: oauthAccessToken,
        ...(oauthRefreshToken ? { refreshToken: oauthRefreshToken } : {}),
      };
    } else if (smtpUser && smtpPass) {
      transportOptions.auth = {
        user: smtpUser,
        pass: smtpPass,
      };
    } else {
      throw new BadRequestException(
        'Mailbox authentication is missing for invite delivery.',
      );
    }

    return {
      transport: nodemailer.createTransport(transportOptions),
      fromEmail,
      replyTo: mailbox.email || fromEmail,
    };
  }

  private async auditLog(
    user: JwtUser,
    action: string,
    entityType: string,
    entityId: string,
    previousValue: object | null,
    newValue: object | null,
    meta: RequestMeta = {},
  ) {
    try {
      await this.auditService.log({
        organizationId: user.organizationId,
        userId: user.sub,
        action,
        entityType,
        entityId,
        previousValue:
          (previousValue as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        newValue: (newValue as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    } catch (err) {
      this.logger.warn(`[calendar] Audit log failed: ${String(err)}`);
    }
  }
}
