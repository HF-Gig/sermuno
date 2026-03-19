import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsObject,
} from 'class-validator';

export interface SlaTarget {
  firstResponseMinutes: number;
  nextResponseMinutes?: number;
  resolutionMinutes: number;
}

export interface BusinessHoursDay {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export interface SlaTargets {
  urgent?: SlaTarget;
  high?: SlaTarget;
  normal?: SlaTarget;
  low?: SlaTarget;
}

export interface BusinessHours {
  daysOfWeek?: number[]; // 0=Sunday, 6=Saturday
  startTime?: string; // "HH:mm"
  endTime?: string; // "HH:mm"
  timezone: string;
  days?: Record<string, BusinessHoursDay>;
}

export interface EscalationRule {
  afterMinutes: number;
  action: 'notify' | 'reassign' | 'escalate';
  channel?: 'email' | 'in_app' | 'webhook';
  targetUserId?: string;
  targetTeamId?: string;
}

export class CreateSlaPolicyDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  targets?: SlaTargets | Record<string, unknown> | unknown[];

  @IsOptional()
  @IsObject()
  businessHours?: BusinessHours;

  @IsOptional()
  @IsArray()
  holidays?: string[];

  @IsOptional()
  @IsArray()
  escalationRules?: EscalationRule[];

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSlaPolicyDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  targets?: SlaTargets | Record<string, unknown> | unknown[];

  @IsOptional()
  @IsObject()
  businessHours?: BusinessHours;

  @IsOptional()
  @IsArray()
  holidays?: string[];

  @IsOptional()
  @IsArray()
  escalationRules?: EscalationRule[];

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
