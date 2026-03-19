import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'test@example.com',
  organizationId: 'org-1',
  role: 'admin',
  permissions: [],
};

const mockAuditLog = {
  id: 'al-1',
  organizationId: 'org-1',
  userId: 'user-1',
  action: 'user.login',
  entityType: 'user',
  entityId: 'user-1',
  previousValue: null,
  newValue: null,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  createdAt: new Date(),
};

const mockPrisma = {
  auditLog: {
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

describe('AuditService', () => {
  let service: AuditService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns paginated audit logs for org', async () => {
      mockPrisma.auditLog.count.mockResolvedValue(1);
      mockPrisma.auditLog.findMany.mockResolvedValue([mockAuditLog]);

      const result = await service.findAll(mockUser, { page: 1, limit: 10 });

      expect(result.total).toBe(1);
      expect(result.logs).toHaveLength(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('applies entityType filter', async () => {
      mockPrisma.auditLog.count.mockResolvedValue(0);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await service.findAll(mockUser, { entityType: 'thread' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityType: 'thread' }),
        }),
      );
    });

    it('applies action filter', async () => {
      mockPrisma.auditLog.count.mockResolvedValue(0);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await service.findAll(mockUser, { action: 'thread.assigned' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ action: 'thread.assigned' }),
        }),
      );
    });

    it('caps limit at 200', async () => {
      mockPrisma.auditLog.count.mockResolvedValue(0);
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await service.findAll(mockUser, { limit: 9999 });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });
  });

  describe('log', () => {
    it('creates an audit log entry', async () => {
      mockPrisma.auditLog.create.mockResolvedValue(mockAuditLog);

      await service.log({
        organizationId: 'org-1',
        userId: 'user-1',
        action: 'user.login',
        entityType: 'user',
        entityId: 'user-1',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });

    it('logs without userId when not provided', async () => {
      mockPrisma.auditLog.create.mockResolvedValue(mockAuditLog);

      await service.log({
        organizationId: 'org-1',
        action: 'organization.updated',
        entityType: 'organization',
        entityId: 'org-1',
      });

      expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
    });
  });
});
