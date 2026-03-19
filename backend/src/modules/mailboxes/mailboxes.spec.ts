import { Test, TestingModule } from '@nestjs/testing';
import { MailboxesService } from './mailboxes.service';
import { PrismaService } from '../../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { EMAIL_SYNC_QUEUE } from '../../jobs/queues/email-sync.queue';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import type { JwtUser } from '../../common/decorators/current-user.decorator';

const mockUser: JwtUser = {
  sub: 'user-1',
  email: 'admin@test.com',
  organizationId: 'org-1',
  role: 'ADMIN',
  permissions: [],
};

const mockMailbox = {
  id: 'mailbox-1',
  organizationId: 'org-1',
  name: 'Test Mailbox',
  email: 'test@example.com',
  provider: 'GMAIL',
  syncStatus: 'PENDING',
  healthStatus: 'unknown',
  lastSyncAt: null,
  readStateMode: 'personal',
  imapHost: null,
  imapPort: null,
  imapSecure: true,
  imapUser: null,
  imapPass: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: true,
  smtpUser: null,
  smtpPass: null,
  oauthProvider: null,
  oauthAccessToken: null,
  oauthRefreshToken: null,
  oauthTokenExpiresAt: null,
  googleAccessToken: null,
  googleRefreshToken: null,
  googleTokenExpiresAt: null,
  nextRetryAt: null,
  syncErrorCount: 0,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MailboxesService', () => {
  let service: MailboxesService;
  let prisma: {
    mailbox: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    mailboxAccess: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
    rule: { updateMany: jest.Mock };
    webhook: { findMany: jest.Mock; update: jest.Mock };
    mailboxFolder: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    teamMember: { findMany: jest.Mock };
  };
  let emailSyncQueue: { add: jest.Mock; getJobs: jest.Mock };

  beforeEach(async () => {
    prisma = {
      mailbox: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      mailboxAccess: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      rule: { updateMany: jest.fn() },
      webhook: { findMany: jest.fn(), update: jest.fn() },
      mailboxFolder: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      teamMember: { findMany: jest.fn() },
    };
    emailSyncQueue = {
      add: jest.fn(),
      getJobs: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailboxesService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, unknown> = {
                'encryption.key': 'test-secret-key-for-aes256-encryption-32b!',
                'featureFlags.enableStreamingSync': false,
              };
              return map[key];
            },
          },
        },
        {
          provide: getQueueToken(EMAIL_SYNC_QUEUE),
          useValue: emailSyncQueue,
        },
      ],
    }).compile();

    service = module.get<MailboxesService>(MailboxesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('returns mailboxes for the org', async () => {
      prisma.mailbox.findMany.mockResolvedValue([mockMailbox]);
      const result = await service.findAll(mockUser);
      expect(result).toHaveLength(1);
      expect(prisma.mailbox.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', deletedAt: null },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns a mailbox without sensitive fields', async () => {
      prisma.mailbox.findFirst.mockResolvedValue(mockMailbox);
      const result = await service.findOne('mailbox-1', mockUser);
      expect(result).not.toHaveProperty('imapPass');
      expect(result).not.toHaveProperty('smtpPass');
    });

    it('throws NotFoundException when mailbox not found', async () => {
      prisma.mailbox.findFirst.mockResolvedValue(null);
      await expect(service.findOne('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('encrypts imapPass and smtpPass', async () => {
      const created = { ...mockMailbox, id: 'new-1' };
      prisma.mailbox.create.mockResolvedValue(created);
      await service.create(
        {
          name: 'Test',
          provider: 'SMTP',
          imapPass: 'secret',
          smtpPass: 'secret2',
        },
        mockUser,
      );
      const callData = prisma.mailbox.create.mock.calls[0][0].data;
      expect(callData.imapPass).not.toBe('secret');
      expect(callData.smtpPass).not.toBe('secret2');
      // Should be iv:tag:ciphertext format
      expect(callData.imapPass).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
    });
  });

  describe('remove', () => {
    it('soft deletes the mailbox', async () => {
      prisma.mailbox.findFirst.mockResolvedValue(mockMailbox);
      prisma.mailbox.update.mockResolvedValue({
        ...mockMailbox,
        deletedAt: new Date(),
      });
      const result = await service.remove('mailbox-1', mockUser);
      expect(result.message).toContain('deleted');
      expect(prisma.mailbox.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws NotFoundException when mailbox not found', async () => {
      prisma.mailbox.findFirst.mockResolvedValue(null);
      await expect(service.remove('bad-id', mockUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('createAccess (XOR constraint)', () => {
    beforeEach(() => {
      prisma.mailbox.findFirst.mockResolvedValue(mockMailbox);
    });

    it('throws BadRequestException when both userId and teamId provided', async () => {
      await expect(
        service.createAccess(
          'mailbox-1',
          { userId: 'u1', teamId: 't1' },
          mockUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when neither userId nor teamId provided', async () => {
      await expect(
        service.createAccess('mailbox-1', {}, mockUser),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates access record with userId only', async () => {
      prisma.mailboxAccess.create.mockResolvedValue({ id: 'access-1' });
      await service.createAccess(
        'mailbox-1',
        { userId: 'u1', canRead: true },
        mockUser,
      );
      expect(prisma.mailboxAccess.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', teamId: null }),
        }),
      );
    });
  });

  describe('revokeAccess (hard delete)', () => {
    it('hard deletes the access record', async () => {
      prisma.mailbox.findFirst.mockResolvedValue(mockMailbox);
      prisma.mailboxAccess.findFirst.mockResolvedValue({
        id: 'access-1',
        mailboxId: 'mailbox-1',
      });
      prisma.mailboxAccess.delete.mockResolvedValue({});
      await service.revokeAccess('mailbox-1', 'access-1', mockUser);
      expect(prisma.mailboxAccess.delete).toHaveBeenCalledWith({
        where: { id: 'access-1' },
      });
    });
  });

  describe('triggerSync', () => {
    it('enqueues a job on the email-sync queue', async () => {
      prisma.mailbox.findFirst.mockResolvedValue(mockMailbox);
      emailSyncQueue.add.mockResolvedValue({ id: 'job-1' });
      const result = await service.triggerSync('mailbox-1', mockUser);
      expect(emailSyncQueue.add).toHaveBeenCalledWith(
        'sync',
        expect.objectContaining({
          mailboxId: 'mailbox-1',
          organizationId: 'org-1',
        }),
        expect.any(Object),
      );
      expect(result.message).toContain('enqueued');
    });
  });

  describe('revokeOauth', () => {
    it('disconnects OAuth mailbox and clears auth fields', async () => {
      prisma.mailbox.findFirst.mockResolvedValue({
        ...mockMailbox,
        oauthProvider: 'gmail',
        oauthAccessToken: 'enc-token',
      });
      prisma.rule.updateMany.mockResolvedValue({ count: 2 });
      prisma.webhook.findMany.mockResolvedValue([
        { id: 'wh-1', filterMailboxIds: ['mailbox-1', 'mailbox-2'] },
      ]);
      prisma.webhook.update.mockResolvedValue({ id: 'wh-1' });
      prisma.mailbox.update.mockResolvedValue({
        ...mockMailbox,
        oauthProvider: null,
      });

      const queueJob = {
        data: { mailboxId: 'mailbox-1' },
        remove: jest.fn().mockResolvedValue(undefined),
      };
      emailSyncQueue.getJobs.mockResolvedValue([queueJob]);

      const result = await service.revokeOauth('mailbox-1', mockUser);

      expect(prisma.mailbox.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mailbox-1' },
          data: expect.objectContaining({
            oauthProvider: null,
            oauthAccessToken: null,
            oauthRefreshToken: null,
            googleAccessToken: null,
            googleRefreshToken: null,
            imapPass: null,
            smtpPass: null,
            syncStatus: 'FAILED',
            healthStatus: 'failed',
          }),
        }),
      );
      expect(prisma.rule.updateMany).toHaveBeenCalled();
      expect(prisma.webhook.update).toHaveBeenCalled();
      expect(result.message).toContain('disconnected');
    });
  });

  describe('getEffectivePermissions (OR-merge)', () => {
    it('OR-merges permissions from user and team rows', async () => {
      prisma.teamMember.findMany.mockResolvedValue([{ teamId: 'team-1' }]);
      prisma.mailboxAccess.findMany.mockResolvedValue([
        {
          canRead: true,
          canSend: false,
          canManage: false,
          canSetImapFlags: false,
        },
        {
          canRead: false,
          canSend: true,
          canManage: false,
          canSetImapFlags: false,
        },
      ]);
      const result = await service.getEffectivePermissions(
        'mailbox-1',
        'user-1',
      );
      expect(result.canRead).toBe(true);
      expect(result.canSend).toBe(true);
      expect(result.canManage).toBe(false);
    });
  });
});
