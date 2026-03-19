export const ORGANIZATION_UPDATED_EVENT = 'sermuno:organization-updated';

export type OrganizationSettingsSnapshot = {
    name?: string;
    defaultLocale?: string;
    defaultTimezone?: string;
    emailFooter?: string;
    logoUrl?: string;
    enforceMfa?: boolean;
};
