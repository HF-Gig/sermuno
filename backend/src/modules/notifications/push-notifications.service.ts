import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushProvider, Prisma } from '@prisma/client';
import type webPushType from 'web-push';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { QuietHoursService } from './quiet-hours.service';
import type { PushTokenDto, RevokePushTokenDto } from './dto/notification.dto';

type PushPayload = {
  notificationId: string;
  title: string;
  message: string | null;
  type: string;
  resourceId: string | null;
  url: string;
  soundEnabled: boolean;
  showDesktop?: boolean;
  channels?: {
    in_app?: boolean;
    email?: boolean;
    push?: boolean;
    desktop?: boolean;
  };
  data?: Record<string, unknown>;
};

type WebPushError = Error & {
  statusCode?: number;
  body?: string;
  headers?: Record<string, string>;
};

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private webPushModule: typeof webPushType | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly featureFlags: FeatureFlagsService,
    private readonly quietHours: QuietHoursService,
  ) {}

  async getClientConfig() {
    const enabled = this.featureFlags.isEnabled('ENABLE_PUSH_NOTIFICATIONS');
    const publicKey = this.config.get<string>('webPush.publicKey') ?? '';

    return {
      enabled,
      provider: 'web_push' as const,
      publicKey: enabled && publicKey ? publicKey : null,
    };
  }

  async listRegistrations(user: JwtUser) {
    return this.prisma.pushRegistration.findMany({
      where: {
        userId: user.sub,
        organizationId: user.organizationId,
      },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        provider: true,
        registrationKey: true,
        endpoint: true,
        deviceName: true,
        browserName: true,
        userAgent: true,
        soundEnabled: true,
        active: true,
        revokedAt: true,
        lastUsedAt: true,
        lastSuccessAt: true,
        lastFailureAt: true,
        lastFailureReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async register(dto: PushTokenDto, user: JwtUser) {
    const provider = dto.provider ?? (dto.subscription ? 'web_push' : 'fcm');
    const registrationKey = this.buildRegistrationKey(dto, provider);
    const endpoint = this.readEndpoint(dto);
    const token = dto.token?.trim() || null;

    if (provider === 'fcm') {
      throw new BadRequestException(
        'FCM registration is not supported yet. Use web_push registration.',
      );
    }

    if (provider === 'web_push' && (!dto.subscription || !endpoint)) {
      throw new BadRequestException(
        'Web push subscription payload with a valid endpoint is required',
      );
    }

    if (!registrationKey) {
      throw new BadRequestException(
        'Unable to derive a registration key from the push payload',
      );
    }

    const providerEnum = provider as PushProvider;
    const activeClaim = await this.prisma.pushRegistration.findFirst({
      where: {
        provider: providerEnum,
        registrationKey,
        active: true,
        revokedAt: null,
        NOT: {
          organizationId: user.organizationId,
          userId: user.sub,
        },
      },
      select: { id: true, userId: true, organizationId: true },
    });
    if (activeClaim) {
      throw new ConflictException(
        'Push registration key is already active for another account',
      );
    }

    const payload = {
      provider: providerEnum,
      registrationKey,
      endpoint,
      token,
      subscription: dto.subscription
        ? (dto.subscription as Prisma.InputJsonValue)
        : Prisma.DbNull,
      deviceName: dto.deviceName?.trim() || null,
      browserName: dto.browserName?.trim() || null,
      userAgent: dto.userAgent?.trim() || null,
      metadata: dto.metadata
        ? (dto.metadata as Prisma.InputJsonValue)
        : Prisma.DbNull,
      soundEnabled: Boolean(dto.soundEnabled),
      active: true,
      revokedAt: null,
      lastUsedAt: new Date(),
      lastFailureAt: null,
      lastFailureReason: null,
    };

    const existing = await this.prisma.pushRegistration.findFirst({
      where: {
        organizationId: user.organizationId,
        userId: user.sub,
        provider: providerEnum,
        registrationKey,
      },
      select: { id: true },
    });

    const registration = existing
      ? await this.prisma.pushRegistration.update({
          where: { id: existing.id },
          data: payload,
          select: {
            id: true,
            provider: true,
            registrationKey: true,
            endpoint: true,
            soundEnabled: true,
            active: true,
            revokedAt: true,
            updatedAt: true,
          },
        })
      : await this.prisma.pushRegistration.create({
          data: {
            userId: user.sub,
            organizationId: user.organizationId,
            ...payload,
          },
          select: {
            id: true,
            provider: true,
            registrationKey: true,
            endpoint: true,
            soundEnabled: true,
            active: true,
            revokedAt: true,
            updatedAt: true,
          },
        });

    this.logger.log(
      `[push] Registered provider=${registration.provider} key=${registration.registrationKey} user=${user.sub} org=${user.organizationId} sound=${registration.soundEnabled}`,
    );

    return registration;
  }

  async revoke(dto: RevokePushTokenDto, user: JwtUser) {
    const registrationKey =
      dto.registrationKey?.trim() || this.buildRegistrationKey(dto);
    const endpoint = this.readEndpoint(dto);
    const token = dto.token?.trim() || null;
    const whereClauses = [
      dto.registrationId ? { id: dto.registrationId } : undefined,
      registrationKey ? { registrationKey } : undefined,
      endpoint ? { endpoint } : undefined,
      token ? { token } : undefined,
    ].filter(Boolean) as Prisma.PushRegistrationWhereInput[];

    if (whereClauses.length === 0) {
      throw new BadRequestException(
        'Provide a registrationId, registrationKey, endpoint, subscription, or token to revoke.',
      );
    }

    const registration = await this.prisma.pushRegistration.findFirst({
      where: {
        userId: user.sub,
        organizationId: user.organizationId,
        OR: whereClauses,
      },
    });

    if (!registration) {
      return { success: true, updated: false };
    }

    await this.prisma.pushRegistration.update({
      where: { id: registration.id },
      data: {
        active: false,
        revokedAt: new Date(),
      },
    });

    this.logger.log(
      `[push] Revoked registration=${registration.id} key=${registration.registrationKey} user=${user.sub} org=${user.organizationId}`,
    );

    return { success: true, updated: true, id: registration.id };
  }

  async deliverToUser(params: {
    userId: string;
    organizationId: string;
    payload: Omit<PushPayload, 'soundEnabled'>;
  }) {
    if (!this.featureFlags.isEnabled('ENABLE_PUSH_NOTIFICATIONS')) {
      this.logger.debug('[push] Feature flag disabled; skipping delivery');
      return;
    }

    const registrations = await this.prisma.pushRegistration.findMany({
      where: {
        userId: params.userId,
        organizationId: params.organizationId,
        active: true,
        revokedAt: null,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (registrations.length === 0) {
      this.logger.debug(
        `[push] No active registrations for user=${params.userId}`,
      );
      return;
    }

    this.logger.log(
      `[push] Dispatch attempt notification=${params.payload.notificationId} user=${params.userId} org=${params.organizationId} registrations=${registrations.length}`,
    );

    const webPush = await this.ensureWebPush();
    const failures: string[] = [];
    let delivered = 0;
    const globalPref = await this.prisma.notificationPreference.findFirst({
      where: {
        userId: params.userId,
        notificationType: 'global',
      },
      select: {
        quietHoursStart: true,
        quietHoursEnd: true,
        quietHoursTimezone: true,
        quietHoursChannels: true,
      },
    });
    const channels = this.readChannels(params.payload.data);
    const showDesktop =
      (channels.desktop ?? true) &&
      !this.quietHours.isSuppressed(globalPref, 'desktop', new Date());
    if ((channels.desktop ?? true) && !showDesktop) {
      this.logger.log(
        `[push] Desktop channel suppressed by quiet hours user=${params.userId} notification=${params.payload.notificationId}`,
      );
    }

    for (const registration of registrations) {
      if (registration.provider !== 'web_push' || !registration.subscription) {
        this.logger.warn(
          `[push] Skipping unsupported registration id=${registration.id} provider=${registration.provider} hasSubscription=${Boolean(registration.subscription)} notification=${params.payload.notificationId}`,
        );
        continue;
      }

      try {
        await webPush.sendNotification(
          registration.subscription as webPushType.PushSubscription,
          JSON.stringify({
            ...params.payload,
            soundEnabled: registration.soundEnabled,
            showDesktop,
            channels,
          }),
        );
        delivered += 1;
        await this.prisma.pushRegistration.update({
          where: { id: registration.id },
          data: {
            lastUsedAt: new Date(),
            lastSuccessAt: new Date(),
            lastFailureAt: null,
            lastFailureReason: null,
          },
        });
        this.logger.log(
          `[push] Delivered registration=${registration.id} notification=${params.payload.notificationId} user=${params.userId}`,
        );
      } catch (error) {
        const err = error as WebPushError;
        failures.push(`${registration.id}:${err.statusCode ?? 'unknown'}`);
        if (this.shouldDeactivate(err)) {
          await this.prisma.pushRegistration.update({
            where: { id: registration.id },
            data: {
              active: false,
              revokedAt: new Date(),
              lastFailureAt: new Date(),
              lastFailureReason: err.body || err.message,
            },
          });
          continue;
        }

        await this.prisma.pushRegistration.update({
          where: { id: registration.id },
          data: {
            lastFailureAt: new Date(),
            lastFailureReason: err.body || err.message,
          },
        });
        this.logger.error(
          `[push] Delivery failed registration=${registration.id} notification=${params.payload.notificationId} status=${err.statusCode ?? 'unknown'} reason=${err.body || err.message}`,
        );
        throw error;
      }
    }

    if (delivered === 0 && failures.length > 0) {
      this.logger.warn(
        `[push] No registrations delivered for user=${params.userId}; failures=${failures.join(',')}`,
      );
      return;
    }

    this.logger.log(
      `[push] Dispatch complete notification=${params.payload.notificationId} user=${params.userId} delivered=${delivered} failures=${failures.length}`,
    );
  }

  resolveNotificationUrl(type?: string, resourceId?: string | null) {
    const frontendUrl =
      this.config.get<string>('frontend.url') || 'http://localhost:5173';
    const normalizedType = String(type || '').toLowerCase();
    const normalizedResourceId = resourceId ? String(resourceId) : '';

    let path = '/notifications';
    if (!normalizedResourceId) {
      if (normalizedType.startsWith('calendar')) {
        path = '/calendar';
      } else if (
        normalizedType.startsWith('message') ||
        normalizedType.startsWith('thread') ||
        normalizedType.startsWith('sla')
      ) {
        path = '/inbox';
      }
      return `${frontendUrl}${path}`;
    }

    if (normalizedType.startsWith('calendar')) {
      path = `/calendar?eventId=${encodeURIComponent(normalizedResourceId)}`;
    } else if (
      normalizedType.startsWith('message') ||
      normalizedType.startsWith('thread') ||
      normalizedType.startsWith('sla')
    ) {
      const threadId = this.normalizeThreadId(normalizedResourceId);
      path = `/inbox/thread/${this.toThreadRouteCode(threadId)}?tid=${encodeURIComponent(threadId)}`;
    }

    return `${frontendUrl}${path}`;
  }

  private readEndpoint(dto: {
    endpoint?: string;
    subscription?: Record<string, unknown>;
  }) {
    if (dto.endpoint?.trim()) {
      return dto.endpoint.trim();
    }
    const subscription = dto.subscription;
    const endpoint = subscription?.endpoint;
    return typeof endpoint === 'string' ? endpoint : null;
  }

  private buildRegistrationKey(
    dto: {
      registrationKey?: string;
      endpoint?: string;
      token?: string;
      subscription?: Record<string, unknown>;
    },
    fallbackProvider: 'web_push' | 'fcm' = 'web_push',
  ) {
    if (dto.registrationKey?.trim()) {
      return dto.registrationKey.trim();
    }

    const endpoint = this.readEndpoint(dto);
    if (endpoint) {
      return `web_push:${endpoint}`;
    }

    if (dto.token?.trim()) {
      return `${fallbackProvider}:${dto.token.trim()}`;
    }

    return '';
  }

  private shouldDeactivate(error: WebPushError) {
    return error.statusCode === 404 || error.statusCode === 410;
  }

  private readChannels(data?: Record<string, unknown>) {
    const raw = data?.channels;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {};
    }

    const channels = raw as Record<string, unknown>;
    return {
      in_app:
        typeof channels.in_app === 'boolean'
          ? channels.in_app
          : typeof channels.inApp === 'boolean'
            ? channels.inApp
            : undefined,
      email: typeof channels.email === 'boolean' ? channels.email : undefined,
      push: typeof channels.push === 'boolean' ? channels.push : undefined,
      desktop:
        typeof channels.desktop === 'boolean' ? channels.desktop : undefined,
    };
  }

  private toThreadRouteCode(threadId: string) {
    const base = this.normalizeThreadId(threadId);
    if (!base) {
      return '0';
    }

    let hash = 0;
    for (let i = 0; i < base.length; i += 1) {
      hash = (hash * 31 + base.charCodeAt(i)) % 1000000;
    }

    return String(hash).padStart(6, '0');
  }

  private normalizeThreadId(threadId: string) {
    const base = String(threadId || '');
    if (base.startsWith('thread-')) {
      return base;
    }

    return base.replace(/^t/, '');
  }

  private async ensureWebPush() {
    if (this.webPushModule) {
      return this.webPushModule;
    }

    const publicKey = this.config.get<string>('webPush.publicKey') ?? '';
    const privateKey = this.config.get<string>('webPush.privateKey') ?? '';
    const subject = this.config.get<string>('webPush.subject') ?? '';

    if (!publicKey || !privateKey || !subject) {
      throw new ServiceUnavailableException(
        'Web push is not configured. Set WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, and WEB_PUSH_SUBJECT.',
      );
    }

    const loaded = (await import('web-push')).default;
    loaded.setVapidDetails(subject, publicKey, privateKey);
    this.webPushModule = loaded;
    return loaded;
  }
}
