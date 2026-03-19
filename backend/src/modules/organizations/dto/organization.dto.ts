import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';

export class SetupOrganizationDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  defaultTimezone?: string;

  @IsString()
  @IsOptional()
  defaultLocale?: string;

  @IsString()
  @IsOptional()
  emailFooter?: string;

  @IsBoolean()
  @IsOptional()
  enforceMfa?: boolean;

  @IsString()
  @IsOptional()
  logoUrl?: string;
}

export class UpdateOrganizationDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  defaultTimezone?: string;

  @IsString()
  @IsOptional()
  defaultLocale?: string;

  @IsString()
  @IsOptional()
  emailFooter?: string;

  @IsBoolean()
  @IsOptional()
  enforceMfa?: boolean;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxMailboxes?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUsers?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxStorageGb?: number;
}
