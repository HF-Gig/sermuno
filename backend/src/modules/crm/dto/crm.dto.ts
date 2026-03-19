export type ContactLifecycleStage = 'lead' | 'customer' | 'partner';
export type ContactSource = 'manual' | 'import' | 'email-sync';

export class CreateContactDto {
  email!: string;
  fullName?: string;
  additionalEmails?: string[];
  lifecycleStage?: ContactLifecycleStage;
  phoneNumbers?: Array<{ type: string; value: string; primary?: boolean }>;
  addresses?: Array<{
    type: string;
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
  socialProfiles?: Array<{ platform: string; url: string; username?: string }>;
  customFields?: Record<string, unknown>;
  assignedToUserId?: string;
  source?: ContactSource;
  avatarUrl?: string;
  companyId?: string;
}

export class UpdateContactDto {
  email?: string;
  fullName?: string;
  additionalEmails?: string[];
  lifecycleStage?: ContactLifecycleStage;
  phoneNumbers?: Array<{ type: string; value: string; primary?: boolean }>;
  addresses?: Array<{
    type: string;
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  }>;
  socialProfiles?: Array<{ platform: string; url: string; username?: string }>;
  customFields?: Record<string, unknown>;
  assignedToUserId?: string | null;
  source?: ContactSource;
  avatarUrl?: string | null;
  companyId?: string | null;
}

export class CreateCompanyDto {
  name!: string;
  primaryDomain?: string;
  additionalDomains?: string[];
  customFields?: Record<string, unknown>;
  logoUrl?: string;
}

export class UpdateCompanyDto {
  name?: string;
  primaryDomain?: string | null;
  additionalDomains?: string[];
  customFields?: Record<string, unknown>;
  logoUrl?: string | null;
}
