import {
  IsString,
  IsDate,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsUUID,
  IsArray,
  IsEmail,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

export class CreateAttendeeDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class CreateCalendarEventDto {
  @IsString()
  title: string;

  @IsDate()
  @Type(() => Date)
  startTime: Date;

  @IsDate()
  @Type(() => Date)
  endTime: Date;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsEnum(['confirmed', 'tentative', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsEnum(['default', 'public', 'private'])
  visibility?: string;

  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  recurrenceEnd?: Date;

  @IsOptional()
  reminders?: object;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsUUID()
  linkedThreadId?: string;

  @IsOptional()
  @IsUUID()
  linkedContactId?: string;

  @IsOptional()
  @IsUUID()
  linkedCompanyId?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsEnum(['google_meet', 'zoom', 'microsoft_teams'])
  meetingProvider?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAttendeeDto)
  attendees?: CreateAttendeeDto[];
}

export class UpdateCalendarEventDto extends PartialType(
  CreateCalendarEventDto,
) {}
