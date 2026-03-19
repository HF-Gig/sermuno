import {
  IsString,
  IsOptional,
  IsIn,
  IsBoolean,
  IsNumber,
  IsObject,
} from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @IsOptional()
  bodyHtml: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsIn(['organization', 'team', 'personal'])
  scope?: string;

  @IsOptional()
  variables?: Array<{
    name: string;
    description?: string;
    defaultValue?: string;
    required?: boolean;
  }>;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsIn(['organization', 'team', 'personal'])
  scope?: string;

  @IsOptional()
  variables?: Array<{
    name: string;
    description?: string;
    defaultValue?: string;
    required?: boolean;
  }>;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class RenderTemplateDto {
  @IsObject()
  variables: Record<string, string>;
}
