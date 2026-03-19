import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsNumber,
  IsArray,
  IsObject,
} from 'class-validator';

export class CreateSignatureDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsString()
  @IsOptional()
  contentHtml?: string;

  @IsOptional()
  @IsIn(['organization', 'team', 'personal'])
  scope?: string;

  @IsOptional()
  @IsString()
  mailboxId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}

export class UpdateSignatureDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  contentHtml?: string;

  @IsOptional()
  @IsIn(['organization', 'team', 'personal'])
  scope?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}

export class AssignSignatureDto {
  @IsOptional()
  @IsString()
  mailboxId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mailboxIds?: string[];
}
