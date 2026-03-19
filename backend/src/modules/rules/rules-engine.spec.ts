import { Test, TestingModule } from '@nestjs/testing';
import { RulesEngineService } from './rules-engine.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';

const mockPrisma = {
  rule: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  thread: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  message: {
    updateMany: jest.fn(),
    createMany: jest.fn(),
  },
  threadTag: {
    upsert: jest.fn(),
  },
  tag: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  mailboxFolder: {
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const mockNotifications = {
  dispatch: jest.fn(),
};

const mockWebhooks = {
  dispatch: jest.fn(),
};

const baseThread = {
  id: 'thread-1',
  mailboxId: 'mailbox-1',
  organizationId: 'org-1',
  assignedUserId: 'assigned-user',
  assignedUser: { id: 'assigned-user' },
  assignedToTeamId: 'team-0',
  subject: 'Hello World',
  status: 'NEW',
  priority: 'NORMAL',
  messages: [
    {
      id: 'message-1',
      threadId: 'thread-1',
      mailboxId: 'mailbox-1',
      messageId: 'mid-1',
      direction: 'INBOUND',
      fromEmail: 'boss@example.com',
      to: ['hello@sermuno.com'],
      cc: ['team@sermuno.com'],
      bcc: [],
      subject: 'Hello World',
      bodyHtml: '<p>Body</p>',
      bodyText: 'Body',
      isInternalNote: false,
      isRead: false,
      isStarred: false,
      isDeleted: false,
      isDraft: false,
      isOutbound: false,
      inReplyTo: null,
      references: [],
      snippet: 'Body',
      replyTo: [],
      hasAttachments: true,
      sizeBytes: 42,
      folderId: 'folder-inbox',
      imapUid: 10,
    },
  ],
};

const makeRule = (overrides: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  name: 'Rule 1',
  userId: 'rule-user',
  teamId: 'rule-team',
  mailboxId: 'mailbox-1',
  priority: 2,
  conditionLogic: 'AND',
  executionMode: 'merge',
  conditions: [{ field: 'subject', operator: 'contains', value: 'hello' }],
  actions: [{ type: 'set_status', value: 'OPEN', status: 'OPEN' }],
  ...overrides,
});

describe('RulesEngineService', () => {
  let service: RulesEngineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RulesEngineService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: WebhooksService, useValue: mockWebhooks },
      ],
    }).compile();

    service = module.get<RulesEngineService>(RulesEngineService);
    jest.clearAllMocks();
    mockPrisma.thread.findUnique.mockResolvedValue(baseThread);
    mockPrisma.rule.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.thread.update.mockResolvedValue({});
    mockPrisma.message.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.message.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.threadTag.upsert.mockResolvedValue({});
    mockPrisma.tag.findFirst.mockResolvedValue({ id: 'tag-1' });
    mockPrisma.tag.create.mockResolvedValue({ id: 'tag-new' });
    mockPrisma.mailboxFolder.findFirst.mockResolvedValue({
      id: 'folder-target',
    });
    mockNotifications.dispatch.mockResolvedValue(undefined);
    mockWebhooks.dispatch.mockResolvedValue(undefined);
  });

  it('does nothing when no rules exist', async () => {
    mockPrisma.rule.findMany.mockResolvedValue([]);

    await service.evaluate('org-1', 'thread-1', { subject: 'hello' });

    expect(mockPrisma.thread.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['from', 'equals', 'boss@example.com', { from: 'boss@example.com' }],
    ['to', 'contains', 'sermuno.com', { to: 'hello@sermuno.com' }],
    ['cc', 'contains', 'team', { cc: 'team@sermuno.com' }],
    ['subject', 'starts_with', 'hello', { subject: 'Hello World' }],
    ['body', 'contains', 'body', { body: 'message body' }],
    ['has_attachments', 'is_true', '', { has_attachments: 'true' }],
    ['attachment_name', 'ends_with', '.pdf', { attachment_name: 'report.pdf' }],
    ['attachment_size', 'greater_than', '10', { attachment_size: '42' }],
    [
      'date_received',
      'less_than',
      '2026-12-31',
      { date_received: '2026-03-18' },
    ],
    ['is_reply', 'is_false', '', { is_reply: 'false' }],
    ['header', 'matches_regex', '^x-priority', { header: 'X-Priority: high' }],
  ])(
    'matches condition field %s with operator %s',
    async (field, operator, value, context) => {
      mockPrisma.rule.findMany.mockResolvedValue([
        makeRule({
          conditions: [{ field, operator, value }],
          actions: [{ type: 'mark_read' }],
        }),
      ]);

      await service.evaluate('org-1', 'thread-1', context);

      expect(mockPrisma.message.updateMany).toHaveBeenCalled();
    },
  );

  it.each([
    ['equals', 'hello world', { subject: 'hello world' }],
    ['not_equals', 'goodbye', { subject: 'hello world' }],
    ['contains', 'world', { subject: 'hello world' }],
    ['not_contains', 'spam', { subject: 'hello world' }],
    ['starts_with', 'hello', { subject: 'hello world' }],
    ['ends_with', 'world', { subject: 'hello world' }],
    ['matches_regex', 'hello\\s+world', { subject: 'hello world' }],
    ['greater_than', '10', { attachment_size: '42' }],
    ['less_than', '100', { attachment_size: '42' }],
    ['is_true', '', { has_attachments: 'true' }],
    ['is_false', '', { is_reply: 'false' }],
  ])('supports operator %s', async (operator, value, context) => {
    mockPrisma.rule.findMany.mockResolvedValue([
      makeRule({
        conditions: [{ field: Object.keys(context)[0], operator, value }],
        actions: [{ type: 'mark_read' }],
      }),
    ]);

    await service.evaluate('org-1', 'thread-1', context);

    expect(mockPrisma.message.updateMany).toHaveBeenCalled();
  });

  it('supports AND, OR, and nested groups', async () => {
    mockPrisma.rule.findMany.mockResolvedValue([
      makeRule({
        conditions: {
          operator: 'AND',
          conditions: [
            { field: 'subject', operator: 'contains', value: 'hello' },
            {
              operator: 'OR',
              conditions: [
                { field: 'from', operator: 'contains', value: 'boss' },
                { field: 'cc', operator: 'contains', value: 'team' },
              ],
            },
          ],
        },
        actions: [{ type: 'mark_read' }],
      }),
    ]);

    await service.evaluate('org-1', 'thread-1', {
      subject: 'hello world',
      from: 'boss@example.com',
      cc: 'other@example.com',
    });

    expect(mockPrisma.message.updateMany).toHaveBeenCalledWith({
      where: { threadId: 'thread-1' },
      data: { isRead: true },
    });
  });

  it('applies mailbox and user actions', async () => {
    mockPrisma.rule.findMany.mockResolvedValue([
      makeRule({
        actions: [
          { type: 'move_folder', value: 'Processed' },
          { type: 'copy_folder', value: 'Archive' },
          { type: 'mark_read' },
          { type: 'mark_unread' },
          { type: 'mark_flagged' },
          { type: 'mark_unflagged' },
          { type: 'delete' },
          { type: 'archive' },
          { type: 'assign_to_me' },
          { type: 'assign_to_user', targetUserId: 'user-2' },
          { type: 'assign_to_team', targetTeamId: 'team-2' },
          { type: 'add_tag', tagId: 'tag-1' },
          { type: 'add_personal_tag', value: 'Personal VIP' },
          { type: 'set_status', status: 'OPEN' },
          { type: 'set_priority', priority: 'HIGH' },
          { type: 'notify', targetUserId: 'user-3' },
          { type: 'send_webhook', value: 'rule-trigger' },
        ],
      }),
    ]);
    mockPrisma.tag.findFirst
      .mockResolvedValueOnce({ id: 'tag-1' })
      .mockResolvedValueOnce(null);

    await service.evaluate('org-1', 'thread-1', { subject: 'hello world' });

    expect(mockPrisma.message.updateMany).toHaveBeenCalledWith({
      where: { threadId: 'thread-1' },
      data: { folderId: 'folder-target' },
    });
    expect(mockPrisma.message.createMany).toHaveBeenCalled();
    expect(mockPrisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedUserId: 'rule-user' }),
      }),
    );
    expect(mockPrisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedUserId: 'user-2' }),
      }),
    );
    expect(mockPrisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assignedToTeamId: 'team-2' }),
      }),
    );
    expect(mockPrisma.threadTag.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.tag.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Personal VIP',
          scope: 'personal',
        }),
      }),
    );
    expect(mockNotifications.dispatch).toHaveBeenCalled();
    expect(mockWebhooks.dispatch).toHaveBeenCalledWith(
      'org-1',
      'rule.triggered',
      expect.objectContaining({ ruleId: 'rule-1' }),
    );
  });

  it('increments timesTriggered and lastTriggeredAt when matched', async () => {
    mockPrisma.rule.findMany.mockResolvedValue([
      makeRule({ actions: [{ type: 'mark_read' }] }),
    ]);

    await service.evaluate('org-1', 'thread-1', { subject: 'hello world' });

    expect(mockPrisma.rule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rule-1' },
        data: expect.objectContaining({
          timesTriggered: { increment: 1 },
          lastTriggeredAt: expect.any(Date),
        }),
      }),
    );
  });

  it('stops lower-priority rules when override mode matches', async () => {
    mockPrisma.rule.findMany.mockResolvedValue([
      makeRule({
        id: 'rule-1',
        priority: 1,
        executionMode: 'override',
        actions: [{ type: 'mark_read' }],
      }),
      makeRule({
        id: 'rule-2',
        priority: 2,
        executionMode: 'merge',
        actions: [{ type: 'mark_flagged' }],
      }),
    ]);

    await service.evaluate('org-1', 'thread-1', { subject: 'hello world' });

    expect(mockPrisma.message.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it('applies multiple matching rules in merge mode', async () => {
    mockPrisma.rule.findMany.mockResolvedValue([
      makeRule({
        id: 'rule-1',
        priority: 1,
        executionMode: 'merge',
        actions: [{ type: 'mark_read' }],
      }),
      makeRule({
        id: 'rule-2',
        priority: 2,
        executionMode: 'merge',
        actions: [{ type: 'mark_flagged' }],
      }),
      makeRule({
        id: 'rule-3',
        priority: 3,
        executionMode: 'merge',
        actions: [{ type: 'archive' }],
      }),
    ]);

    await service.evaluate('org-1', 'thread-1', { subject: 'hello world' });

    expect(mockPrisma.message.updateMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ archivedAt: expect.any(Date) }),
      }),
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(3);
  });
});
