import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Message, type Thread } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import type {
  RuleAction,
  RuleCondition,
  RuleConditionGroup,
} from './dto/rule.dto';

interface EvaluationContext {
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  has_attachments?: string;
  attachment_name?: string;
  attachment_size?: string;
  date_received?: string;
  is_reply?: string;
  header?: string;
}

interface LoadedRule {
  id: string;
  name: string;
  userId: string | null;
  teamId: string | null;
  mailboxId: string | null;
  priority: number;
  conditionLogic: string | null;
  executionMode: string | null;
  conditions: Prisma.JsonValue;
  actions: Prisma.JsonValue;
}

@Injectable()
export class RulesEngineService {
  private readonly logger = new Logger(RulesEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhooksService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async evaluate(
    organizationId: string,
    threadId: string,
    context: EvaluationContext,
  ): Promise<void> {
    if (this.featureFlags.get('DISABLE_RULES_EVALUATION')) {
      this.logger.warn(
        `[rules-engine] DISABLE_RULES_EVALUATION active; skipped evaluation org=${organizationId} thread=${threadId}`,
      );
      return;
    }

    const rules = await this.prisma.rule.findMany({
      where: { organizationId, isActive: true, deletedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    for (const rule of rules as LoadedRule[]) {
      if (this.featureFlags.get('DISABLE_RULES_EVALUATION')) {
        this.logger.warn(
          `[rules-engine] DISABLE_RULES_EVALUATION active; halted actions org=${organizationId} thread=${threadId}`,
        );
        return;
      }

      const conditions = this.normalizeConditions(
        rule.conditions,
        rule.conditionLogic ?? 'AND',
      );
      if (!this.evaluateGroup(conditions, context)) {
        continue;
      }

      this.logger.log(
        `[rules-engine] Rule "${rule.name}" matched thread ${threadId}`,
      );
      await this.applyActions(
        this.normalizeActions(rule.actions),
        threadId,
        organizationId,
        rule,
      );

      await this.prisma.rule.update({
        where: { id: rule.id },
        data: {
          timesTriggered: { increment: 1 },
          lastTriggeredAt: new Date(),
        },
      });

      await this.prisma.auditLog.create({
        data: {
          organizationId,
          entityType: 'rule',
          entityId: rule.id,
          action: 'rule.triggered',
          newValue: { threadId, executionMode: rule.executionMode ?? 'merge' },
        },
      });

      if ((rule.executionMode ?? 'merge') === 'override') {
        break;
      }
    }
  }

  private normalizeConditions(
    input: Prisma.JsonValue,
    fallbackLogic: string,
  ): RuleConditionGroup {
    if (Array.isArray(input)) {
      return {
        operator: fallbackLogic === 'OR' ? 'OR' : 'AND',
        conditions: input.map((entry) => this.normalizeConditionNode(entry)),
      };
    }

    if (!input || typeof input !== 'object') {
      return {
        operator: fallbackLogic === 'OR' ? 'OR' : 'AND',
        conditions: [],
      };
    }

    const group = input as Record<string, Prisma.JsonValue>;
    const conditions = Array.isArray(group.conditions) ? group.conditions : [];
    return {
      operator:
        group.operator === 'OR' ? 'OR' : fallbackLogic === 'OR' ? 'OR' : 'AND',
      conditions: conditions.map((entry) => this.normalizeConditionNode(entry)),
    };
  }

  private normalizeConditionNode(
    input: Prisma.JsonValue,
  ): RuleCondition | RuleConditionGroup {
    if (
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      Array.isArray((input as Record<string, unknown>).conditions)
    ) {
      return this.normalizeConditions(input, 'AND');
    }

    const condition = (input ?? {}) as Record<string, string>;
    return {
      field: (condition.field as RuleCondition['field']) ?? 'subject',
      operator: (condition.operator as RuleCondition['operator']) ?? 'contains',
      value: condition.value ?? '',
    };
  }

  private normalizeActions(input: Prisma.JsonValue): RuleAction[] {
    if (!Array.isArray(input)) return [];
    return input.map((entry) => {
      const action = (entry ?? {}) as Record<string, string>;
      return {
        type: this.normalizeActionType(
          (action.type as RuleAction['type']) ?? 'add_tag',
        ),
        value: action.value ?? '',
        targetUserId: action.targetUserId,
        targetTeamId: action.targetTeamId,
        tagId: action.tagId,
        folderId: action.folderId,
        status: action.status,
        priority: action.priority,
      };
    });
  }

  private normalizeActionType(type: RuleAction['type']): RuleAction['type'] {
    if (type === 'assign_user') return 'assign_to_user';
    if (type === 'assign_team') return 'assign_to_team';
    return type;
  }

  private evaluateGroup(
    group: RuleConditionGroup,
    context: EvaluationContext,
  ): boolean {
    if (!group.conditions.length) return false;
    const results = group.conditions.map((condition) => {
      if ('conditions' in condition) {
        return this.evaluateGroup(condition, context);
      }
      return this.evaluateCondition(condition, context);
    });

    return group.operator === 'OR'
      ? results.some(Boolean)
      : results.every(Boolean);
  }

  private evaluateCondition(
    condition: RuleCondition,
    context: EvaluationContext,
  ): boolean {
    const fieldValue = String(context[condition.field] ?? '').toLowerCase();
    const expectedValue = String(condition.value ?? '').toLowerCase();

    switch (condition.operator) {
      case 'equals':
        return fieldValue === expectedValue;
      case 'not_equals':
        return fieldValue !== expectedValue;
      case 'contains':
        return fieldValue.includes(expectedValue);
      case 'not_contains':
        return !fieldValue.includes(expectedValue);
      case 'starts_with':
        return fieldValue.startsWith(expectedValue);
      case 'ends_with':
        return fieldValue.endsWith(expectedValue);
      case 'matches_regex':
        try {
          return new RegExp(condition.value ?? '', 'i').test(
            String(context[condition.field] ?? ''),
          );
        } catch {
          return false;
        }
      case 'greater_than':
        return this.compareComparableValues(fieldValue, expectedValue) > 0;
      case 'less_than':
        return this.compareComparableValues(fieldValue, expectedValue) < 0;
      case 'is_true':
        return fieldValue === 'true' || fieldValue === '1';
      case 'is_false':
        return (
          fieldValue === 'false' || fieldValue === '0' || fieldValue === ''
        );
      default:
        return false;
    }
  }

  private async applyActions(
    actions: RuleAction[],
    threadId: string,
    organizationId: string,
    rule: LoadedRule,
  ): Promise<void> {
    const thread = await this.prisma.thread.findUnique({
      where: { id: threadId },
      include: {
        messages: true,
        assignedUser: { select: { id: true } },
      },
    });
    if (!thread) return;

    for (const action of actions) {
      try {
        await this.applyAction(action, thread, organizationId, rule);
      } catch (err) {
        this.logger.error(
          `[rules-engine] Action ${action.type} failed for thread ${threadId}: ${String(err)}`,
        );
      }
    }
  }

  private async applyAction(
    action: RuleAction,
    thread: Thread & {
      messages: Message[];
      assignedUser: { id: string } | null;
    },
    organizationId: string,
    rule: LoadedRule,
  ) {
    switch (action.type) {
      case 'assign':
      case 'assign_to_me':
      case 'assign_to_user':
        await this.prisma.thread.update({
          where: { id: thread.id },
          data: {
            assignedUserId:
              action.targetUserId ||
              action.value ||
              rule.userId ||
              thread.assignedUserId ||
              null,
          },
        });
        return;
      case 'assign_to_team':
        await this.prisma.thread.update({
          where: { id: thread.id },
          data: {
            assignedToTeamId:
              action.targetTeamId || action.value || rule.teamId || null,
          },
        });
        return;
      case 'addTag':
      case 'add_tag':
      case 'add_personal_tag': {
        const tag = await this.resolveTag(action, organizationId, rule);
        if (!tag) return;
        await this.prisma.threadTag.upsert({
          where: { threadId_tagId: { threadId: thread.id, tagId: tag.id } },
          create: { threadId: thread.id, tagId: tag.id },
          update: {},
        });
        return;
      }
      case 'setStatus':
      case 'set_status':
        await this.prisma.thread.update({
          where: { id: thread.id },
          data: {
            status: (action.status ??
              action.value ??
              thread.status) as Prisma.EnumThreadStatusFieldUpdateOperationsInput['set'],
          },
        });
        return;
      case 'setPriority':
      case 'set_priority':
        await this.prisma.thread.update({
          where: { id: thread.id },
          data: {
            priority: (action.priority ??
              action.value ??
              thread.priority) as Prisma.EnumThreadPriorityFieldUpdateOperationsInput['set'],
          },
        });
        return;
      case 'mark_read':
        await this.prisma.message.updateMany({
          where: { threadId: thread.id },
          data: { isRead: true },
        });
        return;
      case 'mark_unread':
        await this.prisma.message.updateMany({
          where: { threadId: thread.id },
          data: { isRead: false },
        });
        return;
      case 'mark_flagged':
        await this.prisma.message.updateMany({
          where: { threadId: thread.id },
          data: { isStarred: true },
        });
        return;
      case 'mark_unflagged':
        await this.prisma.message.updateMany({
          where: { threadId: thread.id },
          data: { isStarred: false },
        });
        return;
      case 'delete':
        await this.prisma.message.updateMany({
          where: { threadId: thread.id },
          data: { isDeleted: true },
        });
        await this.prisma.thread.update({
          where: { id: thread.id },
          data: { status: 'TRASH' },
        });
        return;
      case 'archive':
        await this.prisma.thread.update({
          where: { id: thread.id },
          data: { archivedAt: new Date() },
        });
        return;
      case 'move_folder': {
        const folderId = await this.resolveFolderId(action, thread.mailboxId);
        if (!folderId) return;
        await this.prisma.message.updateMany({
          where: { threadId: thread.id },
          data: { folderId },
        });
        return;
      }
      case 'copy_folder': {
        const folderId = await this.resolveFolderId(action, thread.mailboxId);
        if (!folderId || thread.messages.length === 0) return;
        await this.prisma.message.createMany({
          data: thread.messages.map((message) => ({
            threadId: message.threadId,
            mailboxId: message.mailboxId,
            messageId: message.messageId,
            direction: message.direction,
            fromEmail: message.fromEmail,
            to: message.to as Prisma.InputJsonValue,
            cc: (message.cc ?? undefined) as Prisma.InputJsonValue | undefined,
            bcc: (message.bcc ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            subject: message.subject,
            bodyHtml: message.bodyHtml,
            bodyText: message.bodyText,
            isInternalNote: message.isInternalNote,
            isRead: message.isRead,
            isStarred: message.isStarred,
            isDeleted: false,
            isDraft: message.isDraft,
            isOutbound: message.isOutbound,
            inReplyTo: message.inReplyTo,
            references: (message.references ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            snippet: message.snippet,
            replyTo: (message.replyTo ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
            hasAttachments: message.hasAttachments,
            sizeBytes: message.sizeBytes,
            folderId,
            imapUid: null,
          })),
        });
        return;
      }
      case 'notify': {
        const userId =
          action.targetUserId ||
          action.value ||
          thread.assignedUserId ||
          rule.userId;
        if (!userId) return;
        await this.notifications.dispatch({
          userId,
          organizationId,
          type: 'rule_triggered',
          title: `Rule triggered: ${rule.name}`,
          message: `Rule action notify ran for thread ${thread.subject}`,
          resourceId: thread.id,
          data: {
            threadId: thread.id,
            ruleId: rule.id,
            mailboxId: thread.mailboxId,
          },
        });
        return;
      }
      case 'send_webhook':
        await this.webhooks.dispatch(organizationId, 'rule.triggered', {
          threadId: thread.id,
          ruleId: rule.id,
          mailboxId: thread.mailboxId,
          subject: thread.subject,
          action: action.value || action.type,
        });
        return;
      default:
        return;
    }
  }

  private async resolveTag(
    action: RuleAction,
    organizationId: string,
    rule: LoadedRule,
  ) {
    const tagId = action.tagId ?? undefined;
    if (tagId) {
      return this.prisma.tag.findFirst({
        where: { id: tagId, organizationId, deletedAt: null },
      });
    }

    const name = action.value?.trim();
    if (!name) return null;

    const existing = await this.prisma.tag.findFirst({
      where: { organizationId, name, deletedAt: null },
    });
    if (existing) return existing;

    return this.prisma.tag.create({
      data: {
        organizationId,
        name,
        color: action.type === 'add_personal_tag' ? '#F59E0B' : '#186358',
        scope: action.type === 'add_personal_tag' ? 'personal' : 'organization',
        ownerId: action.type === 'add_personal_tag' ? rule.userId : null,
      },
    });
  }

  private async resolveFolderId(
    action: RuleAction,
    mailboxId: string,
  ): Promise<string | null> {
    if (action.folderId) {
      const folder = await this.prisma.mailboxFolder.findFirst({
        where: { id: action.folderId, mailboxId },
      });
      return folder?.id ?? null;
    }

    const folderName = action.value?.trim();
    if (!folderName) return null;

    const folder = await this.prisma.mailboxFolder.findFirst({
      where: { mailboxId, name: { equals: folderName, mode: 'insensitive' } },
      select: { id: true },
    });
    return folder?.id ?? null;
  }

  private compareComparableValues(left: string, right: string): number {
    const looksLikeDate = (value: string) => /[-/:TZ]/i.test(value);
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);
    if (
      looksLikeDate(left) &&
      looksLikeDate(right) &&
      !Number.isNaN(leftDate) &&
      !Number.isNaN(rightDate)
    ) {
      return leftDate - rightDate;
    }

    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return left.localeCompare(right);
  }
}
