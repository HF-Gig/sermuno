import {
  IsString,
  IsOptional,
  IsIn,
  IsArray,
  IsDate,
  IsBoolean,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListThreadsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  mailboxId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  assigned?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  mentioned?: boolean;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  folderType?: string;

  @IsOptional()
  @IsString()
  folder?: string;

  @IsOptional()
  @IsString()
  tag?: string;

  @IsOptional()
  @IsString()
  tagId?: string;

  @IsOptional()
  @IsString()
  slaDue?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  slaBreached?: boolean;
}

export class ThreadInboxCountsDto {
  @IsOptional()
  @IsString()
  mailboxId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeTagCounts?: boolean;
}

export class BulkUpdateThreadsDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];

  @IsOptional()
  @IsString()
  @IsIn(['NEW', 'OPEN', 'PENDING', 'CLOSED', 'ARCHIVED', 'TRASH', 'SNOOZED'])
  status?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  assignedToTeamId?: string;
}

export class UpdateThreadDto {
  @IsOptional()
  @IsString()
  @IsIn(['NEW', 'OPEN', 'PENDING', 'CLOSED', 'ARCHIVED', 'TRASH', 'SNOOZED'])
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  assignedToTeamId?: string;

  @IsOptional()
  @IsString()
  slaPolicyId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  snoozedUntil?: Date;
}

export class ComposeThreadDto {
  @IsString()
  @IsNotEmpty()
  mailboxId!: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsArray()
  @IsString({ each: true })
  to!: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  cc?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  bcc?: string[];

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @IsOptional()
  @IsString()
  rrule?: string;
}

export class ReplyThreadDto {
  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  bodyText?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  cc?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  bcc?: string[];

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @IsOptional()
  @IsString()
  rrule?: string;
}

export class ForwardThreadDto {
  @IsArray()
  @IsString({ each: true })
  to!: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  cc?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  bcc?: string[];

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  bodyText?: string;
}

export class AssignThreadDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;
}

export class CreateNoteDto {
  @IsString()
  @IsNotEmpty()
  body!: string;
}

export class UpdateNoteDto {
  @IsString()
  @IsNotEmpty()
  body!: string;
}

export class NoteMentionSuggestionsQueryDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class AddTagDto {
  @IsString()
  @IsNotEmpty()
  tagId!: string;
}

export class SnoozeThreadDto {
  @IsString()
  @IsNotEmpty()
  snoozedUntil!: string; // ISO 8601 datetime string
}

export class StarThreadDto {
  @Type(() => Boolean)
  @IsBoolean()
  starred!: boolean;
}
