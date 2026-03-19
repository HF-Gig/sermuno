import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { QuietHoursService } from './quiet-hours.service';
import { PrismaService } from '../../database/prisma.service';
import { NOTIFICATION_DISPATCH_QUEUE } from '../../jobs/queues/notification-dispatch.queue';

const mockPrisma = {
  notification: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  notificationPreference: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
  },
};

const mockQueue = {
  add: jest.fn(),
};

const mockQuietHours = {
  isSuppressed: jest.fn().mockReturnValue(false),
};

const mockEventsGateway = {
  emitToUser: jest.fn(),
};

const testUser = {
  sub: 'user-1',
  email: 'a@b.com',
  organizationId: 'org-1',
  role: 'user',
  permissions: [],
};

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.organization.findUnique.mockResolvedValue({
      notificationSettings: {},
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuietHoursService, useValue: mockQuietHours },
        {
          provide: getQueueToken(NOTIFICATION_DISPATCH_QUEUE),
          useValue: mockQueue,
        },
        {
          provide: 'EVENTS_GATEWAY',
          useValue: mockEventsGateway,
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------
  describe('findAll', () => {
    it('returns notifications for the current user', async () => {
      const rows = [{ id: 'n-1', userId: 'user-1', title: 'Hello' }];
      mockPrisma.notification.findMany.mockResolvedValue(rows);

      const result = await service.findAll(testUser);

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(rows);
    });
  });

  // ---------------------------------------------------------------------------
  // markRead
  // ---------------------------------------------------------------------------
  describe('markRead', () => {
    it('marks a notification as read', async () => {
      const notif = { id: 'n-1', userId: 'user-1' };
      const updated = { ...notif, readAt: new Date() };
      mockPrisma.notification.findFirst.mockResolvedValue(notif);
      mockPrisma.notification.update.mockResolvedValue(updated);

      const result = await service.markRead('n-1', testUser);
      expect(result.readAt).toBeDefined();
    });

    it('throws NotFoundException when notification not found', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);
      await expect(service.markRead('missing', testUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // markAllRead
  // ---------------------------------------------------------------------------
  describe('markAllRead', () => {
    it('marks all unread notifications as read', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });
      const result = await service.markAllRead(testUser);
      expect(result).toEqual({ success: true });
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // getSettings
  // ---------------------------------------------------------------------------
  describe('getSettings', () => {
    it('returns notification preferences for the user', async () => {
      const prefs = [
        { id: 'p-1', userId: 'user-1', notificationType: 'mention' },
      ];
      mockPrisma.notificationPreference.findMany.mockResolvedValue(prefs);
      const result = await service.getSettings(testUser);
      expect(mockPrisma.notificationPreference.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { notificationType: 'asc' },
      });
      expect(Object.keys(result.preferences)).toContain('mention');
      expect(result.preferences.mention.enabled).toBeTruthy();
      expect(result.quietHours.timezone).toBe('UTC');
    });
  });

  // ---------------------------------------------------------------------------
  // updateSettings
  // ---------------------------------------------------------------------------
  describe('updateSettings', () => {
    it('upserts preferences for each type in the payload', async () => {
      const upserted = {
        id: 'p-1',
        userId: 'user-1',
        notificationType: 'mention',
      };
      mockPrisma.notificationPreference.upsert.mockResolvedValue(upserted);

      const result = await service.updateSettings(
        { preferences: { mention: { email: true, push: false } } },
        testUser,
      );

      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getQuietHours
  // ---------------------------------------------------------------------------
  describe('getQuietHours', () => {
    it('returns quiet hours from global pref row', async () => {
      mockPrisma.notificationPreference.findFirst.mockResolvedValue({
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        quietHoursTimezone: 'America/New_York',
        quietHoursChannels: ['email'],
      });
      const result = await service.getQuietHours(testUser);
      expect(result.start).toBe('22:00');
      expect(result.end).toBe('07:00');
      expect(result.timezone).toBe('America/New_York');
      expect(result.channels).toEqual(['email']);
    });

    it('returns nulls when no pref exists', async () => {
      mockPrisma.notificationPreference.findFirst.mockResolvedValue(null);
      const result = await service.getQuietHours(testUser);
      expect(result.start).toBeNull();
      expect(result.end).toBeNull();
      expect(result.timezone).toBe('UTC');
      expect(result.channels).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // updateQuietHours
  // ---------------------------------------------------------------------------
  describe('updateQuietHours', () => {
    it('upserts global quiet hours pref', async () => {
      const upserted = {
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        quietHoursTimezone: 'UTC',
        quietHoursChannels: [],
      };
      mockPrisma.notificationPreference.upsert.mockResolvedValue(upserted);
      const result = await service.updateQuietHours(
        { start: '22:00', end: '07:00', timezone: 'UTC' },
        testUser,
      );
      expect(result.start).toBe('22:00');
      expect(result.end).toBe('07:00');
    });
  });

  // ---------------------------------------------------------------------------
  // dispatch
  // ---------------------------------------------------------------------------
  describe('dispatch', () => {
    const baseParams = {
      userId: 'user-1',
      organizationId: 'org-1',
      type: 'mention',
      title: 'You were mentioned',
      message: 'in thread X',
      resourceId: 'thread-1',
    };

    beforeEach(() => {
      mockPrisma.notification.create.mockResolvedValue({
        id: 'n-new',
        ...baseParams,
      });
      mockPrisma.notificationPreference.findFirst.mockResolvedValue(null);
      mockQuietHours.isSuppressed.mockReturnValue(false);
    });

    it('always creates an in-app notification record', async () => {
      await service.dispatch(baseParams);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ channel: 'in_app' }),
        }),
      );
    });

    it('emits via WebSocket gateway', async () => {
      await service.dispatch(baseParams);
      expect(mockEventsGateway.emitToUser).toHaveBeenCalledWith(
        'user-1',
        'notification',
        expect.any(Object),
      );
    });

    it('enqueues email dispatch when pref.email is not false', async () => {
      mockPrisma.notificationPreference.findFirst.mockResolvedValue({
        email: true,
        push: false,
        slack: false,
        quietHoursStart: null,
        quietHoursEnd: null,
        quietHoursTimezone: null,
        quietHoursChannels: [],
      });
      await service.dispatch(baseParams);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'dispatch',
        expect.objectContaining({ channel: 'email' }),
      );
    });

    it('suppresses email when quiet hours are active', async () => {
      mockPrisma.notificationPreference.findFirst.mockResolvedValue({
        email: true,
        push: false,
        slack: false,
        quietHoursStart: '22:00',
        quietHoursEnd: '06:00',
        quietHoursTimezone: 'UTC',
        quietHoursChannels: [],
      });
      mockQuietHours.isSuppressed.mockReturnValue(true);
      await service.dispatch(baseParams);
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

  });
});
