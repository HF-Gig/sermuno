import { Injectable } from '@nestjs/common';

interface QuietHoursPref {
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursTimezone: string | null;
  quietHoursChannels: unknown; // JSON — expected string[] | null
}

@Injectable()
export class QuietHoursService {
  /**
   * Returns true when the given channel should be suppressed for delivery.
   * Quiet hours ONLY silence delivery — the in-app record is always created.
   */
  isSuppressed(
    pref: QuietHoursPref | null,
    channel: string,
    now: Date,
  ): boolean {
    if (!pref) return false;
    if (!pref.quietHoursStart || !pref.quietHoursEnd) return false;

    // Check if this channel is in the quiet-hours scope
    const channels = Array.isArray(pref.quietHoursChannels)
      ? (pref.quietHoursChannels as string[])
      : [];
    // Empty array means ALL channels; otherwise only the listed ones
    if (channels.length > 0 && !channels.includes(channel)) return false;

    const tz = pref.quietHoursTimezone ?? 'UTC';

    // Current time as "HH:mm" in the requested timezone
    const timeStr = now.toLocaleString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: tz,
    }); // e.g. "23:00"

    const start = pref.quietHoursStart; // "HH:mm"
    const end = pref.quietHoursEnd; // "HH:mm"

    if (start <= end) {
      // Same-day window: e.g. 22:00–06:00 reversed vs 09:00–17:00
      return timeStr >= start && timeStr < end;
    }
    // Overnight window: e.g. start="22:00", end="06:00"
    return timeStr >= start || timeStr < end;
  }
}
