import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../../database/prisma.service';
import { InviteRole } from './dto/user.dto';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
  },
  mailboxAccess: {
    deleteMany: jest.fn(),
  },
};

const mockAudit = {
  log: jest.fn(),
};

const mockConfig = {
  get: jest.fn((key: string) => {
    const values: Record<string, unknown> = {
      'smtp.host': '',
      'smtp.from': '',
      'smtp.port': 587,
      'smtp.user': '',
      'smtp.pass': '',
      'frontend.url': 'http://localhost:5173',
    };
    return values[key];
  }),
};

describe('UsersService', () => {
  let service: UsersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.organization.findUnique.mockResolvedValue({ name: 'Acme' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('findAll', () => {
    it('returns list of users for an organization', async () => {
      const now = new Date();
      const users = [
        {
          id: 'u1',
          email: 'a@b.com',
          fullName: 'Alice',
          role: 'ADMIN',
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          timezone: 'UTC',
          locale: 'en',
          avatarUrl: null,
          lastLogin: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          invitedByName: null,
          inviteToken: null,
          inviteExpiresAt: null,
          teamMemberships: [],
        },
      ];
      mockPrisma.user.findMany.mockResolvedValue(users);
      const result = await service.findAll('org-1');
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'u1', status: 'active' }),
        ]),
      );
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{ organizationId: 'org-1' }, { deletedAt: null }] },
        }),
      );
    });
  });

  describe('getInvite', () => {
    it('throws NotFoundException when invite not found or expired', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.getInvite('bad-token')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns invite info when valid', async () => {
      const invite = {
        email: 'a@b.com',
        fullName: 'Alice',
        role: 'USER',
        invitedByName: 'Admin',
        organization: { name: 'Acme', enforceMfa: false },
      };
      mockPrisma.user.findFirst.mockResolvedValue(invite);
      const result = await service.getInvite('valid-token');
      expect(result).toEqual({
        email: 'a@b.com',
        fullName: 'Alice',
        role: 'USER',
        inviterName: 'Admin',
        organizationName: 'Acme',
        enforceMfa: false,
      });
    });
  });

  describe('invite', () => {
    it('throws ConflictException if email belongs to another organization', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        organizationId: 'org-2',
      });
      await expect(
        service.invite(
          {
            sub: 'actor-1',
            email: 'admin@acme.com',
            organizationId: 'org-1',
            role: 'ADMIN',
            permissions: [],
          },
          { email: 'a@b.com', role: InviteRole.USER },
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a new pending user with invite token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'u2',
        email: 'new@b.com',
        fullName: 'New',
        role: 'USER',
        inviteToken: 'abc123',
        inviteExpiresAt: new Date(),
        createdAt: new Date(),
      });
      const result = await service.invite(
        {
          sub: 'actor-1',
          email: 'admin@acme.com',
          organizationId: 'org-1',
          role: 'ADMIN',
          permissions: [],
        },
        { email: 'new@b.com', role: InviteRole.USER },
      );
      expect(result).toHaveProperty('id', 'u2');
      expect(result).toHaveProperty('status', 'pending');
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('findPendingInvites', () => {
    it('returns pending invite records', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'invite-1',
          email: 'pending@example.com',
          role: 'USER',
          invitedByName: 'Admin',
          createdAt: new Date('2026-03-10T00:00:00.000Z'),
          inviteExpiresAt: new Date('2026-03-17T00:00:00.000Z'),
        },
      ]);

      const result = await service.findPendingInvites('org-1');
      expect(result).toEqual([
        {
          id: 'invite-1',
          email: 'pending@example.com',
          role: 'USER',
          invitedBy: 'Admin',
          inviteDate: new Date('2026-03-10T00:00:00.000Z'),
          expiresAt: new Date('2026-03-17T00:00:00.000Z'),
          status: 'pending',
        },
      ]);
    });
  });

  describe('revokeInvite', () => {
    it('throws NotFoundException when invite does not exist', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.revokeInvite(
          {
            sub: 'actor-1',
            email: 'admin@acme.com',
            organizationId: 'org-1',
            role: 'ADMIN',
            permissions: [],
          },
          'invite-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('revokes pending invite user record', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'invite-1',
        email: 'pending@example.com',
        role: 'USER',
        isActive: false,
        deletedAt: null,
      });
      mockPrisma.user.update.mockResolvedValue({ id: 'invite-1' });
      await service.revokeInvite(
        {
          sub: 'actor-1',
          email: 'admin@acme.com',
          organizationId: 'org-1',
          role: 'ADMIN',
          permissions: [],
        },
        'invite-1',
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'invite-1' } }),
      );
    });
  });

  describe('remove', () => {
    it('throws BadRequestException if deleting own account', async () => {
      await expect(service.remove('org-1', 'u1', 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException if user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(service.remove('org-1', 'u2', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({
        id: 'u2',
        organizationId: 'org-1',
        deletedAt: null,
      });
      mockPrisma.user.update.mockResolvedValue({});
      await service.remove('org-1', 'u2', 'u1');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false }),
        }),
      );
    });
  });

  describe('updateMe', () => {
    it('updates user profile fields', async () => {
      mockPrisma.user.update.mockResolvedValue({
        id: 'u1',
        email: 'a@b.com',
        fullName: 'New Name',
        role: 'ADMIN',
        timezone: 'UTC',
        locale: 'en',
        avatarUrl: null,
        preferences: {},
        updatedAt: new Date(),
      });
      const result = await service.updateMe('u1', { fullName: 'New Name' });
      expect(result).toHaveProperty('fullName', 'New Name');
    });
  });
});
