import { IsString, IsOptional, IsIn } from 'class-validator';

export class CreateTagDto {
  @IsString()
  name: string;

  @IsString()
  color: string;

  @IsOptional()
  @IsIn(['organization', 'personal'])
  scope?: string;
}

export class UpdateTagDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsIn(['organization', 'personal'])
  scope?: string;
}
