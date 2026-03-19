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
    const userRecord = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    const prefs =
      (userRecord?.preferences as Record<string, string> | null) ?? {};

    return {
      google: {
        connected: !!prefs['googleAccessToken'],
      },
      microsoft: {
        connected: !!prefs['microsoftAccessToken'],
      },
      zoom: {
        connected: !!prefs['zoomAccessToken'],
        expiresAt: prefs['zoomTokenExpiresAt'] ?? null,
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
