import { Test, TestingModule } from '@nestjs/testing';
import { SignaturesService } from './signatures.service';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'admin@test.com',
  organizationId: 'org-1',
  role: 'ADMIN',
  permissions: [],
};

const mockSig = {
  id: 'sig-1',
  organizationId: 'org-1',
  name: 'My Signature',
  contentHtml: '<p>Regards</p>',
  scope: 'organization',
  ownerId: null,
  isLocked: false,
  deletedAt: null,
};

const mockPrisma = {
  signature: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  teamMember: {
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  mailbox: {
    findMany: jest.fn(),
  },
  mailboxAccess: {
    findMany: jest.fn(),
  },
};

describe('SignaturesService', () => {
  let service: SignaturesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignaturesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<SignaturesService>(SignaturesService);
    jest.clearAllMocks();
    mockPrisma.teamMember.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue({
      fullName: 'Admin Test',
      preferences: null,
    });
    mockPrisma.mailbox.findMany.mockResolvedValue([{ id: 'mailbox-1' }]);
  });

  describe('findAll', () => {
    it('returns signatures for user', async () => {
      mockPrisma.signature.findMany.mockResolvedValue([mockSig]);
      const result = await service.findAll(mockUser);
      expect(result).toEqual([mockSig]);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.signature.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns signature when found', async () => {
      mockPrisma.signature.findFirst.mockResolvedValue(mockSig);
      const result = await service.findOne('sig-1', mockUser);
      expect(result).toEqual(mockSig);
    });

    it("allows admins to access another user's personal signature", async () => {
      mockPrisma.signature.findFirst.mockResolvedValue({
        ...mockSig,
        scope: 'personal',
        ownerId: 'other-user',
      });
      await expect(service.findOne('sig-1', mockUser)).resolves.toEqual(
        expect.objectContaining({ ownerId: 'other-user' }),
      );
    });
  });

  describe('create', () => {
    it('creates a personal signature with ownerId set', async () => {
      mockPrisma.signature.create.mockResolvedValue({
        ...mockSig,
        scope: 'personal',
        ownerId: 'user-1',
      });
      await service.create(
        { name: 'Sig', contentHtml: '<p>Hi</p>', scope: 'personal' },
        mockUser,
      );
      expect(mockPrisma.signature.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: 'user-1' }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes signature', async () => {
      mockPrisma.signature.findFirst.mockResolvedValue(mockSig);
      mockPrisma.signature.update.mockResolvedValue({});
      await service.remove('sig-1', mockUser);
      expect(mockPrisma.signature.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('getAvailable', () => {
    it('returns org + personal signatures', async () => {
      mockPrisma.signature.findMany.mockResolvedValue([
        {
          ...mockSig,
          bodyHtml: '<p>Regards</p>',
          contentHtml: '<p>Regards</p>',
          assignedMailboxIds: ['mailbox-1'],
        },
      ]);
      const result = await service.getAvailable(mockUser);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('My Signature');
    });
  });
});
