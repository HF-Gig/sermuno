import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'test@example.com',
  organizationId: 'org-1',
  role: 'admin',
  permissions: [],
};

const mockPrisma = {
  $queryRaw: jest.fn().mockResolvedValue([]),
  thread: {
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
  message: {
    count: jest.fn(),
    findMany: jest.fn(),
    groupBy: jest.fn(),
  },
};

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
    jest.clearAllMocks();
  });

  describe('overview', () => {
    it('returns aggregated open-thread metrics', async () => {
      mockPrisma.thread.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockPrisma.thread.findMany.mockResolvedValue([]);

      const result = await service.overview(mockUser, {});

      expect(result).toHaveProperty('totalOpenThreads', 10);
      expect(result).toHaveProperty('averageResponseTimeMinutes', 0);
      expect(result).toHaveProperty('slaCompliance', 0);
    });
  });

  describe('volume', () => {
    it('returns daily volume data', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);
      mockPrisma.thread.findMany.mockResolvedValue([]);

      const result = await service.volume(mockUser, {
        from: '2025-01-01',
        to: '2025-01-31',
      });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('topSenders', () => {
    it('returns top senders list', async () => {
      mockPrisma.message.findMany.mockResolvedValue([
        { fromEmail: 'a@test.com', _count: { fromEmail: 5 } },
      ]);

      const result = await service.topSenders(mockUser, {});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('topDomains', () => {
    it('returns top domains list', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);

      const result = await service.topDomains(mockUser, {});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('busyHours', () => {
    it('returns busy hours distribution', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);

      const result = await service.busyHours(mockUser, {});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('teamPerformance', () => {
    it('returns per-assignee stats', async () => {
      mockPrisma.thread.findMany.mockResolvedValue([]);

      const result = await service.teamPerformance(mockUser, {});
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
