import { Test, TestingModule } from '@nestjs/testing';
import { RulesService } from './rules.service';
import { PrismaService } from '../../database/prisma.service';
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
  rule: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('RulesService', () => {
  let service: RulesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RulesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<RulesService>(RulesService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns rules for the organization ordered by priority', async () => {
      const rules = [
        {
          id: 'r1',
          name: 'First',
          priority: 1,
          organizationId: 'org-1',
          deletedAt: null,
        },
      ];
      mockPrisma.rule.findMany.mockResolvedValue(rules);
      const result = await service.findAll(mockUser);
      expect(result).toEqual(rules);
      expect(mockPrisma.rule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-1',
            deletedAt: null,
          }),
          orderBy: expect.arrayContaining([{ priority: 'asc' }]),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns a rule by id', async () => {
      const rule = {
        id: 'r1',
        name: 'First',
        organizationId: 'org-1',
        deletedAt: null,
      };
      mockPrisma.rule.findFirst.mockResolvedValue(rule);
      const result = await service.findOne('r1', mockUser);
      expect(result).toEqual(rule);
    });

    it('throws NotFoundException when rule not found', async () => {
      mockPrisma.rule.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a rule with provided fields', async () => {
      const newRule = {
        id: 'r1',
        organizationId: 'org-1',
        name: 'Auto Assign',
        isActive: true,
        priority: 1,
        conditionLogic: 'AND',
        trigger: 'INCOMING_EMAIL',
        conditions: [
          { field: 'subject', operator: 'contains', value: 'urgent' },
        ],
        actions: [{ type: 'assign', targetUserId: 'user-1' }],
      };
      mockPrisma.rule.create.mockResolvedValue(newRule);
      const result = await service.create(
        {
          name: 'Auto Assign',
          trigger: 'INCOMING_EMAIL',
          priority: 1,
          conditions: [
            { field: 'subject', operator: 'contains', value: 'urgent' },
          ],
          actions: [{ type: 'assign', targetUserId: 'user-1' }],
        },
        mockUser,
      );
      expect(result).toEqual(newRule);
      expect(mockPrisma.rule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            name: 'Auto Assign',
          }),
        }),
      );
    });

    it('defaults isActive to true and priority to 2 when not specified', async () => {
      mockPrisma.rule.create.mockResolvedValue({ id: 'r2' });
      await service.create(
        {
          name: 'Default Rule',
          trigger: 'TICKET_CREATED',
          conditions: [],
          actions: [],
        },
        mockUser,
      );
      expect(mockPrisma.rule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            isActive: true,
            priority: 2,
            conditionLogic: 'AND',
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when rule not found', async () => {
      mockPrisma.rule.findFirst.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { name: 'X' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates rule fields', async () => {
      mockPrisma.rule.findFirst.mockResolvedValue({
        id: 'r1',
        organizationId: 'org-1',
        deletedAt: null,
      });
      mockPrisma.rule.update.mockResolvedValue({
        id: 'r1',
        name: 'Updated',
        isActive: false,
      });
      const result = await service.update(
        'r1',
        { name: 'Updated', isActive: false },
        mockUser,
      );
      expect(result).toHaveProperty('name', 'Updated');
      expect(mockPrisma.rule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: expect.objectContaining({ name: 'Updated', isActive: false }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when rule not found', async () => {
      mockPrisma.rule.findFirst.mockResolvedValue(null);
      await expect(service.remove('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes the rule', async () => {
      mockPrisma.rule.findFirst.mockResolvedValue({
        id: 'r1',
        organizationId: 'org-1',
        deletedAt: null,
      });
      mockPrisma.rule.update.mockResolvedValue({});
      await service.remove('r1', mockUser);
      expect(mockPrisma.rule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });
});
