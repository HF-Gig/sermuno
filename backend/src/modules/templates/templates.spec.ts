import { Test, TestingModule } from '@nestjs/testing';
import { TemplatesService } from './templates.service';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'admin@test.com',
  organizationId: 'org-1',
  role: 'ADMIN',
  permissions: [],
};

const mockTemplate = {
  id: 'tpl-1',
  organizationId: 'org-1',
  createdByUserId: 'user-1',
  name: 'Welcome Email',
  subject: 'Hello {{name}}',
  bodyHtml: '<p>Hi {{name}}, welcome to {{company}}!</p>',
  scope: 'organization',
  deletedAt: null,
  timesUsed: 0,
};

const mockPrisma = {
  emailTemplate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

describe('TemplatesService', () => {
  let service: TemplatesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<TemplatesService>(TemplatesService);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns templates for user', async () => {
      mockPrisma.emailTemplate.findMany.mockResolvedValue([mockTemplate]);
      const result = await service.findAll(mockUser);
      expect(result).toEqual([mockTemplate]);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when not found', async () => {
      mockPrisma.emailTemplate.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns template when found', async () => {
      mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockTemplate);
      const result = await service.findOne('tpl-1', mockUser);
      expect(result).toEqual(mockTemplate);
    });
  });

  describe('create', () => {
    it('creates a template with correct fields', async () => {
      mockPrisma.emailTemplate.create.mockResolvedValue(mockTemplate);
      const result = await service.create(
        { name: 'Welcome Email', bodyHtml: '<p>Hi</p>' },
        mockUser,
      );
      expect(result).toEqual(mockTemplate);
      expect(mockPrisma.emailTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ createdByUserId: 'user-1' }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes template', async () => {
      mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockTemplate);
      mockPrisma.emailTemplate.update.mockResolvedValue({});
      await service.remove('tpl-1', mockUser);
      expect(mockPrisma.emailTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('render', () => {
    it('renders Handlebars template with variables', async () => {
      mockPrisma.emailTemplate.findFirst.mockResolvedValue(mockTemplate);
      mockPrisma.emailTemplate.update.mockResolvedValue({});
      const result = await service.render(
        'tpl-1',
        { variables: { name: 'Alice', company: 'Acme' } },
        mockUser,
      );
      expect(result.bodyHtml).toBe('<p>Hi Alice, welcome to Acme!</p>');
      expect(result.subject).toBe('Hello Alice');
    });

    it('throws BadRequestException for invalid Handlebars template', async () => {
      mockPrisma.emailTemplate.findFirst.mockResolvedValue({
        ...mockTemplate,
        bodyHtml: '{{#if}}broken{{/if}}',
        subject: null,
      });
      mockPrisma.emailTemplate.update.mockResolvedValue({});
      await expect(
        service.render('tpl-1', { variables: {} }, mockUser),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
