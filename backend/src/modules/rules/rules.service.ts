import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { JwtUser } from '../../common/decorators/current-user.decorator';
import type {
  CreateRuleDto,
  UpdateRuleDto,
  RuleAction,
  RuleCondition,
  RuleConditionGroup,
} from './dto/rule.dto';
import { RuleTrigger, Prisma } from '@prisma/client';

@Injectable()
export class RulesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(user: JwtUser) {
    return this.prisma.rule.findMany({
      where: { organizationId: user.organizationId, deletedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string, user: JwtUser) {
    const rule = await this.prisma.rule.findFirst({
      where: { id, organizationId: user.organizationId, deletedAt: null },
    });
    if (!rule) throw new NotFoundException('Rule not found');
    return rule;
  }

  async create(dto: CreateRuleDto, user: JwtUser) {
    const trigger = (dto.trigger ?? 'INCOMING_EMAIL') as RuleTrigger;
    const conditions = this.normalizeConditions(
      dto.conditions,
      dto.conditionLogic ?? 'AND',
    );
    const actions = this.normalizeActions(dto.actions ?? []);

    return this.prisma.rule.create({
      data: {
        organizationId: user.organizationId,
        name: dto.name,
        isActive: dto.isActive ?? true,
        priority: dto.priority ?? 2,
        conditionLogic: dto.conditionLogic ?? 'AND',
        trigger,
        conditions: conditions as unknown as Prisma.InputJsonValue,
        actions: actions as unknown as Prisma.InputJsonValue,
        executionMode: dto.executionMode ?? 'merge',
        mailboxId: dto.mailboxId ?? null,
        teamId: dto.teamId ?? null,
        userId: dto.priority === 1 ? user.sub : null,
      },
    });
  }

  async update(id: string, dto: UpdateRuleDto, user: JwtUser) {
    await this.findOne(id, user);
    return this.prisma.rule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.priority !== undefined && { priority: dto.priority }),
        ...(dto.conditionLogic !== undefined && {
          conditionLogic: dto.conditionLogic,
        }),
        ...(dto.conditions !== undefined && {
          conditions: this.normalizeConditions(
            dto.conditions,
            dto.conditionLogic ?? undefined,
          ) as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.actions !== undefined && {
          actions: this.normalizeActions(
            dto.actions,
          ) as unknown as Prisma.InputJsonValue,
        }),
        ...(dto.executionMode !== undefined && {
          executionMode: dto.executionMode,
        }),
        ...(dto.priority !== undefined && {
          userId: dto.priority === 1 ? user.sub : null,
        }),
      },
    });
  }

  async remove(id: string, user: JwtUser) {
    await this.findOne(id, user);
    await this.prisma.rule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  private normalizeConditions(
    raw: CreateRuleDto['conditions'] | UpdateRuleDto['conditions'],
    fallbackLogic?: string,
  ): RuleConditionGroup {
    if (!raw) {
      return {
        operator: fallbackLogic === 'OR' ? 'OR' : 'AND',
        conditions: [],
      };
    }

    if (Array.isArray(raw)) {
      return {
        operator: fallbackLogic === 'OR' ? 'OR' : 'AND',
        conditions: raw.map((condition) =>
          this.normalizeConditionNode(condition),
        ),
      };
    }

    return this.normalizeConditionGroup(
      raw as RuleConditionGroup,
      fallbackLogic,
    );
  }

  private normalizeConditionGroup(
    group: RuleConditionGroup | Record<string, unknown>,
    fallbackLogic?: string,
  ): RuleConditionGroup {
    const rawConditions = Array.isArray(
      (group as RuleConditionGroup).conditions,
    )
      ? (group as RuleConditionGroup).conditions
      : [];

    return {
      operator:
        (group as RuleConditionGroup).operator === 'OR'
          ? 'OR'
          : fallbackLogic === 'OR'
            ? 'OR'
            : 'AND',
      conditions: rawConditions.map((condition) =>
        this.normalizeConditionNode(condition),
      ),
    };
  }

  private normalizeConditionNode(
    node: RuleCondition | RuleConditionGroup,
  ): RuleCondition | RuleConditionGroup {
    if (
      node &&
      typeof node === 'object' &&
      Array.isArray((node as RuleConditionGroup).conditions)
    ) {
      return this.normalizeConditionGroup(node as RuleConditionGroup);
    }

    const condition = node as RuleCondition;
    return {
      field: condition.field,
      operator: condition.operator,
      value: condition.value ?? '',
    };
  }

  private normalizeActions(actions: RuleAction[]): RuleAction[] {
    return actions.map((action) => ({
      ...action,
      type: this.normalizeActionType(action.type),
      value: action.value ?? '',
    }));
  }

  private normalizeActionType(type: RuleAction['type']): RuleAction['type'] {
    if (type === 'assign_user') return 'assign_to_user';
    if (type === 'assign_team') return 'assign_to_team';
    return type;
  }
}
