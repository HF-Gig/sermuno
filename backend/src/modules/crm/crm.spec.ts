import { Test, TestingModule } from '@nestjs/testing';
import { CrmService } from './crm.service';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ConflictException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'admin@test.com',
  organizationId: 'org-1',
  role: 'ADMIN',
  permissions: [],
};

const mockPrisma = {
  contact: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  company: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

const mockConfig = {
  get: jest.fn(),
};

describe('CrmService', () => {
  let service: CrmService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrmService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get<CrmService>(CrmService);
    jest.clearAllMocks();
  });

  // ── Contacts ──────────────────────────────────────────────────────────────

  describe('listContacts', () => {
    it('returns all contacts scoped to org', async () => {
      const contacts = [
        { id: 'c1', email: 'a@b.com', organizationId: 'org-1' },
      ];
      mockPrisma.contact.findMany.mockResolvedValue(contacts);
      const result = await service.listContacts(mockUser);
      expect(result).toEqual(contacts);
      expect(mockPrisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: 'org-1' }),
        }),
      );
    });
  });

  describe('createContact', () => {
    it('creates a new contact', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null); // no conflict
      const contact = { id: 'c1', email: 'new@b.com', organizationId: 'org-1' };
      mockPrisma.contact.create.mockResolvedValue(contact);
      const result = await service.createContact(
        { email: 'new@b.com' },
        mockUser,
      );
      expect(result).toEqual(contact);
    });

    it('throws ConflictException if email already exists in org', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue({
        id: 'c1',
        email: 'dup@b.com',
      });
      await expect(
        service.createContact({ email: 'dup@b.com' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getContact', () => {
    it('returns contact if found', async () => {
      const contact = { id: 'c1', email: 'x@b.com', organizationId: 'org-1' };
      mockPrisma.contact.findFirst.mockResolvedValue(contact);
      const result = await service.getContact('c1', mockUser);
      expect(result).toEqual(contact);
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      await expect(service.getContact('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateContact', () => {
    it('updates contact fields', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue({
        id: 'c1',
        email: 'old@b.com',
      });
      mockPrisma.contact.update.mockResolvedValue({
        id: 'c1',
        name: 'Updated',
      });
      const result = await service.updateContact(
        'c1',
        { name: 'Updated' },
        mockUser,
      );
      expect(result).toHaveProperty('name', 'Updated');
    });

    it('throws ConflictException when updating to duplicate email', async () => {
      mockPrisma.contact.findFirst
        .mockResolvedValueOnce({ id: 'c1', email: 'old@b.com' }) // existing contact
        .mockResolvedValueOnce({ id: 'c2', email: 'other@b.com' }); // conflict
      await expect(
        service.updateContact('c1', { email: 'other@b.com' }, mockUser),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException if contact not found', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      await expect(
        service.updateContact('bad-id', {}, mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteContact', () => {
    it('hard-deletes contact', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue({ id: 'c1' });
      mockPrisma.contact.delete.mockResolvedValue({});
      await service.deleteContact('c1', mockUser);
      expect(mockPrisma.contact.delete).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      await expect(service.deleteContact('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Companies ─────────────────────────────────────────────────────────────

  describe('listCompanies', () => {
    it('returns companies scoped to org', async () => {
      const companies = [{ id: 'co1', name: 'Acme', organizationId: 'org-1' }];
      mockPrisma.company.findMany.mockResolvedValue(companies);
      const result = await service.listCompanies(mockUser);
      expect(result).toEqual(companies);
    });
  });

  describe('createCompany', () => {
    it('creates a company', async () => {
      const company = { id: 'co1', name: 'Acme', organizationId: 'org-1' };
      mockPrisma.company.create.mockResolvedValue(company);
      const result = await service.createCompany({ name: 'Acme' }, mockUser);
      expect(result).toEqual(company);
      expect(mockPrisma.company.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org-1',
            name: 'Acme',
          }),
        }),
      );
    });
  });

  describe('getCompany', () => {
    it('returns company if found', async () => {
      const company = { id: 'co1', name: 'Acme' };
      mockPrisma.company.findFirst.mockResolvedValue(company);
      const result = await service.getCompany('co1', mockUser);
      expect(result).toEqual(company);
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);
      await expect(service.getCompany('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateCompany', () => {
    it('updates company fields', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({
        id: 'co1',
        name: 'Old',
      });
      mockPrisma.company.update.mockResolvedValue({ id: 'co1', name: 'New' });
      const result = await service.updateCompany(
        'co1',
        { name: 'New' },
        mockUser,
      );
      expect(result).toHaveProperty('name', 'New');
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);
      await expect(
        service.updateCompany('bad-id', {}, mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteCompany', () => {
    it('hard-deletes company', async () => {
      mockPrisma.company.findFirst.mockResolvedValue({ id: 'co1' });
      mockPrisma.company.delete.mockResolvedValue({});
      await service.deleteCompany('co1', mockUser);
      expect(mockPrisma.company.delete).toHaveBeenCalledWith({
        where: { id: 'co1' },
      });
    });

    it('throws NotFoundException if not found', async () => {
      mockPrisma.company.findFirst.mockResolvedValue(null);
      await expect(service.deleteCompany('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Auto-create ───────────────────────────────────────────────────────────

  describe('autoCreateContactIfEnabled', () => {
    it('creates contact when feature flag is enabled and contact does not exist', async () => {
      mockConfig.get.mockReturnValue(true);
      mockPrisma.contact.findFirst.mockResolvedValue(null);
      mockPrisma.contact.create.mockResolvedValue({ id: 'c-new' });
      await service.autoCreateContactIfEnabled(
        'sender@x.com',
        'Sender',
        'org-1',
      );
      expect(mockPrisma.contact.create).toHaveBeenCalled();
    });

    it('skips creation when feature flag is disabled', async () => {
      mockConfig.get.mockReturnValue(false);
      await service.autoCreateContactIfEnabled(
        'sender@x.com',
        'Sender',
        'org-1',
      );
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    });

    it('skips creation when contact already exists', async () => {
      mockConfig.get.mockReturnValue(true);
      mockPrisma.contact.findFirst.mockResolvedValue({
        id: 'c1',
        email: 'sender@x.com',
      });
      await service.autoCreateContactIfEnabled(
        'sender@x.com',
        'Sender',
        'org-1',
      );
      expect(mockPrisma.contact.create).not.toHaveBeenCalled();
    });
  });
});
