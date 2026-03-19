import {
  IsEmail,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  IsIn,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum InviteRole {
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  USER = 'USER',
}

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsEnum(InviteRole)
  role: InviteRole;

  @IsString()
  @IsOptional()
  fullName?: string;
}

export class UpdateMeDto {
  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  locale?: string;

  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @IsObject()
  @IsOptional()
  preferences?: Record<string, unknown>;
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  fullName?: string;

  @IsEnum(InviteRole)
  @IsOptional()
  role?: InviteRole;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  locale?: string;
}

export class UsersQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(InviteRole)
  role?: InviteRole;

  @IsOptional()
  @IsIn(['active', 'inactive', 'invited', 'deleted'])
  status?: 'active' | 'inactive' | 'invited' | 'deleted';

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
