import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsInt,
  IsUUID,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export class CreateCalendarTemplateDto {
  @IsString()
  name: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  meetingLink?: string;

  @IsOptional()
  variableDefinitions?: object[];

  @IsOptional()
  requiredFields?: string[];

  @IsOptional()
  @IsString()
  invitationTemplate?: string;

  @IsOptional()
  @IsEnum(['google_meet', 'zoom', 'microsoft_teams'])
  meetingProvider?: string;

  @IsOptional()
  @IsEnum(['personal', 'team', 'organization'])
  scope?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCalendarTemplateDto extends PartialType(
  CreateCalendarTemplateDto,
) {}

export class CreateEventFromTemplateDto {
  @IsOptional()
  variables?: Record<string, string>;
}
