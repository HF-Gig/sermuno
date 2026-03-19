import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'admin@test.com',
  organizationId: 'org-1',
  role: 'ADMIN',
  permissions: [],
};

const mockPrisma = {
  webhook: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn(),
};

describe('WebhooksService', () => {
  let service: WebhooksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<WebhooksService>(WebhooksService);
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('returns active (non-deleted) webhooks for the org', async () => {
      const hooks = [
        { id: 'wh1', url: 'https://a.com/hook', organizationId: 'org-1' },
      ];
      mockPrisma.webhook.findMany.mockResolvedValue(hooks);
      const result = await service.list(mockUser);
      expect(result).toEqual(hooks);
      expect(mockPrisma.webhook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            deletedAt: null,
          }),
        }),
      );
    });
  });

  describe('create', () => {
    it('creates a webhook with a generated secret when not provided', async () => {
      const hook = { id: 'wh1', url: 'https://a.com', secret: 'auto-secret' };
      mockPrisma.webhook.create.mockResolvedValue(hook);
      const result = await service.create(
        { url: 'https://a.com', events: ['thread.created'] },
        mockUser,
      );
      expect(result).toEqual(hook);
      expect(mockPrisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            url: 'https://a.com',
          }),
        }),
      );
    });

    it('uses the provided secret', async () => {
      mockPrisma.webhook.create.mockResolvedValue({ id: 'wh1' });
      await service.create(
        {
          url: 'https://b.com',
          events: ['message.received'],
          secret: 'my-secret',
        },
        mockUser,
      );
      expect(mockPrisma.webhook.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ secret: 'my-secret' }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns webhook if found', async () => {
      const hook = { id: 'wh1', url: 'https://a.com' };
      mockPrisma.webhook.findFirst.mockResolvedValue(hook);
      const result = await service.findOne('wh1', mockUser);
      expect(result).toEqual(hook);
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates webhook fields', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValue({ id: 'wh1' });
      mockPrisma.webhook.update.mockResolvedValue({
        id: 'wh1',
        isActive: false,
      });
      const result = await service.update('wh1', { isActive: false }, mockUser);
      expect(result).toHaveProperty('isActive', false);
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValue(null);
      await expect(service.update('bad-id', {}, mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes the webhook', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValue({ id: 'wh1' });
      mockPrisma.webhook.update.mockResolvedValue({});
      await service.remove('wh1', mockUser);
      expect(mockPrisma.webhook.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValue(null);
      await expect(service.remove('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('handleIncoming', () => {
    it('returns received: true when no signature configured', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValue(null); // no matching webhook
      const result = await service.handleIncoming('org-1', '{}', undefined, {});
      expect(result).toEqual({ received: true });
    });

    it('returns received: false when signature does not match', async () => {
      mockPrisma.webhook.findFirst.mockResolvedValue({
        secret: 'correct-secret',
        isActive: true,
      });
      const result = await service.handleIncoming(
        'org-1',
        '{"key":"val"}',
        'sha256=wrongsig',
        { key: 'val' },
      );
      expect(result).toEqual({ received: false });
    });
  });

  describe('dispatch', () => {
    it('skips dispatch when ENABLE_WEBHOOKS is false', async () => {
      mockConfig.get.mockReturnValue(false);
      await service.dispatch('org-1', 'thread.created', {});
      expect(mockPrisma.webhook.findMany).not.toHaveBeenCalled();
    });

    it('skips hooks that do not subscribe to the event type', async () => {
      mockConfig.get.mockReturnValue(true);
      mockPrisma.webhook.findMany.mockResolvedValue([
        {
          id: 'wh1',
          url: 'https://x.com',
          secret: 'sec',
          events: ['message.received'],
          consecutiveFailures: 0,
          maxRetries: 3,
        },
      ]);
      // Should not attempt any delivery since event type doesn't match
      const spy = jest.spyOn(service as never, 'deliverWithRetry');
      await service.dispatch('org-1', 'thread.created', {});
      expect(spy).not.toHaveBeenCalled();
    });

    it('dispatches to matching hooks', async () => {
      mockConfig.get.mockReturnValue(true);
      mockPrisma.webhook.findMany.mockResolvedValue([
        {
          id: 'wh1',
          url: 'https://x.com/hook',
          secret: 'sec',
          events: ['thread.created'],
          consecutiveFailures: 0,
          maxRetries: 3,
        },
      ]);
      mockPrisma.webhook.update.mockResolvedValue({});
      const spy = jest
        .spyOn(service as never, 'deliverWithRetry')
        .mockResolvedValue(undefined as never);
      await service.dispatch('org-1', 'thread.created', { threadId: 't1' });
      expect(spy).toHaveBeenCalled();
    });
  });
});
