import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsDate,
  IsNotEmpty,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ListMessagesDto {
  @IsOptional()
  @IsString()
  threadId?: string;

  @IsOptional()
  @IsString()
  mailboxId?: string;

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsBoolean()
  isRead?: boolean;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  limit?: number;
}

export class BulkReadDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];

  @IsBoolean()
  isRead!: boolean;
}

export class MoveMessageDto {
  @IsString()
  @IsNotEmpty()
  folderId!: string;
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  mailboxId!: string;

  @IsOptional()
  @IsString()
  threadId?: string;

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

  @IsString()
  @IsOptional()
  subject?: string;

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

  @IsOptional()
  @IsString()
  timezone?: string;
}
