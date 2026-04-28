import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as https from 'https';

export interface MeetingResult {
  meetingLink: string;
  meetingId?: string;
  meetingPassword?: string;
  meetingProvider: string;
}

@Injectable()
export class VideoConferencingService {
  private readonly logger = new Logger(VideoConferencingService.name);

  constructor(private readonly config: ConfigService) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Google Meet
  // ──────────────────────────────────────────────────────────────────────────

  async createGoogleMeet(
    accessToken: string,
    title: string,
    startTime: Date,
    endTime: Date,
  ): Promise<MeetingResult> {
    const requestId = randomUUID();

    const body = JSON.stringify({
      summary: title,
      start: { dateTime: startTime.toISOString() },
      end: { dateTime: endTime.toISOString() },
      conferenceData: {
        createRequest: { requestId },
      },
    });

    const responseBody = await this.httpsPost(
      'www.googleapis.com',
      '/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
      {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    );

    const data = JSON.parse(responseBody) as {
      hangoutLink?: string;
      id?: string;
      conferenceData?: {
        entryPoints?: { uri?: string; entryPointType?: string }[];
      };
    };

    const meetingLink =
      data.hangoutLink ??
      data.conferenceData?.entryPoints?.find((e) =>
        e.entryPointType === 'video' && e.uri?.startsWith('https://'),
      )?.uri ??
      data.conferenceData?.entryPoints?.find((e) =>
        e.uri?.startsWith('https://'),
      )?.uri ??
      '';

    if (!meetingLink) {
      throw new Error(
        'Google Meet link was not returned by Google Calendar conference data',
      );
    }

    return {
      meetingLink,
      meetingId: data.id,
      meetingProvider: 'google_meet',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Zoom
  // ──────────────────────────────────────────────────────────────────────────

  async createZoomMeeting(
    accessToken: string,
    title: string,
    startTime: Date,
    durationMinutes: number,
  ): Promise<MeetingResult> {
    const body = JSON.stringify({
      topic: title,
      type: 2, // scheduled meeting
      start_time: startTime.toISOString(),
      duration: durationMinutes,
      settings: { join_before_host: true },
    });

    const responseBody = await this.httpsPost(
      'api.zoom.us',
      '/v2/users/me/meetings',
      {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    );

    const data = JSON.parse(responseBody) as {
      join_url?: string;
      id?: number | string;
      password?: string;
    };

    return {
      meetingLink: data.join_url ?? '',
      meetingId: String(data.id ?? ''),
      meetingPassword: data.password,
      meetingProvider: 'zoom',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Microsoft Teams
  // ──────────────────────────────────────────────────────────────────────────

  async createTeamsMeeting(
    accessToken: string,
    title: string,
    startTime: Date,
    endTime: Date,
  ): Promise<MeetingResult> {
    const body = JSON.stringify({
      subject: title,
      startDateTime: startTime.toISOString(),
      endDateTime: endTime.toISOString(),
    });

    const responseBody = await this.httpsPost(
      'graph.microsoft.com',
      '/v1.0/me/onlineMeetings',
      {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    );

    const data = JSON.parse(responseBody) as {
      joinWebUrl?: string;
      id?: string;
    };

    return {
      meetingLink: data.joinWebUrl ?? '',
      meetingId: data.id,
      meetingProvider: 'microsoft_teams',
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private httpsPost(
    hostname: string,
    path: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname,
        path,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(body),
        },
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
      req.write(body);
      req.end();
    });
  }
}
