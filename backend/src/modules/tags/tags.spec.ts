import { Test, TestingModule } from '@nestjs/testing';
import { TagsService } from './tags.service';
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

const mockPrisma = {
  tag: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('TagsService', () => {
  let service: TagsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TagsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<TagsService>(TagsService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns tags visible to user (org + personal)', async () => {
      const tags = [{ id: 't1', name: 'Support', scope: 'organization' }];
      mockPrisma.tag.findMany.mockResolvedValue(tags);
      const result = await service.findAll(mockUser);
      expect(result).toEqual(tags);
      expect(mockPrisma.tag.findMany).toHaveBeenCalledWith(
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
    it('creates an organization-scoped tag', async () => {
      const tag = {
        id: 't1',
        name: 'Bug',
        color: '#ff0000',
        scope: 'organization',
      };
      mockPrisma.tag.create.mockResolvedValue(tag);
      const result = await service.create(
        { name: 'Bug', color: '#ff0000' },
        mockUser,
      );
      expect(result).toEqual(tag);
      expect(mockPrisma.tag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ scope: 'organization' }),
        }),
      );
    });

    it('sets ownerId for personal tags', async () => {
      const tag = {
        id: 't2',
        name: 'Mine',
        color: '#0000ff',
        scope: 'personal',
        ownerId: 'user-1',
      };
      mockPrisma.tag.create.mockResolvedValue(tag);
      await service.create(
        { name: 'Mine', color: '#0000ff', scope: 'personal' },
        mockUser,
      );
      expect(mockPrisma.tag.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ownerId: 'user-1' }),
        }),
      );
    });
  });

  describe('update', () => {
    it('throws NotFoundException when tag not found', async () => {
      mockPrisma.tag.findFirst.mockResolvedValue(null);
      await expect(
        service.update('bad-id', { name: 'X' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws ForbiddenException when updating another user's personal tag", async () => {
      mockPrisma.tag.findFirst.mockResolvedValue({
        id: 't1',
        scope: 'personal',
        ownerId: 'other-user',
      });
      await expect(
        service.update('t1', { name: 'X' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('updates tag fields', async () => {
      mockPrisma.tag.findFirst.mockResolvedValue({
        id: 't1',
        scope: 'organization',
        ownerId: null,
      });
      mockPrisma.tag.update.mockResolvedValue({ id: 't1', name: 'Updated' });
      const result = await service.update('t1', { name: 'Updated' }, mockUser);
      expect(result).toHaveProperty('name', 'Updated');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when tag not found', async () => {
      mockPrisma.tag.findFirst.mockResolvedValue(null);
      await expect(service.remove('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('soft-deletes the tag', async () => {
      mockPrisma.tag.findFirst.mockResolvedValue({
        id: 't1',
        scope: 'organization',
        ownerId: null,
      });
      mockPrisma.tag.update.mockResolvedValue({});
      await service.remove('t1', mockUser);
      expect(mockPrisma.tag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });
});
