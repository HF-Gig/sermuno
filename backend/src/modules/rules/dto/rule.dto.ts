import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsIn,
  IsArray,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export interface RuleCondition {
  field:
    | 'from'
    | 'to'
    | 'cc'
    | 'subject'
    | 'body'
    | 'has_attachments'
    | 'attachment_name'
    | 'attachment_size'
    | 'date_received'
    | 'is_reply'
    | 'header';
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'
    | 'starts_with'
    | 'ends_with'
    | 'matches_regex'
    | 'greater_than'
    | 'less_than'
    | 'is_true'
    | 'is_false';
  value?: string;
}

export interface RuleConditionGroup {
  operator: 'AND' | 'OR';
  conditions: Array<RuleCondition | RuleConditionGroup>;
}

export interface RuleAction {
  type:
    | 'assign'
    | 'assign_to_me'
    | 'assign_to_user'
    | 'assign_user'
    | 'assign_to_team'
    | 'assign_team'
    | 'addTag'
    | 'add_tag'
    | 'add_personal_tag'
    | 'setStatus'
    | 'set_status'
    | 'setPriority'
    | 'set_priority'
    | 'notify'
    | 'send_webhook'
    | 'move_folder'
    | 'copy_folder'
    | 'mark_read'
    | 'mark_unread'
    | 'mark_flagged'
    | 'mark_unflagged'
    | 'delete'
    | 'archive';
  targetUserId?: string;
  targetTeamId?: string;
  tagId?: string;
  folderId?: string;
  status?: string;
  priority?: string;
  value?: string;
}

export class CreateRuleDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsIn(['AND', 'OR'])
  conditionLogic?: string;

  @IsOptional()
  @IsString()
  trigger?: string;

  @IsOptional()
  conditions: RuleCondition[] | RuleConditionGroup | Record<string, unknown>;

  @IsArray()
  actions: RuleAction[];

  @IsOptional()
  @IsIn(['merge', 'override'])
  executionMode?: string;

  @IsOptional()
  @IsString()
  mailboxId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsIn(['AND', 'OR'])
  conditionLogic?: string;

  @IsOptional()
  conditions?: RuleCondition[] | RuleConditionGroup | Record<string, unknown>;

  @IsOptional()
  @IsArray()
  actions?: RuleAction[];

  @IsOptional()
  @IsIn(['merge', 'override'])
  executionMode?: string;
}
