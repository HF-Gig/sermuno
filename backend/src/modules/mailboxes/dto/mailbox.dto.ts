import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  IsEmail,
  IsNotEmpty,
  Min,
  Max,
} from 'class-validator';

export class CreateMailboxDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsIn(['GMAIL', 'OUTLOOK', 'SMTP'])
  provider!: string;

  @IsString()
  @IsOptional()
  imapHost?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(65535)
  imapPort?: number;

  @IsBoolean()
  @IsOptional()
  imapSecure?: boolean;

  @IsString()
  @IsOptional()
  imapUser?: string;

  @IsString()
  @IsOptional()
  imapPass?: string;

  @IsString()
  @IsOptional()
  smtpHost?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;

  @IsString()
  @IsOptional()
  smtpUser?: string;

  @IsString()
  @IsOptional()
  smtpPass?: string;

  @IsString()
  @IsOptional()
  @IsIn(['personal', 'shared', 'hybrid'])
  readStateMode?: string;

  @IsString()
  @IsOptional()
  organizationMailAccountId?: string;
}

export class UpdateMailboxDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  imapHost?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(65535)
  imapPort?: number;

  @IsBoolean()
  @IsOptional()
  imapSecure?: boolean;

  @IsString()
  @IsOptional()
  imapUser?: string;

  @IsString()
  @IsOptional()
  imapPass?: string;

  @IsString()
  @IsOptional()
  smtpHost?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(65535)
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;

  @IsString()
  @IsOptional()
  smtpUser?: string;

  @IsString()
  @IsOptional()
  smtpPass?: string;

  @IsString()
  @IsOptional()
  @IsIn(['personal', 'shared', 'hybrid'])
  readStateMode?: string;

  @IsString()
  @IsOptional()
  organizationMailAccountId?: string;
}

export class TestConnectionDto {
  @IsString()
  @IsIn(['GMAIL', 'OUTLOOK', 'SMTP'])
  provider!: string;

  @IsString()
  @IsOptional()
  imapHost?: string;

  @IsInt()
  @IsOptional()
  imapPort?: number;

  @IsBoolean()
  @IsOptional()
  imapSecure?: boolean;

  @IsString()
  @IsOptional()
  imapUser?: string;

  @IsString()
  @IsOptional()
  imapPass?: string;

  @IsString()
  @IsOptional()
  smtpHost?: string;

  @IsInt()
  @IsOptional()
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;

  @IsString()
  @IsOptional()
  smtpUser?: string;

  @IsString()
  @IsOptional()
  smtpPass?: string;
}

export class CreateMailboxAccessDto {
  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  teamId?: string;

  @IsBoolean()
  @IsOptional()
  canRead?: boolean;

  @IsBoolean()
  @IsOptional()
  canSend?: boolean;

  @IsBoolean()
  @IsOptional()
  canManage?: boolean;

  @IsBoolean()
  @IsOptional()
  canSetImapFlags?: boolean;
}

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  name!: string;
}
