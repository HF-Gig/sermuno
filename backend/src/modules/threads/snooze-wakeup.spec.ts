import { Test, TestingModule } from '@nestjs/testing';
import { SnoozeWakeupProcessor } from '../../jobs/processors/snooze-wakeup.processor';
import { PrismaService } from '../../database/prisma.service';
import { ThreadStatus } from '@prisma/client';

const mockPrisma = {
  thread: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

describe('SnoozeWakeupProcessor', () => {
  let processor: SnoozeWakeupProcessor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SnoozeWakeupProcessor,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    processor = module.get<SnoozeWakeupProcessor>(SnoozeWakeupProcessor);
    jest.clearAllMocks();
  });

  it('does nothing when no snoozed threads are ready', async () => {
    mockPrisma.thread.findMany.mockResolvedValue([]);
    // @ts-expect-error - passing minimal job for test
    await processor.process({ id: '1', data: {} });
    expect(mockPrisma.thread.update).not.toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('restores status and logs audit for each woken thread', async () => {
    mockPrisma.thread.findMany.mockResolvedValue([
      { id: 'thread-1', previousStatus: 'OPEN', organizationId: 'org-1' },
      { id: 'thread-2', previousStatus: null, organizationId: 'org-1' },
    ]);
    mockPrisma.thread.update.mockResolvedValue({});
    mockPrisma.auditLog.create.mockResolvedValue({});

    // @ts-expect-error - passing minimal job for test
    await processor.process({ id: '2', data: {} });

    expect(mockPrisma.thread.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.auditLog.create).toHaveBeenCalledTimes(2);

    // First thread restores to OPEN
    expect(mockPrisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thread-1' },
        data: expect.objectContaining({ status: ThreadStatus.OPEN }),
      }),
    );
    // Second thread (no previousStatus) falls back to OPEN
    expect(mockPrisma.thread.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'thread-2' },
        data: expect.objectContaining({ status: ThreadStatus.OPEN }),
      }),
    );
  });
});
