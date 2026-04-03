import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

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

export type EmailDeliveryMode =
  | 'instant'
  | 'hourly_digest'
  | 'daily_digest'
  | 'never';

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

  @IsOptional()
  @IsIn(['instant', 'hourly_digest', 'daily_digest', 'never'])
  emailDeliveryMode?: EmailDeliveryMode;
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

  @IsOptional()
  @IsIn(['web_push', 'fcm'])
  provider?: 'web_push' | 'fcm';

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsObject()
  subscription?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  deviceName?: string;

  @IsOptional()
  @IsString()
  browserName?: string;

  @IsOptional()
  @IsString()
  userAgent?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  soundEnabled?: boolean;
}

export class RevokePushTokenDto {
  @IsOptional()
  @IsString()
  registrationId?: string;

  @IsOptional()
  @IsString()
  registrationKey?: string;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsObject()
  subscription?: Record<string, unknown>;
}
