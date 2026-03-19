import { Test, TestingModule } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { EMAIL_SEND_QUEUE } from '../../jobs/queues/email-send.queue';
import { SCHEDULED_MESSAGES_QUEUE } from '../../jobs/queues/scheduled-messages.queue';
import { NotFoundException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'admin@test.com',
  organizationId: 'org-1',
  role: 'ADMIN',
  permissions: [],
};

const mockMessage = {
  id: 'msg-1',
  threadId: 'thread-1',
  mailboxId: 'mailbox-1',
  direction: 'OUTBOUND',
  fromEmail: 'admin@test.com',
  to: ['recipient@example.com'],
  cc: [],
  bcc: [],
  subject: 'Test',
  bodyHtml: '<p>Hello</p>',
  bodyText: 'Hello',
  isRead: false,
  isDraft: false,
  isOutbound: true,
  isDeleted: false,
  isInternalNote: false,
  isStarred: false,
  inReplyTo: null,
  references: null,
  snippet: null,
  replyTo: null,
  hasAttachments: false,
  sizeBytes: null,
  folderId: null,
  imapUid: null,
  messageId: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  attachments: [],
};

describe('MessagesService', () => {
  let service: MessagesService;
  let prisma: {
    message: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    mailbox: { findFirst: jest.Mock };
    thread: { create: jest.Mock };
    mailboxFolder: { findFirst: jest.Mock };
    attachment: { findFirst: jest.Mock };
    scheduledMessage: { create: jest.Mock };
  };
  let emailSendQueue: { add: jest.Mock };
  let scheduledQueue: { add: jest.Mock };

  beforeEach(async () => {
    prisma = {
      message: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      mailbox: { findFirst: jest.fn() },
      thread: { create: jest.fn() },
      mailboxFolder: { findFirst: jest.fn() },
      attachment: { findFirst: jest.fn() },
      scheduledMessage: { create: jest.fn() },
    };
    emailSendQueue = { add: jest.fn() };
    scheduledQueue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string> = {
                'attachment.storageType': 'local',
                'attachment.s3Bucket': '',
                'attachment.s3Region': 'us-east-1',
                'attachment.s3Endpoint': '',
                'attachment.s3AccessKey': '',
                'attachment.s3SecretKey': '',
              };
              return map[key];
            },
          },
        },
        { provide: getQueueToken(EMAIL_SEND_QUEUE), useValue: emailSendQueue },
        {
          provide: getQueueToken(SCHEDULED_MESSAGES_QUEUE),
          useValue: scheduledQueue,
        },
      ],
    }).compile();

    service = module.get<MessagesService>(MessagesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findOne', () => {
    it('returns message with attachments', async () => {
      prisma.message.findFirst.mockResolvedValue(mockMessage);
      const result = await service.findOne('msg-1', mockUser);
      expect(result.id).toBe('msg-1');
    });

    it('throws NotFoundException for unknown message', async () => {
      prisma.message.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('bulkRead', () => {
    it('marks messages as read', async () => {
      prisma.message.updateMany.mockResolvedValue({ count: 2 });
      const result = await service.bulkRead(
        { ids: ['msg-1', 'msg-2'], isRead: true },
        mockUser,
      );
      expect(result.updated).toBe(2);
      expect(prisma.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isRead: true } }),
      );
    });
  });

  describe('send', () => {
    it('creates message and enqueues email-send job for immediate send', async () => {
      prisma.mailbox.findFirst.mockResolvedValue({
        id: 'mailbox-1',
        organizationId: 'org-1',
      });
      prisma.thread.create.mockResolvedValue({ id: 'new-thread-1' });
      prisma.message.create.mockResolvedValue({
        ...mockMessage,
        id: 'new-msg-1',
      });
      emailSendQueue.add.mockResolvedValue({ id: 'job-1' });

      const result = await service.send(
        { mailboxId: 'mailbox-1', to: ['to@example.com'], subject: 'Test' },
        mockUser,
      );

      expect(emailSendQueue.add).toHaveBeenCalled();
      expect(scheduledQueue.add).not.toHaveBeenCalled();
      expect(result.id).toBe('new-msg-1');
    });

    it('enqueues to scheduled-messages queue when scheduledAt is provided', async () => {
      prisma.mailbox.findFirst.mockResolvedValue({
        id: 'mailbox-1',
        organizationId: 'org-1',
      });
      prisma.thread.create.mockResolvedValue({ id: 'new-thread-1' });
      prisma.message.create.mockResolvedValue({
        ...mockMessage,
        id: 'sched-msg-1',
      });
      prisma.scheduledMessage.create.mockResolvedValue({ id: 'sm-1' });
      scheduledQueue.add.mockResolvedValue({ id: 'job-sched-1' });

      const futureDate = new Date(Date.now() + 60 * 60 * 1000);
      await service.send(
        {
          mailboxId: 'mailbox-1',
          to: ['to@example.com'],
          subject: 'Scheduled',
          scheduledAt: futureDate,
        },
        mockUser,
      );

      expect(scheduledQueue.add).toHaveBeenCalled();
      expect(emailSendQueue.add).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when mailbox not in org', async () => {
      prisma.mailbox.findFirst.mockResolvedValue(null);
      await expect(
        service.send({ mailboxId: 'bad', to: ['x@y.com'] }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('move', () => {
    it('moves message to folder', async () => {
      prisma.message.findFirst.mockResolvedValue(mockMessage);
      prisma.mailboxFolder.findFirst.mockResolvedValue({
        id: 'folder-1',
        mailboxId: 'mailbox-1',
      });
      prisma.message.update.mockResolvedValue({
        ...mockMessage,
        folderId: 'folder-1',
      });
      const result = await service.move(
        'msg-1',
        { folderId: 'folder-1' },
        mockUser,
      );
      expect(result.folderId).toBe('folder-1');
    });

    it('throws NotFoundException when folder not in mailbox', async () => {
      prisma.message.findFirst.mockResolvedValue(mockMessage);
      prisma.mailboxFolder.findFirst.mockResolvedValue(null);
      await expect(
        service.move('msg-1', { folderId: 'bad' }, mockUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
