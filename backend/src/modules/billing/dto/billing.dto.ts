import {
  IsString,
  IsOptional,
  IsIn,
  IsEmail,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCheckoutDto {
  @IsString()
  @IsOptional()
  priceId?: string;

  @IsString()
  @IsOptional()
  planType?: string;

  @IsString()
  @IsIn(['monthly', 'yearly'])
  @IsOptional()
  cycle?: 'monthly' | 'yearly';

  @IsString()
  @IsOptional()
  successUrl?: string;

  @IsString()
  @IsOptional()
  cancelUrl?: string;
}

export class CreatePortalDto {
  @IsString()
  @IsOptional()
  returnUrl?: string;
}

export class UpdateBillingAddressDto {
  @IsString()
  @IsOptional()
  line1?: string;

  @IsString()
  @IsOptional()
  line2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  postalCode?: string;

  @IsString()
  @IsOptional()
  country?: string;
}

export class UpdateBillingDetailsDto {
  @IsString()
  @IsOptional()
  companyName?: string;

  @IsEmail()
  @IsOptional()
  billingEmail?: string;

  @ValidateNested()
  @Type(() => UpdateBillingAddressDto)
  @IsOptional()
  address?: UpdateBillingAddressDto;

  @IsString()
  @IsOptional()
  taxNumber?: string;
}

export class ChangeSubscriptionDto {
  @IsString()
  @IsIn(['starter', 'professional'])
  planType: 'starter' | 'professional';

  @IsString()
  @IsIn(['monthly', 'yearly'])
  cycle: 'monthly' | 'yearly';
}

export class SyncCheckoutDto {
  @IsString()
  sessionId: string;
}
