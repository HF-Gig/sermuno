import {
  Injectable,
  NotFoundException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { QuietHoursService } from './quiet-hours.service';
import { NOTIFICATION_DISPATCH_QUEUE } from '../../jobs/queues/notification-dispatch.queue';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  DispatchNotificationParams,
  UpdateNotificationSettingsDto,
  NotificationChannelConfigDto,
  UpdateOrganizationNotificationSettingsDto,
  UpdateQuietHoursDto,
} from './dto/notification.dto';
import { Prisma } from '@prisma/client';
import type { EventsGateway } from '../websockets/events.gateway';

type ChannelMap = {
  in_app: boolean;
  email: boolean;
  push: boolean;
  desktop: boolean;
};

type TypeSetting = {
  enabled: boolean;
  channels: ChannelMap;
  config: Record<string, unknown>;
};

type OrgSettings = {
  types: Record<string, TypeSetting>;
};

const NOTIFICATION_TYPE_DEFS: Record<
  string,
  { config: Record<string, unknown>; channels: ChannelMap }
> = {
  new_message: {
    channels: { in_app: true, email: true, push: false, desktop: false },
    config: { scope: 'all_mailboxes', mailboxIds: [] },
  },
  thread_assigned: {
    channels: { in_app: true, email: true, push: false, desktop: false },
    config: {},
  },
  mention: {
    channels: { in_app: true, email: true, push: false, desktop: false },
    config: {},
  },
  sla_warning: {
    channels: { in_app: true, email: true, push: false, desktop: false },
    config: { minutesBeforeBreach: 30 },
  },
  sla_breach: {
    channels: { in_app: true, email: true, push: false, desktop: false },
    config: {},
  },
  thread_reply: {
    channels: { in_app: true, email: true, push: false, desktop: false },
    config: { scope: 'assigned_threads_only' },
  },
  rule_triggered: {
    channels: { in_app: true, email: true, push: false, desktop: false },
    config: { ruleIds: [] },
  },
  contact_activity: {
    channels: { in_app: true, email: true, push: false, desktop: false },
    config: { contactIds: [] },
  },
  daily_digest: {
    channels: { in_app: false, email: true, push: false, desktop: false },
    config: { time: '09:00', timezone: 'UTC', includeStatistics: true },
  },
  weekly_report: {
    channels: { in_app: false, email: true, push: false, desktop: false },
    config: { day: 'monday', time: '09:00', timezone: 'UTC' },
  },
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quietHours: QuietHoursService,
    @InjectQueue(NOTIFICATION_DISPATCH_QUEUE)
    private readonly dispatchQueue: Queue,
    @Inject(forwardRef(() => 'EVENTS_GATEWAY'))
    private readonly eventsGateway: EventsGateway | null,
  ) {}

  async findAll(user: JwtUser) {
    return this.prisma.notification.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markRead(id: string, user: JwtUser) {
    const n = await this.prisma.notification.findFirst({
      where: { id, userId: user.sub },
    });
    if (!n) throw new NotFoundException('Notification not found');
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(user: JwtUser) {
    await this.prisma.notification.updateMany({
      where: { userId: user.sub, readAt: null },
      data: { readAt: new Date() },
    });
    return { success: true };
  }

  async getSettings(user: JwtUser) {
    const [prefs, quietHours, orgSettings] = await Promise.all([
      this.prisma.notificationPreference.findMany({
        where: { userId: user.sub },
        orderBy: { notificationType: 'asc' },
      }),
      this.getQuietHours(user),
      this.getOrganizationSettingsInternal(user.organizationId),
    ]);

    const prefMap = new Map(prefs.map((pref) => [pref.notificationType, pref]));
    const preferences = Object.fromEntries(
      Object.keys(NOTIFICATION_TYPE_DEFS).map((type) => {
        const base = orgSettings.types[type];
        const pref = prefMap.get(type);
        return [
          type,
          {
            enabled: pref?.enabled ?? base.enabled,
            channels: {
              in_app:
                base.channels.in_app && (pref?.inApp ?? base.channels.in_app),
              email:
                base.channels.email && (pref?.email ?? base.channels.email),
              push: base.channels.push && (pref?.push ?? base.channels.push),
              desktop:
                base.channels.desktop &&
                (pref?.desktop ?? base.channels.desktop),
            },
            config: {
              ...base.config,
              ...this.readObject(pref?.config),
            },
            restrictedChannels: Object.entries(base.channels)
              .filter(([, enabled]) => !enabled)
              .map(([channel]) => channel),
          },
        ];
      }),
    );

    return {
      preferences,
      quietHours,
    };
  }

  async updateSettings(dto: UpdateNotificationSettingsDto, user: JwtUser) {
    const rawPrefs: Record<string, NotificationChannelConfigDto> =
      dto.preferences ?? {};
    const orgSettings = await this.getOrganizationSettingsInternal(
      user.organizationId,
    );

    const results = await Promise.all(
      Object.entries(rawPrefs)
        .filter(([type]) => Object.keys(NOTIFICATION_TYPE_DEFS).includes(type))
        .map(([type, payload]) => {
          const base = orgSettings.types[type];
          const channels = this.normalizeChannels(payload, base.channels);

          return this.prisma.notificationPreference.upsert({
            where: {
              userId_notificationType: {
                userId: user.sub,
                notificationType: type,
              },
            },
            create: {
              userId: user.sub,
              organizationId: user.organizationId,
              notificationType: type,
              enabled: payload.enabled ?? true,
              inApp: channels.in_app,
              email: channels.email,
              push: channels.push,
              desktop: channels.desktop,
              config: this.normalizeObject(payload.config),
            },
            update: {
              enabled: payload.enabled ?? true,
              inApp: channels.in_app,
              email: channels.email,
              push: channels.push,
              desktop: channels.desktop,
              config: this.normalizeObject(payload.config),
            },
          });
        }),
    );

    return results;
  }

  async getQuietHours(user: JwtUser) {
    const pref = await this.prisma.notificationPreference.findFirst({
      where: { userId: user.sub, notificationType: 'global' },
    });
    return {
      enabled: !!(pref?.quietHoursStart && pref?.quietHoursEnd),
      start: pref?.quietHoursStart ?? null,
      end: pref?.quietHoursEnd ?? null,
      startTime: pref?.quietHoursStart ?? null,
      endTime: pref?.quietHoursEnd ?? null,
      timezone: pref?.quietHoursTimezone ?? 'UTC',
      channels: Array.isArray(pref?.quietHoursChannels)
        ? (pref?.quietHoursChannels as string[])
        : [],
    };
  }

  async updateQuietHours(dto: UpdateQuietHoursDto, user: JwtUser) {
    const start = dto.start ?? dto.startTime;
    const end = dto.end ?? dto.endTime;
    const enabled = dto.enabled ?? true;

    const updated = await this.prisma.notificationPreference.upsert({
      where: {
        userId_notificationType: {
          userId: user.sub,
          notificationType: 'global',
        },
      },
      create: {
        userId: user.sub,
        organizationId: user.organizationId,
        notificationType: 'global',
        enabled: true,
        inApp: true,
        email: false,
        push: false,
        desktop: false,
        quietHoursStart: enabled ? (start ?? null) : null,
        quietHoursEnd: enabled ? (end ?? null) : null,
        quietHoursTimezone: dto.timezone ?? 'UTC',
        quietHoursChannels: (dto.channels ??
          []) as unknown as Prisma.InputJsonValue,
      },
      update: {
        quietHoursStart: enabled ? (start ?? null) : null,
        quietHoursEnd: enabled ? (end ?? null) : null,
        ...(dto.timezone !== undefined && { quietHoursTimezone: dto.timezone }),
        ...(dto.channels !== undefined && {
          quietHoursChannels: dto.channels as unknown as Prisma.InputJsonValue,
        }),
      },
    });

    return {
      enabled: !!(updated.quietHoursStart && updated.quietHoursEnd),
      start: updated.quietHoursStart,
      end: updated.quietHoursEnd,
      startTime: updated.quietHoursStart,
      endTime: updated.quietHoursEnd,
      timezone: updated.quietHoursTimezone,
      channels: Array.isArray(updated.quietHoursChannels)
        ? (updated.quietHoursChannels as string[])
        : [],
    };
  }

  async getOrganizationSettings(user: JwtUser) {
    return this.getOrganizationSettingsInternal(user.organizationId);
  }

  async updateOrganizationSettings(
    dto: UpdateOrganizationNotificationSettingsDto,
    user: JwtUser,
  ) {
    const current = await this.getOrganizationSettingsInternal(
      user.organizationId,
    );
    const source = {
      ...(dto.defaults ?? {}),
      ...(dto.types ?? {}),
    } as Record<string, NotificationChannelConfigDto>;

    const normalized: OrgSettings = {
      types: Object.fromEntries(
        Object.keys(NOTIFICATION_TYPE_DEFS).map((type) => {
          const base = current.types[type];
          const override: NotificationChannelConfigDto = source[type] ?? {};
          return [
            type,
            {
              enabled: override.enabled ?? base.enabled,
              channels: this.normalizeChannels(override, base.channels),
              config: {
                ...base.config,
                ...this.readObject(override.config),
              },
            },
          ];
        }),
      ),
    };

    await this.prisma.organization.update({
      where: { id: user.organizationId },
      data: {
        notificationSettings: normalized as unknown as Prisma.InputJsonValue,
      },
    });

    return normalized;
  }

  async dispatch(params: DispatchNotificationParams): Promise<void> {
    const { userId, type, title, message, resourceId } = params;
    const definition = NOTIFICATION_TYPE_DEFS[type];
    if (!definition) {
      this.logger.warn(
        `[notifications] Unknown notification type "${type}"; skipping dispatch`,
      );
      return;
    }

    const mailboxId =
      typeof params.data?.mailboxId === 'string' ? params.data.mailboxId : null;
    if (mailboxId) {
      const mailbox = await this.prisma.mailbox.findFirst({
        where: {
          id: mailboxId,
          organizationId: params.organizationId,
          deletedAt: null,
        },
        select: { syncStatus: true, lastSyncError: true },
      });
      if (
        mailbox?.syncStatus === 'FAILED' &&
        mailbox?.lastSyncError === 'OAuth disconnected'
      ) {
        return;
      }
    }

    const [userPref, globalPref, orgSettings] = await Promise.all([
      this.prisma.notificationPreference.findFirst({
        where: { userId, notificationType: type },
      }),
      this.prisma.notificationPreference.findFirst({
        where: { userId, notificationType: 'global' },
      }),
      this.getOrganizationSettingsInternal(params.organizationId),
    ]);

    const orgTypeSetting = orgSettings.types[type];
    if (!orgTypeSetting.enabled) {
      return;
    }

    const effectiveChannels: ChannelMap = {
      in_app:
        orgTypeSetting.channels.in_app &&
        (userPref?.inApp ?? orgTypeSetting.channels.in_app),
      email:
        (params.channels?.email ?? false) ||
        (orgTypeSetting.channels.email &&
          (userPref?.email ?? orgTypeSetting.channels.email)),
      push: false,
      desktop:
        (params.channels?.desktop ?? false) ||
        (orgTypeSetting.channels.desktop &&
          (userPref?.desktop ?? orgTypeSetting.channels.desktop)),
    };
    const effectiveConfig = {
      ...orgTypeSetting.config,
      ...this.readObject(userPref?.config),
    };

    if (userPref?.enabled === false) {
      return;
    }
    if (!this.matchesTypeConfig(type, effectiveConfig, params, userId)) {
      return;
    }
    if (!Object.values(effectiveChannels).some(Boolean)) {
      return;
    }

    const notification = await this.prisma.notification.create({
      data: {
        organizationId: params.organizationId,
        userId,
        type,
        title,
        message: message ?? null,
        data: {
          ...(params.data ?? {}),
          channels: effectiveChannels,
        } as unknown as Prisma.InputJsonValue,
        resourceId: resourceId ?? null,
        channel: effectiveChannels.in_app
          ? 'in_app'
          : effectiveChannels.desktop
            ? 'desktop'
            : effectiveChannels.email
              ? 'email'
              : 'push',
      },
    });

    if (effectiveChannels.in_app || effectiveChannels.desktop) {
      const payload = { ...notification, channels: effectiveChannels };
      this.eventsGateway?.emitToUser(userId, 'notification:new', payload);
      this.eventsGateway?.emitToUser(userId, 'notification', payload);
    }

    const now = new Date();
    const enqueue = async (channel: 'email' | 'push') => {
      if (this.quietHours.isSuppressed(globalPref, channel, now)) {
        this.logger.log(
          `[notifications] Channel=${channel} suppressed by quiet hours for user=${userId}`,
        );
        return;
      }
      await this.dispatchQueue.add('dispatch', {
        notificationId: notification.id,
        organizationId: params.organizationId,
        userId,
        channel,
      });
    };

    if (effectiveChannels.email) {
      await enqueue('email');
    }
  }

  private async getOrganizationSettingsInternal(
    organizationId: string,
  ): Promise<OrgSettings> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { notificationSettings: true },
    });
    const stored = this.readObject<{
      types?: Record<string, NotificationChannelConfigDto>;
    }>(organization?.notificationSettings);
    const storedTypes = this.readObject<
      Record<string, NotificationChannelConfigDto>
    >(stored.types);

    return {
      types: Object.fromEntries(
        Object.entries(NOTIFICATION_TYPE_DEFS).map(([type, def]) => {
          const override = this.readObject<NotificationChannelConfigDto>(
            storedTypes[type],
          );
          return [
            type,
            {
              enabled: override.enabled ?? true,
              channels: this.normalizeChannels(override, def.channels),
              config: {
                ...def.config,
                ...this.readObject(override.config),
              },
            } satisfies TypeSetting,
          ];
        }),
      ),
    };
  }

  private normalizeChannels(
    source: NotificationChannelConfigDto | Record<string, unknown>,
    fallback: ChannelMap,
  ): ChannelMap {
    const rawChannels = this.readObject(
      (source as { channels?: unknown }).channels,
    );
    return {
      in_app: Boolean(
        rawChannels.in_app ??
        rawChannels.inApp ??
        source.in_app ??
        source.inApp ??
        fallback.in_app,
      ),
      email: Boolean(rawChannels.email ?? source.email ?? fallback.email),
      push: Boolean(rawChannels.push ?? source.push ?? fallback.push),
      desktop: Boolean(
        rawChannels.desktop ?? source.desktop ?? fallback.desktop,
      ),
    };
  }

  private matchesTypeConfig(
    type: string,
    config: Record<string, unknown>,
    params: DispatchNotificationParams,
    userId: string,
  ) {
    if (type === 'new_message' && config.scope === 'per_mailbox') {
      const allowedMailboxIds = Array.isArray(config.mailboxIds)
        ? config.mailboxIds.map(String)
        : [];
      if (allowedMailboxIds.length > 0) {
        const mailboxId =
          typeof params.data?.mailboxId === 'string'
            ? params.data.mailboxId
            : '';
        return allowedMailboxIds.includes(mailboxId);
      }
    }

    if (type === 'thread_reply' && config.scope === 'assigned_threads_only') {
      const assignedUserId =
        typeof params.data?.assignedToUserId === 'string'
          ? params.data.assignedToUserId
          : '';
      return !assignedUserId || assignedUserId === userId;
    }

    if (type === 'rule_triggered') {
      const ruleIds = Array.isArray(config.ruleIds)
        ? config.ruleIds.map(String)
        : [];
      if (ruleIds.length > 0) {
        const ruleId =
          typeof params.data?.ruleId === 'string' ? params.data.ruleId : '';
        return ruleIds.includes(ruleId);
      }
    }

    if (type === 'contact_activity') {
      const contactIds = Array.isArray(config.contactIds)
        ? config.contactIds.map(String)
        : [];
      if (contactIds.length > 0) {
        const contactId =
          typeof params.data?.contactId === 'string'
            ? params.data.contactId
            : '';
        return contactIds.includes(contactId);
      }
    }

    if (type === 'sla_warning') {
      const threshold = Number(config.minutesBeforeBreach || 30);
      const minutesUntilBreach = Number(
        params.data?.minutesUntilBreach ?? threshold,
      );
      return Number.isNaN(minutesUntilBreach)
        ? true
        : minutesUntilBreach <= threshold;
    }

    return true;
  }

  private readObject<T extends object = Record<string, unknown>>(
    value: unknown,
  ): T {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as T)
      : ({} as T);
  }

  private normalizeObject(value: unknown): Prisma.InputJsonValue {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Prisma.InputJsonValue)
      : {};
  }
}
