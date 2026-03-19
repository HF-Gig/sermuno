import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsBoolean,
  IsIn,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  fullName: string;

  @IsString()
  @IsOptional()
  organizationName?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class AcceptInviteDto {
  @IsString()
  token: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  fullName: string;
}

export class VerifyEmailDto {
  @IsString()
  token: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class MfaEnableDto {
  @IsString()
  totp: string;
}

export class MfaDisableDto {
  @IsString()
  totp: string;
}

export class MfaVerifyLoginDto {
  @IsString()
  totp: string;

  @IsString()
  tempToken: string;
}

export class LogoutDto {
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class RevokeSessionDto {
  @IsString()
  sessionId: string;
}

export class FirebaseAuthDto {
  @IsString()
  @IsOptional()
  token?: string;

  @IsString()
  @IsOptional()
  idToken?: string;

  @IsString()
  @IsOptional()
  @IsIn(['google', 'microsoft'])
  method?: 'google' | 'microsoft';

  @IsString()
  @IsOptional()
  organizationName?: string;

  @IsString()
  @IsOptional()
  @IsIn(['login', 'register'])
  intent?: 'login' | 'register';
}
