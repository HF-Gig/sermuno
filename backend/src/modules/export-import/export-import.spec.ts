import { Test, TestingModule } from '@nestjs/testing';
import { ExportImportService } from './export-import.service';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'test@example.com',
  organizationId: 'org-1',
  role: 'admin',
  permissions: [],
};

const EXPORT_JOB_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  status: true,
  format: true,
  resources: true,
  resourceCounts: true,
  payload: true,
  artifactUrl: true,
  expiresAt: true,
  error: true,
  createdAt: true,
  updatedAt: true,
};

const mockExportJob = {
  id: 'ej-1',
  organizationId: 'org-1',
  userId: 'user-1',
  status: 'pending',
  format: 'json',
  resources: ['threads'],
  resourceCounts: {},
  payload: { format: 'json' },
  artifactUrl: null,
  expiresAt: new Date(),
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockImportJob = {
  id: 'ij-1',
  organizationId: 'org-1',
  userId: 'user-1',
  status: 'pending',
  payload: { format: 'json' },
  result: null,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPrisma = {
  exportJob: {
    count: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  importJob: {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  thread: {
    findMany: jest.fn(),
  },
};

describe('ExportImportService', () => {
  let service: ExportImportService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExportImportService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ExportImportService>(ExportImportService);
    jest.clearAllMocks();
  });

  describe('createExport', () => {
    it('creates an export job', async () => {
      mockPrisma.exportJob.count.mockResolvedValue(0);
      mockPrisma.exportJob.create.mockResolvedValue(mockExportJob);
      mockPrisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.thread.findMany.mockResolvedValue([]);

      const result = await service.createExport({ format: 'json' }, mockUser);

      expect(result.id).toBe('ej-1');
      expect(mockPrisma.exportJob.create).toHaveBeenCalledTimes(1);
    });

    it('rejects when 10 concurrent jobs already running', async () => {
      mockPrisma.exportJob.count.mockResolvedValue(10);

      await expect(service.createExport({}, mockUser)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('listExports', () => {
    it('returns export jobs for org', async () => {
      mockPrisma.exportJob.findMany.mockResolvedValue([mockExportJob]);

      const result = await service.listExports(mockUser);

      expect(result).toHaveLength(1);
      expect(mockPrisma.exportJob.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1' },
          select: EXPORT_JOB_SELECT,
        }),
      );
    });
  });

  describe('getExport', () => {
    it('returns the export job', async () => {
      mockPrisma.exportJob.findFirst.mockResolvedValue(mockExportJob);

      const result = await service.getExport('ej-1', mockUser);
      expect(result.id).toBe('ej-1');
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.exportJob.findFirst.mockResolvedValue(null);

      await expect(service.getExport('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listImports', () => {
    it('returns import jobs for org', async () => {
      mockPrisma.importJob.findMany.mockResolvedValue([mockImportJob]);

      const result = await service.listImports(mockUser);
      expect(result).toHaveLength(1);
    });
  });

  describe('createImport', () => {
    it('creates an import job from JSON buffer', async () => {
      mockPrisma.importJob.create.mockResolvedValue(mockImportJob);
      mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });

      const buf = Buffer.from(JSON.stringify([{ id: 't1' }]));
      const result = await service.createImport(mockUser, buf, 'data.json');

      expect(result.id).toBe('ij-1');
      expect(mockPrisma.importJob.create).toHaveBeenCalledTimes(1);
    });

    it('creates an import job from CSV buffer', async () => {
      mockPrisma.importJob.create.mockResolvedValue(mockImportJob);
      mockPrisma.importJob.updateMany.mockResolvedValue({ count: 1 });

      const buf = Buffer.from('threadId,subject\nt1,Hello');
      const result = await service.createImport(mockUser, buf, 'data.csv');

      expect(result.id).toBe('ij-1');
    });
  });
});
