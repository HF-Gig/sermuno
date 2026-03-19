export type AppRole = 'ADMIN' | 'MANAGER' | 'USER';

export const normalizeRole = (role?: string | null): AppRole => {
    const normalized = String(role || 'USER').toUpperCase();
    if (normalized === 'ADMIN' || normalized === 'MANAGER') {
        return normalized;
    }
    return 'USER';
};

export const PAGE_ACCESS = {
    dashboard: ['ADMIN', 'MANAGER', 'USER'],
    inbox: ['ADMIN', 'MANAGER', 'USER'],
    calendar: ['ADMIN', 'MANAGER', 'USER'],
    contacts: ['ADMIN', 'MANAGER', 'USER'],
    analytics: ['ADMIN', 'MANAGER', 'USER'],
    notifications: ['ADMIN', 'MANAGER', 'USER'],
    profile: ['ADMIN', 'MANAGER', 'USER'],
    users: ['ADMIN', 'MANAGER', 'USER'],
    teams: ['ADMIN', 'MANAGER', 'USER'],
    mailboxes: ['ADMIN', 'MANAGER', 'USER'],
    signatures: ['ADMIN', 'MANAGER', 'USER'],
    templates: ['ADMIN', 'MANAGER', 'USER'],
    organizationSettings: ['ADMIN', 'MANAGER', 'USER'],
    rules: ['ADMIN', 'MANAGER'],
    sla: ['ADMIN', 'MANAGER'],
    webhooks: ['ADMIN', 'MANAGER'],
    export: ['ADMIN', 'MANAGER'],
    audit: ['ADMIN', 'MANAGER'],
    billing: ['ADMIN', 'MANAGER'],
} as const;

export const SETTINGS_TAB_ACCESS = {
    organization: ['ADMIN', 'MANAGER', 'USER'],
    mailboxes: ['ADMIN', 'MANAGER'],
    users: ['ADMIN', 'MANAGER'],
    teams: ['ADMIN', 'MANAGER'],
    tags: ['ADMIN', 'MANAGER', 'USER'],
    roles: ['ADMIN'],
    integrations: ['ADMIN'],
    billing: ['ADMIN'],
    notifications: ['ADMIN'],
    audit: ['ADMIN'],
} as const;

export const canAccess = (role: string | null | undefined, allowedRoles: readonly string[]) =>
    allowedRoles.includes(normalizeRole(role));

export const canManageOrgArea = (role?: string | null) =>
    canAccess(role, PAGE_ACCESS.organizationSettings);

export const canManageUsers = (role?: string | null) =>
    canAccess(role, ['ADMIN']);

export const canManageMailboxes = (role?: string | null) =>
    canAccess(role, ['ADMIN', 'MANAGER']);

export const getSignatureScopesForRole = (role?: string | null) =>
    canAccess(role, ['ADMIN', 'MANAGER']) ? ['organization', 'team', 'personal'] as const : ['personal'] as const;

export const getTemplateScopesForRole = (role?: string | null) =>
    canAccess(role, ['ADMIN', 'MANAGER']) ? ['organization', 'team', 'personal'] as const : ['personal'] as const;
