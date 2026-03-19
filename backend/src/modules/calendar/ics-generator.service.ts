import { Injectable } from '@nestjs/common';
import ical from 'ical-generator';
import { RRule } from 'rrule';

export interface IcsAttendee {
  email: string;
  name?: string;
}

export interface IcsEventData {
  id: string;
  title: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  timezone?: string;
  location?: string;
  meetingLink?: string;
  meetingProvider?: string;
  organizerEmail: string;
  organizerName?: string;
  attendees: IcsAttendee[];
  recurrenceRule?: string;
  recurrenceEnd?: Date;
}

@Injectable()
export class IcsGeneratorService {
  generate(event: IcsEventData): string {
    const cal = ical({ name: 'Sermuno Calendar' });

    const tz = event.timezone ?? 'UTC';

    // Build location: prefer meetingLink for video calls, else physical location
    const location = event.meetingLink ?? event.location;

    const calEvent = cal.createEvent({
      id: event.id,
      start: event.startTime,
      end: event.endTime,
      timezone: tz,
      summary: event.title,
      description: event.description,
      location,
      organizer: {
        name: event.organizerName ?? event.organizerEmail,
        email: event.organizerEmail,
      },
    });

    // Add attendees
    for (const att of event.attendees) {
      calEvent.createAttendee({
        email: att.email,
        name: att.name,
        rsvp: true,
      });
    }

    // Add CONFERENCE URL for video conferences
    if (event.meetingLink && event.meetingProvider) {
      // ical-generator supports x-prop / url; store as description supplement
      // conference property is surfaced via location already
    }

    // Add recurrence rule
    if (event.recurrenceRule) {
      try {
        const rule = RRule.fromString(event.recurrenceRule);
        // ical-generator v10 accepts RRule objects directly
        calEvent.repeating(rule);
      } catch {
        // Invalid RRULE — skip
      }
    }

    return cal.toString();
  }
}
