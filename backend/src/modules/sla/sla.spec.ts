import { Test, TestingModule } from '@nestjs/testing';
import { SlaService } from './sla.service';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type { BusinessHours, SlaTargets } from './dto/sla.dto';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'admin@test.com',
  organizationId: 'org-1',
  role: 'ADMIN',
  permissions: [],
};

const mockPrisma = {
  slaPolicy: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('SlaService', () => {
  let service: SlaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SlaService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<SlaService>(SlaService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns SLA policies for the organization', async () => {
      const policies = [
        { id: 'sla-1', name: 'Standard', organizationId: 'org-1' },
      ];
      mockPrisma.slaPolicy.findMany.mockResolvedValue(policies);
      const result = await service.findAll(mockUser);
      expect(result).toEqual(policies);
      expect(mockPrisma.slaPolicy.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            deletedAt: null,
          }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns a policy by id', async () => {
      const policy = { id: 'sla-1', name: 'Standard', organizationId: 'org-1' };
      mockPrisma.slaPolicy.findFirst.mockResolvedValue(policy);
      const result = await service.findOne('sla-1', mockUser);
      expect(result).toEqual(policy);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.slaPolicy.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a policy with provided fields', async () => {
      const policy = {
        id: 'sla-1',
        name: 'Standard',
        organizationId: 'org-1',
        isActive: true,
      };
      mockPrisma.slaPolicy.create.mockResolvedValue(policy);
      const result = await service.create(
        {
          name: 'Standard',
          targets: {
            normal: { firstResponseMinutes: 60, resolutionMinutes: 480 },
          },
        },
        mockUser,
      );
      expect(result).toEqual(policy);
      expect(mockPrisma.slaPolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            name: 'Standard',
            isActive: true,
          }),
        }),
      );
    });

    it('defaults isActive to true', async () => {
      mockPrisma.slaPolicy.create.mockResolvedValue({ id: 'sla-2' });
      await service.create({ name: 'Basic' }, mockUser);
      expect(mockPrisma.slaPolicy.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: true }),
        }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.slaPolicy.findFirst.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { name: 'X' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates policy fields', async () => {
      mockPrisma.slaPolicy.findFirst.mockResolvedValue({
        id: 'sla-1',
        organizationId: 'org-1',
        deletedAt: null,
      });
      mockPrisma.slaPolicy.update.mockResolvedValue({
        id: 'sla-1',
        name: 'Updated',
        isActive: false,
      });
      const result = await service.update(
        'sla-1',
        { name: 'Updated', isActive: false },
        mockUser,
      );
      expect(result).toHaveProperty('name', 'Updated');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.slaPolicy.findFirst.mockResolvedValue(null);
      await expect(service.remove('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes the policy', async () => {
      mockPrisma.slaPolicy.findFirst.mockResolvedValue({
        id: 'sla-1',
        organizationId: 'org-1',
        deletedAt: null,
      });
      mockPrisma.slaPolicy.update.mockResolvedValue({});
      await service.remove('sla-1', mockUser);
      expect(mockPrisma.slaPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sla-1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('computeDeadline', () => {
    const baseDate = new Date('2026-03-09T09:00:00.000Z'); // Monday 09:00 UTC

    const targets: SlaTargets = {
      urgent: {
        firstResponseMinutes: 30,
        nextResponseMinutes: 45,
        resolutionMinutes: 120,
      },
      normal: {
        firstResponseMinutes: 240,
        nextResponseMinutes: 360,
        resolutionMinutes: 1440,
      },
    };

    it('returns null when no target for priority', () => {
      const result = service.computeDeadline(baseDate, 'LOW', targets, null);
      expect(result).toBeNull();
    });

    it('adds wall-clock minutes when no businessHours', () => {
      const result = service.computeDeadline(baseDate, 'URGENT', targets, null);
      const expected = new Date(baseDate.getTime() + 30 * 60_000);
      expect(result).toEqual(expected);
    });

    it('adds wall-clock minutes in resolution mode', () => {
      const result = service.computeDeadline(
        baseDate,
        'URGENT',
        targets,
        null,
        'resolution',
      );
      const expected = new Date(baseDate.getTime() + 120 * 60_000);
      expect(result).toEqual(expected);
    });

    it('adds wall-clock minutes in next response mode', () => {
      const result = service.computeDeadline(
        baseDate,
        'URGENT',
        targets,
        null,
        'next_response',
      );
      const expected = new Date(baseDate.getTime() + 45 * 60_000);
      expect(result).toEqual(expected);
    });

    it('returns a Date after start when businessHours are set', () => {
      const bh: BusinessHours = {
        daysOfWeek: [1, 2, 3, 4, 5], // Mon-Fri
        startTime: '08:00',
        endTime: '17:00',
        timezone: 'UTC',
      };
      const result = service.computeDeadline(baseDate, 'URGENT', targets, bh);
      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBeGreaterThan(baseDate.getTime());
    });

    it('supports per-day business hour windows', () => {
      const bh: BusinessHours = {
        timezone: 'UTC',
        days: {
          mon: { enabled: true, startTime: '10:00', endTime: '12:00' },
        },
      };
      const result = service.computeDeadline(baseDate, 'URGENT', targets, bh);
      expect(result?.toISOString()).toBe('2026-03-09T10:30:00.000Z');
    });
  });

  describe('resolveThreadDeadlines', () => {
    const targets: SlaTargets = {
      normal: {
        firstResponseMinutes: 60,
        nextResponseMinutes: 180,
        resolutionMinutes: 480,
      },
    };

    it('returns first response deadline when no outbound reply exists yet', () => {
      const result = service.resolveThreadDeadlines(
        {
          createdAt: new Date('2026-03-09T08:00:00.000Z'),
          priority: 'NORMAL',
          latestInboundAt: new Date('2026-03-09T09:00:00.000Z'),
          latestOutboundAt: null,
        },
        targets,
        null,
      );
      expect(result.firstResponseDueAt?.toISOString()).toBe(
        '2026-03-09T10:00:00.000Z',
      );
      expect(result.resolutionDueAt?.toISOString()).toBe(
        '2026-03-09T16:00:00.000Z',
      );
    });

    it('returns next response deadline when customer replied after the last outbound', () => {
      const result = service.resolveThreadDeadlines(
        {
          createdAt: new Date('2026-03-09T08:00:00.000Z'),
          priority: 'NORMAL',
          latestInboundAt: new Date('2026-03-09T12:00:00.000Z'),
          latestOutboundAt: new Date('2026-03-09T10:30:00.000Z'),
        },
        targets,
        null,
      );
      expect(result.firstResponseDueAt?.toISOString()).toBe(
        '2026-03-09T15:00:00.000Z',
      );
    });

    it('clears response deadline when the latest outbound already answered the latest inbound', () => {
      const result = service.resolveThreadDeadlines(
        {
          createdAt: new Date('2026-03-09T08:00:00.000Z'),
          priority: 'NORMAL',
          latestInboundAt: new Date('2026-03-09T10:00:00.000Z'),
          latestOutboundAt: new Date('2026-03-09T10:30:00.000Z'),
        },
        targets,
        null,
      );
      expect(result.firstResponseDueAt).toBeNull();
      expect(result.resolutionDueAt?.toISOString()).toBe(
        '2026-03-09T16:00:00.000Z',
      );
    });
  });
});
