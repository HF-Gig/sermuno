import { Test, TestingModule } from '@nestjs/testing';
import { ThreadsService } from './threads.service';
import { PrismaService } from '../../database/prisma.service';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';
import { EventsGateway } from '../websockets/events.gateway';
import { SlaService } from '../sla/sla.service';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'admin@test.com',
  organizationId: 'org-1',
  role: 'ADMIN',
  permissions: [],
};

const mockThread = {
  id: 'thread-1',
  mailboxId: 'mailbox-1',
  organizationId: 'org-1',
  subject: 'Test Thread',
  status: 'OPEN',
  priority: 'NORMAL',
  assignedUserId: null,
  assignedToTeamId: null,
  snoozedUntil: null,
  previousStatus: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ThreadsService', () => {
  let service: ThreadsService;
  let slaService: { resolveThreadDeadlines: jest.Mock };
  let prisma: {
    thread: {
      count: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    teamMember: { findMany: jest.Mock };
    message: { findFirst: jest.Mock; create: jest.Mock };
    slaPolicy: { findFirst: jest.Mock };
    threadNote: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    threadTag: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      thread: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      teamMember: { findMany: jest.fn() },
      message: { findFirst: jest.fn(), create: jest.fn() },
      slaPolicy: { findFirst: jest.fn() },
      threadNote: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      threadTag: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    slaService = {
      resolveThreadDeadlines: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EventsGateway, useValue: { emitToOrganization: jest.fn() } },
        { provide: SlaService, useValue: slaService },
      ],
    }).compile();

    service = module.get<ThreadsService>(ThreadsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns paginated threads', async () => {
      prisma.thread.findMany
        .mockResolvedValueOnce([
          {
            id: 'thread-1',
            createdAt: new Date(),
            status: 'OPEN',
            starred: false,
            resolutionDueAt: null,
            messages: [],
          },
          {
            id: 'thread-2',
            createdAt: new Date(),
            status: 'OPEN',
            starred: false,
            resolutionDueAt: null,
            messages: [],
          },
        ])
        .mockResolvedValueOnce([mockThread]);
      const result = await service.findAll({ limit: 1 }, mockUser);
      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.threads).toHaveLength(1);
      expect(result.pagination.totalPages).toBe(2);
    });

    it('returns empty list when no threads', async () => {
      prisma.thread.findMany.mockResolvedValue([]);
      const result = await service.findAll({}, mockUser);
      expect(result.items).toHaveLength(0);
      expect(result.hasMore).toBe(false);
      expect(result.threads).toHaveLength(0);
    });
  });

  describe('findOne', () => {
    it('returns thread details', async () => {
      prisma.thread.findFirst.mockResolvedValue(mockThread);
      const result = await service.findOne('thread-1', mockUser);
      expect(result.id).toBe('thread-1');
    });

    it('throws NotFoundException for unknown thread', async () => {
      prisma.thread.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkUpdate', () => {
    it('updates multiple threads', async () => {
      prisma.thread.updateMany.mockResolvedValue({ count: 2 });
      const result = await service.bulkUpdate(
        { ids: ['thread-1', 'thread-2'], status: 'CLOSED' },
        mockUser,
      );
      expect(result.updated).toBe(2);
      expect(prisma.thread.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['thread-1', 'thread-2'] },
          }),
          data: expect.objectContaining({ status: 'CLOSED' }),
        }),
      );
    });
  });

  describe('update', () => {
    it('applies SLA deadlines when attaching a policy', async () => {
      const createdAt = new Date('2026-03-09T09:00:00.000Z');
      prisma.thread.findFirst.mockResolvedValue({
        ...mockThread,
        createdAt,
        slaPolicyId: null,
      });
      prisma.slaPolicy.findFirst.mockResolvedValue({
        targets: {
          normal: {
            firstResponseMinutes: 60,
            nextResponseMinutes: 120,
            resolutionMinutes: 240,
          },
        },
        businessHours: null,
      });
      prisma.message.findFirst
        .mockResolvedValueOnce({ createdAt })
        .mockResolvedValueOnce(null);
      slaService.resolveThreadDeadlines.mockReturnValue({
        firstResponseDueAt: new Date('2026-03-09T10:00:00.000Z'),
        resolutionDueAt: new Date('2026-03-09T13:00:00.000Z'),
      });
      prisma.thread.update.mockResolvedValue({
        ...mockThread,
        slaPolicyId: 'sla-1',
      });

      await service.update('thread-1', { slaPolicyId: 'sla-1' }, mockUser);

      expect(prisma.thread.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'thread-1' },
          data: expect.objectContaining({
            slaPolicyId: 'sla-1',
            firstResponseDueAt: expect.any(Date),
            resolutionDueAt: expect.any(Date),
            slaBreached: true,
          }),
        }),
      );
    });
  });

  describe('findThreadForMessage (RFC 5322 threading)', () => {
    it('matches by In-Reply-To header', async () => {
      prisma.message.findFirst.mockResolvedValue({ threadId: 'thread-1' });
      const result = await service.findThreadForMessage(
        {
          messageId: '<new@test>',
          inReplyTo: '<old@test>',
          subject: 'Re: Test',
        },
        'mailbox-1',
      );
      expect(result.matchedBy).toBe('messageId');
      expect(result.threadId).toBe('thread-1');
    });

    it('matches by subject when no reply headers', async () => {
      prisma.message.findFirst.mockResolvedValue(null);
      prisma.thread.findFirst.mockResolvedValue({ id: 'thread-1' });
      const result = await service.findThreadForMessage(
        { messageId: '<new@test>', subject: 'Re: Test Subject' },
        'mailbox-1',
      );
      expect(result.matchedBy).toBe('subject');
    });

    it('returns new thread when no match', async () => {
      prisma.message.findFirst.mockResolvedValue(null);
      prisma.thread.findFirst.mockResolvedValue(null);
      const result = await service.findThreadForMessage(
        { messageId: '<new@test>', subject: 'Brand New Topic' },
        'mailbox-1',
      );
      expect(result.matchedBy).toBe('new');
      expect(result.threadId).toBeNull();
    });
  });

  describe('createNote', () => {
    it('creates a note on the thread', async () => {
      prisma.thread.findFirst.mockResolvedValue(mockThread);
      prisma.threadNote.create.mockResolvedValue({
        id: 'note-1',
        body: 'Test note',
      });
      const result = await service.createNote(
        'thread-1',
        { body: 'Test note' },
        mockUser,
      );
      expect(result.id).toBe('note-1');
    });
  });

  describe('updateNote', () => {
    it("throws ForbiddenException when editing another user's note", async () => {
      prisma.thread.findFirst.mockResolvedValue(mockThread);
      prisma.threadNote.findFirst.mockResolvedValue({
        id: 'note-1',
        threadId: 'thread-1',
        organizationId: 'org-1',
        userId: 'other-user',
        body: 'Original',
      });
      await expect(
        service.updateNote('thread-1', 'note-1', { body: 'Changed' }, mockUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('addTag / removeTag', () => {
    it('adds a tag to a thread', async () => {
      prisma.thread.findFirst.mockResolvedValue(mockThread);
      prisma.threadTag.upsert.mockResolvedValue({
        threadId: 'thread-1',
        tagId: 'tag-1',
      });
      await service.addTag('thread-1', 'tag-1', mockUser);
      expect(prisma.threadTag.upsert).toHaveBeenCalled();
    });

    it('throws NotFoundException when removing non-existent tag', async () => {
      prisma.thread.findFirst.mockResolvedValue(mockThread);
      prisma.threadTag.findUnique.mockResolvedValue(null);
      await expect(
        service.removeTag('thread-1', 'tag-1', mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
