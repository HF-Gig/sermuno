import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';

export interface DispatchNotificationParams {
  userId: string;
  organizationId: string;
  type: string;
  title: string;
  message?: string;
  resourceId?: string;
  data?: Record<string, unknown>;
  channels?: {
    email?: boolean;
    push?: boolean;
    desktop?: boolean;
  };
}

export class NotificationChannelConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @IsOptional()
  @IsBoolean()
  in_app?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  desktop?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsObject()
  preferences?: Record<string, NotificationChannelConfigDto>;

  [key: string]: unknown;
}

export class UpdateQuietHoursDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  start?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  end?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  channels?: string[];
}

export class UpdateOrganizationNotificationSettingsDto {
  @IsOptional()
  @IsObject()
  types?: Record<string, NotificationChannelConfigDto>;

  @IsOptional()
  @IsObject()
  defaults?: Record<string, NotificationChannelConfigDto>;
}

export class PushTokenDto {
  @IsOptional()
  @IsString()
  token?: string;
}
