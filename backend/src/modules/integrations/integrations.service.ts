import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getStatus(user: JwtUser) {
    const [googleMailbox, microsoftMailbox, userRecord] = await Promise.all([
      this.prisma.mailbox.findFirst({
        where: {
          organizationId: user.organizationId,
          provider: 'GMAIL',
          deletedAt: null,
          OR: [
            { oauthAccessToken: { not: null } },
            { googleAccessToken: { not: null } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          email: true,
          oauthAccessToken: true,
          oauthRefreshToken: true,
          oauthTokenExpiresAt: true,
          googleAccessToken: true,
          googleRefreshToken: true,
          googleTokenExpiresAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.mailbox.findFirst({
        where: {
          organizationId: user.organizationId,
          provider: 'OUTLOOK',
          deletedAt: null,
          OR: [
            { oauthAccessToken: { not: null } },
            { oauthRefreshToken: { not: null } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        select: {
          email: true,
          oauthAccessToken: true,
          oauthRefreshToken: true,
          oauthTokenExpiresAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.user.findUnique({
        where: { id: user.sub },
      }),
    ]);

    const prefs =
      (userRecord?.preferences as Record<string, string> | null) ?? {};
    const googleConnected = Boolean(
      googleMailbox &&
        this.hasUsableToken({
          accessToken:
            googleMailbox.oauthAccessToken || googleMailbox.googleAccessToken,
          refreshToken:
            googleMailbox.oauthRefreshToken || googleMailbox.googleRefreshToken,
          expiresAt:
            googleMailbox.oauthTokenExpiresAt || googleMailbox.googleTokenExpiresAt,
        }),
    );
    const microsoftConnected = Boolean(
      microsoftMailbox &&
        this.hasUsableToken({
          accessToken: microsoftMailbox.oauthAccessToken,
          refreshToken: microsoftMailbox.oauthRefreshToken,
          expiresAt: microsoftMailbox.oauthTokenExpiresAt,
        }),
    );

    return {
      google: {
        connected: googleConnected,
        healthy: googleConnected,
        account: googleMailbox?.email ?? null,
        lastCheckedAt: googleMailbox?.updatedAt?.toISOString() ?? null,
      },
      microsoft: {
        connected: microsoftConnected,
        healthy: microsoftConnected,
        account: microsoftMailbox?.email ?? null,
        lastCheckedAt: microsoftMailbox?.updatedAt?.toISOString() ?? null,
      },
      zoom: {
        connected: !!prefs['zoomAccessToken'],
        expiresAt: prefs['zoomTokenExpiresAt'] ?? null,
      },
      caldav: {
        connected:
          !!prefs['calDavUrl'] &&
          !!prefs['calDavUsername'] &&
          !!prefs['calDavPassword'],
        url: prefs['calDavUrl'] ?? null,
        username: prefs['calDavUsername'] ?? null,
        calendarName: prefs['calDavCalendarDisplayName'] ?? null,
        lastCheckedAt: prefs['calDavLastSyncedAt'] ?? null,
        lastError: prefs['calDavLastError'] ?? null,
      },
    };
  }

  async deleteZoom(user: JwtUser): Promise<void> {
    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    const prefs =
      (userRecord?.preferences as Record<string, string> | null) ?? {};
    const encKey = this.config.get<string>('encryption.key') ?? '';

    // Attempt to revoke with Zoom API if we have a token
    if (prefs['zoomAccessToken']) {
      try {
        const accessToken = this.decrypt(prefs['zoomAccessToken'], encKey);
        if (accessToken) {
          const clientId = this.config.get<string>('zoom.clientId');
          const clientSecret = this.config.get<string>('zoom.clientSecret');
          const credentials = Buffer.from(
            `${clientId}:${clientSecret}`,
          ).toString('base64');

          await fetch(
            `https://zoom.us/oauth/revoke?token=${encodeURIComponent(accessToken)}`,
            {
              method: 'POST',
              headers: { Authorization: `Basic ${credentials}` },
            },
          );
        }
      } catch (err) {
        this.logger.warn(
          `[integrations] Zoom revoke failed (non-fatal): ${String(err)}`,
        );
      }
    }

    // Remove from preferences
    const { zoomAccessToken, zoomRefreshToken, zoomTokenExpiresAt, ...rest } =
      prefs;
    void zoomAccessToken;
    void zoomRefreshToken;
    void zoomTokenExpiresAt;

    await this.prisma.user.update({
      where: { id: user.sub },
      data: { preferences: rest },
    });
  }

  async deleteCalDav(user: JwtUser): Promise<void> {
    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    const prefs =
      (userRecord?.preferences as Record<string, string> | null) ?? {};

    const {
      calDavUrl,
      calDavUsername,
      calDavPassword,
      calDavCalendarUrl,
      calDavCalendarDisplayName,
      calDavLastSyncedAt,
      calDavLastError,
      ...rest
    } = prefs;
    void calDavUrl;
    void calDavUsername;
    void calDavPassword;
    void calDavCalendarUrl;
    void calDavCalendarDisplayName;
    void calDavLastSyncedAt;
    void calDavLastError;

    await this.prisma.user.update({
      where: { id: user.sub },
      data: { preferences: rest },
    });
  }

  private hasUsableToken(params: {
    accessToken: string | null | undefined;
    refreshToken: string | null | undefined;
    expiresAt: Date | null | undefined;
  }): boolean {
    const { accessToken, refreshToken, expiresAt } = params;
    if (!accessToken && !refreshToken) return false;
    if (!expiresAt) return true;
    return (
      expiresAt.getTime() - Date.now() > 2 * 60 * 1000 ||
      Boolean(refreshToken)
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

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
}
