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
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { WebhooksService } from '../../modules/webhooks/webhooks.service';

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
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
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
      const deadline =
        deadlines.firstResponseDueAt ?? deadlines.resolutionDueAt;
      const isBreached = Boolean(deadline && deadline <= new Date());

      await this.prisma.thread.update({
        where: { id: thread.id },
        data: {
          firstResponseDueAt: deadlines.firstResponseDueAt,
          resolutionDueAt: deadlines.resolutionDueAt,
          slaBreached: isBreached,
        },
      });

      if (deadline && !isBreached) {
        await this.dispatchSlaWarningIfDue({
          organizationId,
          threadId: thread.id,
          assignedUserId: thread.assignedUserId,
          mailboxId: thread.mailboxId,
          deadlineAt: deadline,
          policyId: policy.id,
        });
      }

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

      await this.dispatchSlaBreach({
        organizationId,
        threadId: thread.id,
        assignedUserId: thread.assignedUserId,
        mailboxId: thread.mailboxId,
        deadlineAt: deadline,
        policyId: policy.id,
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

        await this.applyEscalation(
          thread.id,
          organizationId,
          policy.id,
          rule,
          thread.assignedUserId,
          thread.mailboxId,
        );
      }
    }
  }

  private async applyEscalation(
    threadId: string,
    organizationId: string,
    slaPolicyId: string,
    rule: EscalationRule,
    assignedUserId: string | null,
    mailboxId: string,
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
          await this.dispatchEscalationNotification({
            threadId,
            organizationId,
            assignedUserId,
            targetUserId: rule.targetUserId,
            targetTeamId: rule.targetTeamId,
            mailboxId,
            action: rule.action,
            afterMinutes: rule.afterMinutes,
          });

          if (rule.channel === 'webhook') {
            await this.webhooks
              .dispatch(organizationId, 'sla.breach', {
                threadId,
                mailboxId,
                slaPolicyId,
                escalationAction: rule.action,
                afterMinutes: rule.afterMinutes,
                channel: rule.channel,
                targetUserId: rule.targetUserId ?? null,
                targetTeamId: rule.targetTeamId ?? null,
              })
              .catch((error) => {
                this.logger.error(
                  `[sla-check] Escalation webhook failed for thread ${threadId}: ${String(error)}`,
                );
              });
          }
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

  private async dispatchSlaWarningIfDue(params: {
    organizationId: string;
    threadId: string;
    assignedUserId: string | null;
    mailboxId: string;
    deadlineAt: Date;
    policyId: string;
  }) {
    const thresholdMinutes = 30;
    const minutesUntilBreach = Math.floor(
      (params.deadlineAt.getTime() - Date.now()) / 60_000,
    );
    if (minutesUntilBreach > thresholdMinutes) {
      return;
    }

    const alreadyWarned = await this.prisma.notification.findFirst({
      where: {
        organizationId: params.organizationId,
        type: 'sla_warning',
        resourceId: params.threadId,
      },
      select: { id: true },
    });
    if (alreadyWarned) {
      return;
    }

    const recipients = await this.getSlaRecipients(
      params.organizationId,
      params.assignedUserId,
    );

    await Promise.all(
      recipients.map((recipientId) =>
        this.notifications
          .dispatch({
            userId: recipientId,
            organizationId: params.organizationId,
            type: 'sla_warning',
            title: 'SLA warning',
            message: `Thread ${params.threadId} is due in ${Math.max(minutesUntilBreach, 0)} minute(s).`,
            resourceId: params.threadId,
            data: {
              threadId: params.threadId,
              mailboxId: params.mailboxId,
              policyId: params.policyId,
              minutesUntilBreach: Math.max(minutesUntilBreach, 0),
              deadlineAt: params.deadlineAt.toISOString(),
            },
          })
          .catch(() => undefined),
      ),
    );

    await this.webhooks
      .dispatch(params.organizationId, 'sla.warning', {
        threadId: params.threadId,
        mailboxId: params.mailboxId,
        policyId: params.policyId,
        deadlineAt: params.deadlineAt.toISOString(),
        minutesUntilBreach: Math.max(minutesUntilBreach, 0),
      })
      .catch(() => undefined);
  }

  private async dispatchSlaBreach(params: {
    organizationId: string;
    threadId: string;
    assignedUserId: string | null;
    mailboxId: string;
    deadlineAt: Date;
    policyId: string;
  }) {
    const recipients = await this.getSlaRecipients(
      params.organizationId,
      params.assignedUserId,
    );

    await Promise.all(
      recipients.map((recipientId) =>
        this.notifications
          .dispatch({
            userId: recipientId,
            organizationId: params.organizationId,
            type: 'sla_breach',
            title: 'SLA breached',
            message: `Thread ${params.threadId} breached its SLA target.`,
            resourceId: params.threadId,
            data: {
              threadId: params.threadId,
              mailboxId: params.mailboxId,
              policyId: params.policyId,
              deadlineAt: params.deadlineAt.toISOString(),
            },
          })
          .catch(() => undefined),
      ),
    );

    await this.webhooks
      .dispatch(params.organizationId, 'sla.breach', {
        threadId: params.threadId,
        mailboxId: params.mailboxId,
        policyId: params.policyId,
        deadlineAt: params.deadlineAt.toISOString(),
      })
      .catch(() => undefined);
  }

  private async dispatchEscalationNotification(params: {
    threadId: string;
    organizationId: string;
    assignedUserId: string | null;
    targetUserId?: string;
    targetTeamId?: string;
    mailboxId: string;
    action: 'notify' | 'escalate';
    afterMinutes: number;
  }) {
    const recipientIds = new Set<string>();
    if (params.targetUserId) {
      recipientIds.add(params.targetUserId);
    }
    if (params.assignedUserId) {
      recipientIds.add(params.assignedUserId);
    }

    if (params.targetTeamId) {
      const members = await this.prisma.teamMember.findMany({
        where: { teamId: params.targetTeamId },
        select: { userId: true },
      });
      for (const member of members) {
        recipientIds.add(member.userId);
      }
    }

    if (recipientIds.size === 0) {
      return;
    }

    await Promise.all(
      [...recipientIds].map((recipientId) =>
        this.notifications
          .dispatch({
            userId: recipientId,
            organizationId: params.organizationId,
            type: 'sla_breach',
            title: `SLA ${params.action}`,
            message: `Escalation triggered for thread ${params.threadId} after ${params.afterMinutes} minute(s).`,
            resourceId: params.threadId,
            data: {
              threadId: params.threadId,
              mailboxId: params.mailboxId,
              escalationAction: params.action,
              afterMinutes: params.afterMinutes,
            },
          })
          .catch(() => undefined),
      ),
    );
  }

  private async getSlaRecipients(
    organizationId: string,
    assignedUserId: string | null,
  ): Promise<string[]> {
    if (assignedUserId) {
      return [assignedUserId];
    }

    const managers = await this.prisma.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        isActive: true,
        role: { in: ['ADMIN', 'MANAGER'] },
      },
      select: { id: true },
    });
    return managers.map((entry) => entry.id);
  }
}
