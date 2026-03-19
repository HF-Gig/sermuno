import { IsString, IsOptional, IsEnum } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class UpdateTeamDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export enum TeamMemberRole {
  lead = 'lead',
  member = 'member',
}

export class AddTeamMemberDto {
  @IsString()
  userId: string;

  @IsEnum(TeamMemberRole)
  @IsOptional()
  role?: TeamMemberRole;
}

export class UpdateTeamMemberDto {
  @IsEnum(TeamMemberRole)
  role: TeamMemberRole;
}
