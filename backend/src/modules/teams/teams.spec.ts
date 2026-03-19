import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { PrismaService } from '../../database/prisma.service';
import { TeamMemberRole } from './dto/team.dto';

const mockPrisma = {
  team: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  teamMember: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  mailboxAccess: {
    deleteMany: jest.fn(),
  },
};

describe('TeamsService', () => {
  let service: TeamsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
  });

  describe('findAll', () => {
    it('returns teams for the organization', async () => {
      const teams = [
        { id: 't1', name: 'Support', organizationId: 'org-1', members: [] },
      ];
      mockPrisma.team.findMany.mockResolvedValue(teams);
      const result = await service.findAll('org-1');
      expect(result).toEqual(teams);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when team not found', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(null);
      await expect(service.findOne('org-1', 't-bad')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns team when found', async () => {
      const team = { id: 't1', name: 'Support', members: [] };
      mockPrisma.team.findFirst.mockResolvedValue(team);
      const result = await service.findOne('org-1', 't1');
      expect(result).toEqual(team);
    });
  });

  describe('create', () => {
    it('creates a new team', async () => {
      const team = {
        id: 't1',
        name: 'Support',
        organizationId: 'org-1',
        members: [],
      };
      mockPrisma.team.create.mockResolvedValue(team);
      const result = await service.create('org-1', { name: 'Support' });
      expect(result).toEqual(team);
      expect(mockPrisma.team.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('addMember', () => {
    it('throws ConflictException if user already in team', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't1' });
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'u1' });
      mockPrisma.teamMember.findUnique.mockResolvedValue({ id: 'tm1' }); // already a member
      await expect(
        service.addMember('org-1', 't1', {
          userId: 'u1',
          role: TeamMemberRole.member,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when team not found', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(null);
      await expect(
        service.addMember('org-1', 't-bad', {
          userId: 'u1',
          role: TeamMemberRole.member,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when team not found for removal', async () => {
      mockPrisma.team.findFirst.mockResolvedValue(null);
      await expect(service.remove('org-1', 't-bad')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes team when found', async () => {
      mockPrisma.team.findFirst.mockResolvedValue({ id: 't1' });
      mockPrisma.team.update.mockResolvedValue({});
      mockPrisma.mailboxAccess.deleteMany.mockResolvedValue({ count: 0 });
      await service.remove('org-1', 't1');
      expect(mockPrisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
      expect(mockPrisma.mailboxAccess.deleteMany).toHaveBeenCalledWith({
        where: { teamId: 't1' },
      });
    });
  });
});
