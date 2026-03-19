import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../../database/prisma.service';

const mockPrisma = {
  organization: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  describe('getMe', () => {
    it('throws NotFoundException when org not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.getMe('org-1')).rejects.toThrow(NotFoundException);
    });

    it('returns the organization when found', async () => {
      const org = {
        id: 'org-1',
        name: 'Acme',
        plan: 'trial',
        subscriptionStatus: 'active',
      };
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      const result = await service.getMe('org-1');
      expect(result).toEqual(org);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when org not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.update('org-1', { name: 'New Name' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates the organization and returns result', async () => {
      const org = { id: 'org-1', name: 'Old Name' };
      const updated = { id: 'org-1', name: 'New Name' };
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.organization.update.mockResolvedValue(updated);
      const result = await service.update('org-1', { name: 'New Name' });
      expect(result).toEqual(updated);
    });
  });

  describe('setup', () => {
    it('throws NotFoundException when org not found', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.setup('org-1', { name: 'Acme' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates organization with setup data', async () => {
      const org = { id: 'org-1', name: '' }; // default/unset name — setup is allowed
      const updated = { id: 'org-1', name: 'Acme' };
      mockPrisma.organization.findUnique.mockResolvedValue(org);
      mockPrisma.organization.update.mockResolvedValue(updated);
      const result = await service.setup('org-1', { name: 'Acme' });
      expect(mockPrisma.organization.update).toHaveBeenCalledTimes(1);
      expect(result).toEqual(updated);
    });
  });
});
