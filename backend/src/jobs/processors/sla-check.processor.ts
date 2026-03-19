import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SLA_CHECK_QUEUE } from '../queues/sla-check.queue';
import { PrismaService } from '../../database/prisma.service';
import { SlaService } from '../../modules/sla/sla.service';
import type {
  SlaTargets,
  BusinessHours,
  EscalationRule,
} from '../../modules/sla/dto/sla.dto';
import { ThreadStatus, MessageDirection } from '@prisma/client';

export interface SlaCheckJobData {
  organizationId: string;
  threadId?: string;
}

@Processor(SLA_CHECK_QUEUE, {
  concurrency: 2,
})
export class SlaCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(SlaCheckProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slaService: SlaService,
  ) {
    super();
  }

  async process(job: Job<SlaCheckJobData>): Promise<void> {
    const { organizationId, threadId } = job.data;
    this.logger.log(
      `[sla-check] Evaluating SLA org=${organizationId} thread=${threadId ?? 'all'}`,
    );

    // Find open threads with an attached SLA policy
    const threads = await this.prisma.thread.findMany({
      where: {
        organizationId,
        ...(threadId ? { id: threadId } : {}),
        status: {
          in: [ThreadStatus.OPEN, ThreadStatus.NEW, ThreadStatus.PENDING],
        },
        slaPolicyId: { not: null },
      },
      include: {
        slaPolicy: true,
      },
    });

    for (const thread of threads) {
      const policy = thread.slaPolicy;
      if (!policy) continue;
      const targets = policy.targets as unknown as SlaTargets;
      const businessHours = policy.businessHours
        ? (policy.businessHours as unknown as BusinessHours)
        : null;
      const escalationRules = (policy.escalationRules ??
        []) as unknown as EscalationRule[];

      const [latestInbound, latestOutbound] = await Promise.all([
        this.prisma.message.findFirst({
          where: {
            threadId: thread.id,
            direction: MessageDirection.INBOUND,
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
        this.prisma.message.findFirst({
          where: {
            threadId: thread.id,
            direction: MessageDirection.OUTBOUND,
            deletedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        }),
      ]);

      const deadlines = this.slaService.resolveThreadDeadlines(
        {
          createdAt: thread.createdAt,
          priority: thread.priority,
          latestInboundAt: latestInbound?.createdAt ?? null,
          latestOutboundAt: latestOutbound?.createdAt ?? null,
        },
        targets,
        businessHours,
      );
      const deadline = deadlines.firstResponseDueAt ?? deadlines.resolutionDueAt;
      const isBreached = Boolean(deadline && deadline <= new Date());

      await this.prisma.thread.update({
        where: { id: thread.id },
        data: {
          firstResponseDueAt: deadlines.firstResponseDueAt,
          resolutionDueAt: deadlines.resolutionDueAt,
          slaBreached: isBreached,
        },
      });

      if (!deadline || !isBreached || thread.slaBreached) continue;

      // SLA breached
      this.logger.warn(`[sla-check] SLA breached for thread ${thread.id}`);

      await this.prisma.auditLog.create({
        data: {
          organizationId,
          entityType: 'thread',
          entityId: thread.id,
          action: 'sla.breached',
          newValue: {
            slaPolicyId: policy.id,
            deadlineAt: deadline.toISOString(),
          },
        },
      });

      // Update breach count on the policy
      await this.prisma.slaPolicy.update({
        where: { id: policy.id },
        data: { breachesCount: { increment: 1 } },
      });

      // Apply escalation rules
      for (const rule of escalationRules) {
        const escalationDeadline = new Date(
          thread.createdAt.getTime() + rule.afterMinutes * 60_000,
        );
        if (escalationDeadline > new Date()) continue;

        await this.applyEscalation(thread.id, organizationId, policy.id, rule);
      }
    }
  }

  private async applyEscalation(
    threadId: string,
    organizationId: string,
    slaPolicyId: string,
    rule: EscalationRule,
  ): Promise<void> {
    try {
      switch (rule.action) {
        case 'reassign':
          await this.prisma.thread.update({
            where: { id: threadId },
            data: {
              ...(rule.targetUserId && { assignedUserId: rule.targetUserId }),
              ...(rule.targetTeamId && { assignedToTeamId: rule.targetTeamId }),
            },
          });
          break;

        case 'escalate':
        case 'notify':
          // notify / escalate: log the event; actual notification dispatch handled in Phase 5
          break;
      }

      await this.prisma.auditLog.create({
        data: {
          organizationId,
          entityType: 'thread',
          entityId: threadId,
          action: 'sla.escalated',
          newValue: {
            slaPolicyId,
            escalationAction: rule.action,
            afterMinutes: rule.afterMinutes,
            channel: rule.channel,
          },
        },
      });

      this.logger.log(
        `[sla-check] Escalation "${rule.action}" applied for thread ${threadId}`,
      );
    } catch (err) {
      this.logger.error(
        `[sla-check] Escalation failed for thread ${threadId}: ${String(err)}`,
      );
    }
  }
}
