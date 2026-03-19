import { SlaCheckProcessor } from './sla-check.processor';

describe('SlaCheckProcessor', () => {
  let processor: SlaCheckProcessor;
  let prisma: any;
  let slaService: any;

  beforeEach(() => {
    prisma = {
      thread: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      message: {
        findFirst: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
      slaPolicy: {
        update: jest.fn(),
      },
    };
    slaService = {
      resolveThreadDeadlines: jest.fn(),
    };

    processor = new SlaCheckProcessor(prisma, slaService);
  });

  it('persists thread deadlines and breach state', async () => {
    prisma.thread.findMany.mockResolvedValue([
      {
        id: 'thread-1',
        createdAt: new Date('2026-03-09T09:00:00.000Z'),
        priority: 'NORMAL',
        slaBreached: false,
        slaPolicy: {
          id: 'sla-1',
          targets: {},
          businessHours: null,
          escalationRules: [],
        },
      },
    ]);
    prisma.message.findFirst
      .mockResolvedValueOnce({ createdAt: new Date('2026-03-09T09:00:00.000Z') })
      .mockResolvedValueOnce(null);
    slaService.resolveThreadDeadlines.mockReturnValue({
      firstResponseDueAt: new Date('2026-03-09T09:10:00.000Z'),
      resolutionDueAt: new Date('2026-03-09T12:00:00.000Z'),
    });

    await processor.process({
      data: { organizationId: 'org-1', threadId: 'thread-1' },
    } as any);

    expect(prisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thread-1' },
        data: expect.objectContaining({
          firstResponseDueAt: new Date('2026-03-09T09:10:00.000Z'),
          resolutionDueAt: new Date('2026-03-09T12:00:00.000Z'),
          slaBreached: true,
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
    expect(prisma.slaPolicy.update).toHaveBeenCalled();
  });

  it('uses assignedToTeamId when reassigning to a team', async () => {
    await (processor as any).applyEscalation('thread-1', 'org-1', 'sla-1', {
      action: 'reassign',
      afterMinutes: 5,
      targetTeamId: 'team-1',
    });

    expect(prisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thread-1' },
        data: expect.objectContaining({
          assignedToTeamId: 'team-1',
        }),
      }),
    );
  });
});
