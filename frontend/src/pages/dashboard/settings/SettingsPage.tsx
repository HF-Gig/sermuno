import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    Settings, Users, UsersRound, ShieldQuestion,
    CreditCard, ScrollText, Save, Mail, Tag, Zap, FileSignature,
    Upload, ImagePlus, Globe2, Palette, Plug, Building2, Check, Search, Filter, Bell,
    CheckCircle2, XCircle, ShieldCheck, ShieldOff, RotateCcw, Download, Plus, Edit2, Trash2, Inbox, X,
    RefreshCw, Loader2, FolderOpen, Activity, Clock, AlertCircle, AlertTriangle, Eye, EyeOff
} from 'lucide-react';
import AvatarCropModal from '../profile/components/AvatarCropModal';
import { type OrganizationSettingsSnapshot, ORGANIZATION_UPDATED_EVENT } from '../../../lib/organizationEvents';
import InviteUserModal, { type InviteRole } from './components/InviteUserModal';
import EditUserModal from './components/EditUserModal';
import SoftDeleteModal from './components/SoftDeleteModal';
import TeamModal, { type TeamRecord } from './components/TeamModal';
import DeleteMailboxModal from './components/DeleteMailboxModal';
import MailboxHealthModal from './components/MailboxHealthModal';
import MailboxFoldersModal from './components/MailboxFoldersModal';
import Modal from '../../../components/ui/Modal';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import api, { resolveAvatarUrl } from '../../../lib/api';
import { SETTINGS_TAB_ACCESS, canAccess, normalizeRole } from '../../../lib/rbac';
import StatusBadge from '../../../components/ui/StatusBadge';
import UpgradeBlockerModal from '../../../components/ui/UpgradeBlockerModal';
import TagsPage from '../tags/TagsPage';
import { useAuth } from '../../../context/AuthContext';
import { useWebSocket } from '../../../context/WebSocketContext';
import { useAdaptiveRows } from '../../../hooks/useAdaptiveCount';

interface Mailbox {
    id: string;
    name: string;
    email: string;
    provider: string;
    status: 'healthy' | 'degraded' | 'syncing' | 'error' | string;
    syncStatus: 'idle' | 'pending' | 'syncing' | 'error' | string;
    teamCount: number;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
    smtpUser?: string;
    smtpPass?: string;
    imapHost?: string;
    imapPort?: number;
    imapSecure?: boolean;
    imapUser?: string;
    imapPass?: string;
    lastSyncAt?: string | null;
    nextRetryAt?: string | null;
    syncErrorCount?: number;
    syncError?: string | null;
    deletedAt?: string | null;
    sharedMailbox?: boolean;
    readStateMode?: 'personal' | 'shared' | 'hybrid';
    mailboxAccess?: MailboxAccessEntry[];
}

const normalizeMailboxStatus = (value?: string | null): Mailbox['status'] => {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'healthy' || normalized === 'degraded' || normalized === 'failed') {
        return normalized;
    }
    return 'unknown';
};

const normalizeMailboxSyncStatus = (value?: string | null): Mailbox['syncStatus'] => {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'syncing' || normalized === 'pending') return normalized;
    if (normalized === 'failed' || normalized === 'error') return 'error';
    return 'idle';
};

const normalizeMailbox = (raw: any): Mailbox => ({
    ...raw,
    status: normalizeMailboxStatus(raw?.status ?? raw?.healthStatus),
    syncStatus: normalizeMailboxSyncStatus(raw?.syncStatus),
    teamCount: Number(raw?.teamCount ?? 0),
    syncErrorCount: Number(raw?.syncErrorCount ?? 0),
});

type MailboxAccessEntry = {
    accessId?: string;
    key: string;
    assigneeType: 'user' | 'team';
    assigneeId: string;
    assigneeName: string;
    canRead: boolean;
    canSend: boolean;
    canManage: boolean;
    canSetImapFlags: boolean;
};

type MailboxAccessPermissionKey = 'canRead' | 'canSend' | 'canManage' | 'canSetImapFlags';
type IntegrationProvider = 'google' | 'microsoft' | 'zoom';

type IntegrationStatus = {
    connected: boolean;
    healthy?: boolean;
    account?: string | null;
    lastCheckedAt?: string | null;
};

type CalDavStatus = IntegrationStatus & {
    url?: string | null;
    username?: string | null;
    calendarName?: string | null;
    lastError?: string | null;
};

const COMMON_TIMEZONES = ['UTC', 'Europe/Amsterdam', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Dubai'];
const auditActionVariant: Record<string, 'success' | 'warning' | 'error' | 'info' | 'neutral'> = {
    SETTINGS_UPDATED: 'info',
    MAILBOX_CREATED: 'success',
    USER_INVITED: 'info',
    ASSIGN: 'warning',
    TAG_ADD: 'neutral',
    RULE_TRIGGERED: 'neutral',
    STATUS_CHANGE: 'warning',
    REPLY_SENT: 'success',
};

const AUDIT_ACTION_LABELS: Record<string, string> = {
    NOTE_ADD: 'Note Added',
    NOTE_UPDATE: 'Note Updated',
    NOTE_DELETE: 'Note Deleted',
    'calendar_event.created': 'Event Created',
    'calendar_event.updated': 'Event Updated',
    'calendar_event.deleted': 'Event Deleted',
    'thread.assigned': 'Thread Assigned',
    'thread.statusChanged': 'Status Changed',
    'thread.snoozed': 'Thread Snoozed',
    'message.sent': 'Message Sent',
    'message.moved': 'Message Moved',
    'mailbox.created': 'Mailbox Created',
    'mailbox.updated': 'Mailbox Updated',
    'mailbox.deleted': 'Mailbox Deleted',
    'user.invited': 'User Invited',
    'user.updated': 'User Updated',
    'rule.triggered': 'Rule Triggered',
    'sla.breached': 'SLA Breached',
    'attachment.deleted': 'Attachment Deleted',
};

const AUDIT_ENTITY_LABELS: Record<string, string> = {
    thread: 'Thread',
    thread_note: 'Note',
    message: 'Message',
    mailbox: 'Mailbox',
    calendar_event: 'Event',
    user: 'User',
    team: 'Team',
    rule: 'Rule',
    organization: 'Organization',
    attachment: 'Attachment',
    sla_policy: 'SLA Policy',
};

const toTitleCaseWords = (value: string) => value
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const fallbackHumanize = (value: string) => {
    const normalized = String(value || '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[._]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized ? toTitleCaseWords(normalized) : 'Unknown';
};

const humanizeAuditAction = (action: string) => {
    if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
    return fallbackHumanize(action);
};

const humanizeAuditEntity = (entityType: string) => {
    if (AUDIT_ENTITY_LABELS[entityType]) return AUDIT_ENTITY_LABELS[entityType];
    return fallbackHumanize(String(entityType || '').replace(/_/g, ' '));
};

const truncateLine = (text: string, max = 80) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '--';
    if (clean.length <= max) return clean;
    return `${clean.slice(0, max - 3).trim()}...`;
};

const parseAuditValueObject = (value: unknown): Record<string, any> | null => {
    if (!value) return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, any>;
            }
        } catch {
            return null;
        }
    }
    return null;
};

const firstNonEmptyString = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value !== 'string') continue;
        const trimmed = value.trim();
        if (trimmed) return trimmed;
    }
    return '';
};

function relativeTime(date: Date): string {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
}
const formatPlanLabel = (value?: string) => {
    const upper = String(value || 'PROFESSIONAL').toUpperCase();
    return upper === 'PRO' ? 'PROFESSIONAL' : upper;
};

const resolveOrganizationLogoUrl = (logoUrl?: string | null) => {
    if (!logoUrl) return undefined;
    const normalized = String(logoUrl).trim();
    if (!normalized) return undefined;
    if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('data:') || normalized.startsWith('/')) {
        return resolveAvatarUrl(normalized);
    }
    return resolveAvatarUrl(`/uploads/organizations/logo/${normalized}`);
};
type BillingInfo = {
    currentPlan: string;
    subscriptionStatus: string;
    stripeSubscriptionId?: string | null;
    renewalDate: string | null;
    paymentMethod: { brand: string; last4: string; expMonth?: number; expYear?: number } | null;
    limits: { maxUsers: number; maxMailboxes: number; maxStorageGb: number };
    usage: { usersUsed: number; usersTotal: number; mailboxesUsed: number; mailboxesTotal: number; storageUsedGb: number; storageTotalGb: number };
    subscriptionDetails: {
        planName: string;
        billingCycle: 'monthly' | 'yearly' | null;
        nextBillingDate: string | null;
        trialEndDate: string | null;
        pricePerCycle: number | null;
        currency: string | null;
        autoRenew: boolean | null;
    };
};

const parseAuditRawValue = (value: unknown) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        return trimmed;
    }
};

const formatAuditScalarValue = (value: unknown, max = 80) => {
    if (value === null || value === undefined) return '--';
    if (typeof value === 'string') return truncateLine(value, max);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
        return truncateLine(JSON.stringify(value), max);
    } catch {
        return '--';
    }
};

const summarizeAuditPayload = (value: unknown, max = 120) => {
    const parsed = parseAuditRawValue(value);
    if (parsed === null || parsed === undefined) return '--';

    if (Array.isArray(parsed)) {
        return truncateLine(parsed.map((item) => formatAuditScalarValue(item, 40)).join(', '), max);
    }

    if (typeof parsed === 'object') {
        const entries = Object.entries(parsed as Record<string, unknown>)
            .filter(([, val]) => val !== null && val !== undefined && String(val).trim() !== '')
            .slice(0, 4)
            .map(([key, val]) => `${fallbackHumanize(key)}: ${formatAuditScalarValue(val, 40)}`);
        if (entries.length === 0) return '--';
        const suffix = Object.keys(parsed as Record<string, unknown>).length > 4 ? ' | ...' : '';
        return truncateLine(`${entries.join(' | ')}${suffix}`, max);
    }

    return formatAuditScalarValue(parsed, max);
};

const auditPayloadLines = (value: unknown) => {
    const parsed = parseAuditRawValue(value);
    if (parsed === null || parsed === undefined) return [] as string[];

    if (Array.isArray(parsed)) {
        if (parsed.length === 0) return [];
        return parsed.map((item, index) => `#${index + 1}: ${formatAuditScalarValue(item, 260)}`);
    }

    if (typeof parsed === 'object') {
        const entries = Object.entries(parsed as Record<string, unknown>)
            .filter(([, val]) => val !== null && val !== undefined && String(val).trim() !== '');
        if (entries.length === 0) return [];
        return entries.map(([key, val]) => `${fallbackHumanize(key)}: ${formatAuditScalarValue(val, 260)}`);
    }

    const text = formatAuditScalarValue(parsed, 260);
    return text === '--' ? [] : [text];
};

type AuditLogItem = {
    id: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    userId?: string | null;
    userName?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    createdAt: string;
    details?: string | null;
    newValue?: any;
    previousValue?: any;
};

type UserLookupValue = {
    fullName?: string;
    email?: string;
};

type PendingInviteRecord = {
    id: string;
    email: string;
    role: string;
    invitedBy: string | null;
    inviteDate: string;
    status: 'pending';
};

const SETTINGS_TAB_IDS = ['organization', 'mailboxes', 'users', 'teams', 'tags', 'roles', 'integrations', 'billing', 'notifications', 'audit'] as const;
const WEBHOOK_INTEGRATION_EVENTS = [
    'thread events',
    'message events',
    'contact events',
    'SLA events',
    'rule events',
    'calendar events',
] as const;

const ROLE_LEVELS = [
    { role: 'ADMIN', level: 3, description: 'Full system access' },
    { role: 'MANAGER', level: 2, description: 'Team and operational management access' },
    { role: 'USER', level: 1, description: 'Day-to-day workspace access' },
] as const;

const PERMISSION_CATALOG = {
    organization: ['organization:view', 'organization:create', 'organization:manage', 'organization:delete'],
    users: ['users:view', 'users:create', 'users:manage', 'users:delete'],
    teams: ['teams:view', 'teams:create', 'teams:manage', 'teams:delete'],
    mailboxes: ['mailboxes:view', 'mailboxes:create', 'mailboxes:manage', 'mailboxes:delete'],
    messages: ['messages:view', 'messages:create', 'messages:manage', 'messages:delete'],
    threads: ['threads:view', 'threads:create', 'threads:manage', 'threads:delete', 'threads:notes'],
    tags: ['tags:view', 'tags:create', 'tags:manage', 'tags:delete', 'tags:apply'],
    rules: ['rules:view', 'rules:create', 'rules:manage', 'rules:delete'],
    signatures: ['signatures:view', 'signatures:create', 'signatures:manage'],
    audit: ['audit:view'],
    settings: ['settings:view', 'settings:manage'],
} as const;

const ROLE_PERMISSION_DEFAULTS: Record<'ADMIN' | 'MANAGER' | 'USER', string[]> = {
    ADMIN: Object.values(PERMISSION_CATALOG).flat(),
    MANAGER: [
        'organization:view',
        'users:view', 'users:create', 'users:manage',
        'teams:view', 'teams:create', 'teams:manage',
        'mailboxes:view', 'mailboxes:create', 'mailboxes:manage',
        'messages:view', 'messages:create', 'messages:manage',
        'threads:view', 'threads:create', 'threads:manage', 'threads:notes',
        'tags:view', 'tags:create', 'tags:manage', 'tags:apply',
        'rules:view', 'rules:create', 'rules:manage',
        'signatures:view', 'signatures:create', 'signatures:manage',
        'audit:view',
        'settings:view',
    ],
    USER: [
        'organization:view',
        'mailboxes:view',
        'messages:view', 'messages:create',
        'threads:view', 'threads:create', 'threads:notes',
        'tags:view', 'tags:apply',
        'signatures:view', 'signatures:create',
        'settings:view',
    ],
};

const MicrosoftLogo = ({ className = 'w-4 h-4' }: { className?: string }) => (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" fill="#f25022" />
        <rect x="13" y="3" width="8" height="8" fill="#7fba00" />
        <rect x="3" y="13" width="8" height="8" fill="#00a4ef" />
        <rect x="13" y="13" width="8" height="8" fill="#ffb900" />
    </svg>
);

const SettingsPage: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { user: currentUser } = useAuth();
    const { socket, isConnected } = useWebSocket();
    const [activeTab, setActiveTab] = useState(() => {
        const tab = new URLSearchParams(location.search).get('tab');
        return SETTINGS_TAB_IDS.includes(tab as (typeof SETTINGS_TAB_IDS)[number]) ? tab : 'organization';
    });
    const [orgData, setOrgData] = useState<MockOrganizationSettings>({
        id: '',
        name: '',
        defaultLocale: 'en',
        defaultTimezone: 'UTC',
        emailFooter: '',
        plan: 'trial',
        subscriptionStatus: 'active',
        maxUsers: 0,
        maxMailboxes: 0,
        maxStorageGb: 0,
        stripeCustomerId: '',
        _count: { users: 0, mailboxes: 0 },
        enforceMfa: false,
    } as MockOrganizationSettings);
    const [saved, setSaved] = useState(false);
    const [saving, setSaving] = useState(false);
    const [orgLoading, setOrgLoading] = useState(true);
    const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
    const [isDragOverLogo, setIsDragOverLogo] = useState(false);
    const logoInputRef = useRef<HTMLInputElement>(null);
    const [showInviteUserModal, setShowInviteUserModal] = useState(false);
    const [inviteFeedback, setInviteFeedback] = useState<string | null>(null);
    const [auditSubTab, setAuditSubTab] = useState<'audit' | 'security'>('audit');
    const [auditSearch, setAuditSearch] = useState('');
    const [auditEntityFilter, setAuditEntityFilter] = useState('all');
    const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
    const [auditLoading, setAuditLoading] = useState(false);
    const [orgNotificationSettings, setOrgNotificationSettings] = useState<Record<string, any>>({});
    const [orgNotificationLoading, setOrgNotificationLoading] = useState(false);
    const [orgNotificationSaving, setOrgNotificationSaving] = useState(false);
    const [auditUserMap, setAuditUserMap] = useState<Record<string, UserLookupValue>>({});
    const [selectedAuditLog, setSelectedAuditLog] = useState<{
        log: AuditLogItem;
        actionLabel: string;
        entityLabel: string;
        userLabel: string;
        summary: string;
    } | null>(null);
    const [billingInfo, setBillingInfo] = useState<BillingInfo>({
        currentPlan: 'trial',
        subscriptionStatus: 'active',
        stripeSubscriptionId: null,
        renewalDate: null,
        paymentMethod: null,
        limits: { maxUsers: 0, maxMailboxes: 0, maxStorageGb: 0 },
        usage: { usersUsed: 0, usersTotal: 0, mailboxesUsed: 0, mailboxesTotal: 0, storageUsedGb: 0, storageTotalGb: 0 },
        subscriptionDetails: {
            planName: 'trial',
            billingCycle: 'monthly',
            nextBillingDate: null,
            trialEndDate: null,
            pricePerCycle: null,
            currency: null,
            autoRenew: null,
        },
    });
    const [localUsers, setLocalUsers] = useState<any[]>([]);
    const [brokenAvatarUserIds, setBrokenAvatarUserIds] = useState<Set<string>>(new Set());
    const [localTeams, setLocalTeams] = useState<TeamRecord[]>([]);
    const [teamsLoading, setTeamsLoading] = useState(false);
    const [editingUser, setEditingUser] = useState<any | null>(null);
    const [showEditUserModal, setShowEditUserModal] = useState(false);
    const [deletingUser, setDeletingUser] = useState<any | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [usersSubTab, setUsersSubTab] = useState<'users' | 'pending'>('users');
    const [pendingInvites, setPendingInvites] = useState<PendingInviteRecord[]>([]);
    const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
    const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
    const [revokeInviteConfirm, setRevokeInviteConfirm] = useState<PendingInviteRecord | null>(null);
    const [editingTeam, setEditingTeam] = useState<TeamRecord | null>(null);
    const [showTeamModal, setShowTeamModal] = useState(false);
    const [showUpgradeBlocker, setShowUpgradeBlocker] = useState(false);
    const [billingLoading, setBillingLoading] = useState(true);

    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const [teamDetailForm, setTeamDetailForm] = useState({ name: '', description: '', leadId: '', members: [] as string[], linkedMailboxIds: [] as string[] });
    const [teamDetailDirty, setTeamDetailDirty] = useState(false);
    const [confirmArchiveTeamId, setConfirmArchiveTeamId] = useState<string | null>(null);

    const roleRank = (role?: string) => ({ USER: 1, MANAGER: 2, ADMIN: 3 }[String(role || 'USER').toUpperCase()] || 0);
    const canManageUser = (target: any) => {
        if (!currentUser || !target) return false;
        if (String(currentUser.role || '').toUpperCase() !== 'ADMIN') return false;
        if (target.id === currentUser.id) return false;
        return roleRank(target.role) < roleRank(currentUser.role);
    };
    const allowedRolesForTarget = (target: any) => {
        if (!currentUser || !target || !canManageUser(target)) return [];
        return ['USER', 'MANAGER', 'ADMIN'].filter(role => roleRank(role) < roleRank(currentUser.role));
    };
    const currentRole = normalizeRole(currentUser?.role);
    const isAdmin = currentRole === 'ADMIN';
    const isManager = currentRole === 'MANAGER';
    const canInviteUsers = isAdmin;
    const canManageMailboxSettings = isAdmin;
    const canEditOrganizationSettings = isAdmin;
    const canViewPlanAndLimits = isAdmin || isManager;
    const canViewMailboxesTab = canAccess(currentRole, SETTINGS_TAB_ACCESS.mailboxes);
    const canViewUsersTab = canAccess(currentRole, SETTINGS_TAB_ACCESS.users);
    const canViewTeamsTab = canAccess(currentRole, SETTINGS_TAB_ACCESS.teams);
    const canEditTeamMailboxLinks = normalizeRole(currentRole) === 'ADMIN';
    const canViewIntegrationsTab = canAccess(currentRole, SETTINGS_TAB_ACCESS.integrations);
    const canViewBillingTab = canAccess(currentRole, SETTINGS_TAB_ACCESS.billing);
    const isOrgReadOnly = !canEditOrganizationSettings;
    const allowedSettingsTabIds = SETTINGS_TAB_IDS.filter(tabId => canAccess(currentRole, SETTINGS_TAB_ACCESS[tabId]));
    const sortUsersByRole = (users: any[]) => [...users].sort((a, b) => {
        const roleDiff = roleRank(b.role) - roleRank(a.role);
        if (roleDiff !== 0) return roleDiff;
        const activeDiff = Number(Boolean(b.isActive)) - Number(Boolean(a.isActive));
        if (activeDiff !== 0) return activeDiff;
        return String(a.fullName || a.email || '').localeCompare(String(b.fullName || b.email || ''));
    });

    const updateUserRole = async (userId: string, role: 'USER' | 'MANAGER' | 'ADMIN') => {
        setRolesError(null);
        setRolesSuccess(null);
        setRoleSavingUserId(userId);
        try {
            const response = await api.patch(`/users/${userId}`, { role });
            setLocalUsers((prev) => sortUsersByRole(prev.map((user) => (user.id === userId ? response.data : user))));
            setRolesSuccess('Role updated successfully.');
        } catch (error: any) {
            setRolesError(error?.response?.data?.message || 'Failed to update role.');
        } finally {
            setRoleSavingUserId(null);
        }
    };

    const openTeamPanel = (team: TeamRecord | null) => {
        if (!team) {
            setSelectedTeamId('new');
            setTeamDetailForm({ name: '', description: '', leadId: '', members: [], linkedMailboxIds: [] });
        } else {
            setSelectedTeamId(team.id);
            setTeamDetailForm({ name: team.name, description: team.description, leadId: team.leadId || '', members: [...team.members], linkedMailboxIds: [...(team.linkedMailboxIds || [])] });
        }
        setTeamDetailDirty(false);
        setConfirmArchiveTeamId(null);
    };

    const syncTeamMembers = async (
        teamId: string,
        previousMembers: string[],
        nextMembers: string[],
        previousLeadId: string,
        nextLeadId: string,
    ) => {
        const previousSet = new Set(previousMembers);
        const nextSet = new Set(nextMembers);

        const toAdd = nextMembers.filter((memberId) => !previousSet.has(memberId));
        const toRemove = previousMembers.filter((memberId) => !nextSet.has(memberId));
        const shared = nextMembers.filter((memberId) => previousSet.has(memberId));

        for (const memberId of toAdd) {
            await api.post(`/teams/${teamId}/members`, {
                userId: memberId,
                role: nextLeadId === memberId ? 'lead' : 'member',
            });
        }

        for (const memberId of shared) {
            const previousRole = previousLeadId === memberId ? 'lead' : 'member';
            const nextRole = nextLeadId === memberId ? 'lead' : 'member';
            if (previousRole !== nextRole) {
                await api.patch(`/teams/${teamId}/members/${memberId}`, {
                    role: nextRole,
                });
            }
        }

        for (const memberId of toRemove) {
            await api.delete(`/teams/${teamId}/members/${memberId}`);
        }
    };

    const syncTeamMailboxLinks = async (
        teamId: string,
        previousLinkedMailboxIds: string[],
        nextLinkedMailboxIds: string[],
    ) => {
        if (!canEditTeamMailboxLinks) return;

        const previousSet = new Set(previousLinkedMailboxIds);
        const nextSet = new Set(nextLinkedMailboxIds);

        const toAdd = nextLinkedMailboxIds.filter((mailboxId) => !previousSet.has(mailboxId));
        const toRemove = previousLinkedMailboxIds.filter((mailboxId) => !nextSet.has(mailboxId));

        for (const mailboxId of toAdd) {
            await api.post(`/mailboxes/${mailboxId}/access`, {
                teamId,
                canRead: true,
                canSend: true,
                canManage: false,
                canSetImapFlags: false,
            });
        }

        for (const mailboxId of toRemove) {
            const existingResponse = await api.get(`/mailboxes/${mailboxId}/access`);
            const existingRecords = Array.isArray(existingResponse.data) ? existingResponse.data : [];
            const teamRecord = existingRecords.find((record: any) => record?.team?.id === teamId);
            if (teamRecord?.id) {
                await api.delete(`/mailboxes/${mailboxId}/access/${teamRecord.id}`);
            }
        }
    };

    const saveTeamDetail = async () => {
        if (!teamDetailForm.name.trim()) return;
        try {
            if (selectedTeamId === 'new') {
                const res = await api.post('/teams', {
                    name: teamDetailForm.name.trim(),
                    description: teamDetailForm.description.trim(),
                });

                const t = res.data;
                const teamId = t.id;
                await syncTeamMembers(teamId, [], teamDetailForm.members, '', teamDetailForm.leadId || '');
                await syncTeamMailboxLinks(teamId, [], teamDetailForm.linkedMailboxIds);

                await fetchTeams();
                setSelectedTeamId(teamId);
            } else {
                const existingTeam = localTeams.find((team) => team.id === selectedTeamId);
                const res = await api.patch(`/teams/${selectedTeamId}`, {
                    name: teamDetailForm.name.trim(),
                    description: teamDetailForm.description.trim(),
                });

                const t = res.data;
                const teamId = t.id;
                await syncTeamMembers(
                    teamId,
                    existingTeam?.members || [],
                    teamDetailForm.members,
                    existingTeam?.leadId || '',
                    teamDetailForm.leadId || '',
                );
                await syncTeamMailboxLinks(
                    teamId,
                    existingTeam?.linkedMailboxIds || [],
                    teamDetailForm.linkedMailboxIds,
                );

                await fetchTeams();
            }
            setTeamDetailDirty(false);
        } catch (err) {
            console.error('Failed to save team:', err);
        }
    };

    const archiveTeam = async (teamId: string) => {
        try {
            await api.delete(`/teams/${teamId}`);
            setLocalTeams((prev) => prev.map((team) => team.id === teamId ? { ...team, status: 'deleted' } : team));
            setSelectedTeamId(null);
            setConfirmArchiveTeamId(null);
        } catch (err) {
            console.error('Failed to archive team:', err);
        }
    };

    const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
    const [mailboxesLoading, setMailboxesLoading] = useState(false);
    const [mailboxFormSaving, setMailboxFormSaving] = useState(false);
    const [mailboxFormError, setMailboxFormError] = useState<string | null>(null);
    const [testConnResult, setTestConnResult] = useState<{ type: 'smtp' | 'imap'; ok: boolean; message: string } | null>(null);
    const [testConnLoading, setTestConnLoading] = useState<'smtp' | 'imap' | null>(null);
    const [showMailboxForm, setShowMailboxForm] = useState(false);
    const [editingMailbox, setEditingMailbox] = useState<Mailbox | null>(null);
    const [deletingMailbox, setDeletingMailbox] = useState<Mailbox | null>(null);
    const [showDeleteMailboxModal, setShowDeleteMailboxModal] = useState(false);
    const [deletingMailboxPending, setDeletingMailboxPending] = useState(false);
    const [mailboxFormData, setMailboxFormData] = useState({
        name: '', email: '', provider: 'SMTP',
        smtpHost: '', smtpPort: '465', smtpSecure: true, smtpUser: '', smtpPass: '',
        imapHost: '', imapPort: '993', imapSecure: true, imapUser: '', imapPass: '',
        readStateMode: 'shared' as 'personal' | 'shared' | 'hybrid',
    });
    const [accessAssigneeType, setAccessAssigneeType] = useState<'user' | 'team'>('user');
    const [accessAssigneeId, setAccessAssigneeId] = useState('');
    const [mailboxAccessEntries, setMailboxAccessEntries] = useState<MailboxAccessEntry[]>([]);
    const [syncingMailboxIds, setSyncingMailboxIds] = useState<Set<string>>(new Set());
    const [healthMailbox, setHealthMailbox] = useState<Mailbox | null>(null);
    const [showHealthModal, setShowHealthModal] = useState(false);
    const [foldersMailbox, setFoldersMailbox] = useState<Mailbox | null>(null);
    const [showFoldersModal, setShowFoldersModal] = useState(false);
    const [syncToastMessage, setSyncToastMessage] = useState<string | null>(null);
    const [showSmtpPassword, setShowSmtpPassword] = useState(false);
    const [showImapPassword, setShowImapPassword] = useState(false);

    const [googleConnecting, setGoogleConnecting] = useState(false);
    const [microsoftConnecting, setMicrosoftConnecting] = useState(false);
    const [zoomConnecting, setZoomConnecting] = useState(false);
    const [oauthBanner, setOauthBanner] = useState<{ provider: IntegrationProvider; state: 'success' | 'error' } | null>(null);
    const [integrationStatus, setIntegrationStatus] = useState<Record<'google' | 'microsoft' | 'zoom', IntegrationStatus>>({
        google: { connected: false, healthy: false, account: null, lastCheckedAt: null },
        microsoft: { connected: false, healthy: false, account: null, lastCheckedAt: null },
        zoom: { connected: false, healthy: false, account: null, lastCheckedAt: null },
    });
    const [roleSavingUserId, setRoleSavingUserId] = useState<string | null>(null);
    const [rolesError, setRolesError] = useState<string | null>(null);
    const [rolesSuccess, setRolesSuccess] = useState<string | null>(null);
    const [calDavUrl, setCalDavUrl] = useState('');
    const [calDavUsername, setCalDavUsername] = useState('');
    const [calDavPassword, setCalDavPassword] = useState('');
    const [calDavSyncing, setCalDavSyncing] = useState(false);
    const [calDavDisconnecting, setCalDavDisconnecting] = useState(false);
    const [calDavMessage, setCalDavMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [calDavStatus, setCalDavStatus] = useState<CalDavStatus>({
        connected: false,
        url: null,
        username: null,
        calendarName: null,
        lastCheckedAt: null,
        lastError: null,
    });

    const fetchUsers = async () => {
        try {
            const res = await api.get('/users');
            const users = Array.isArray(res.data) ? res.data : [];
            setBrokenAvatarUserIds(new Set());
            setLocalUsers(sortUsersByRole(users));
            const lookup = users.reduce((acc: Record<string, UserLookupValue>, user: any) => {
                if (!user?.id) return acc;
                acc[user.id] = {
                    fullName: user.fullName || '',
                    email: user.email || '',
                };
                return acc;
            }, {});
            setAuditUserMap(lookup);
        } catch (err) {
            console.error('Failed to fetch users:', err);
        }
    };

    const fetchPendingInvites = async () => {
        if (!canInviteUsers) {
            setPendingInvites([]);
            return;
        }

        setPendingInvitesLoading(true);
        try {
            const res = await api.get('/invites/pending');
            setPendingInvites(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('Failed to fetch pending invites:', err);
        } finally {
            setPendingInvitesLoading(false);
        }
    };

    const fetchTeams = async () => {
        setTeamsLoading(true);
        try {
            const res = await api.get('/teams');
            const teams = Array.isArray(res.data) ? res.data : [];
            const formatted = teams.map((t: any) => {
                const leadMember = t.members?.find((m: any) => m.role === 'lead');
                const currentMembership = t.members?.find((m: any) => m.userId === currentUser?.id);
                const linkedMailboxIds = Array.from(new Set((t.mailboxAccess || []).map((entry: any) => entry.mailboxId).filter(Boolean)));
                return {
                    id: t.id,
                    name: t.name,
                    description: t.description || '',
                    memberCount: t._count?.members || 0,
                    mailboxCount: linkedMailboxIds.length,
                    workloadCount: t._count?.assignedThreads || 0,
                    members: t.members?.map((m: any) => m.userId) || [],
                    leadId: leadMember?.userId || '',
                    linkedMailboxIds,
                    createdAt: t.createdAt || '',
                    status: t.deletedAt ? 'deleted' : 'active',
                    teamRole: currentMembership?.role || 'none',
                };
            });
            setLocalTeams(formatted);
        } catch (err) {
            console.error('Failed to fetch teams:', err);
        } finally {
            setTeamsLoading(false);
        }
    };

    const fetchBillingInfo = async () => {
        setBillingLoading(true);
        try {
            const response = await api.get('/billing/info');
            setBillingInfo({
                currentPlan: response.data?.currentPlan || 'trial',
                subscriptionStatus: response.data?.subscriptionStatus || 'active',
                stripeSubscriptionId: response.data?.stripeSubscriptionId || null,
                renewalDate: response.data?.subscriptionDetails?.nextBillingDate || null,
                paymentMethod: response.data?.paymentMethod || null,
                limits: response.data?.limits || { maxUsers: 0, maxMailboxes: 0, maxStorageGb: 0 },
                usage: response.data?.usage || { usersUsed: 0, usersTotal: 0, mailboxesUsed: 0, mailboxesTotal: 0, storageUsedGb: 0, storageTotalGb: 0 },
                subscriptionDetails: response.data?.subscriptionDetails || {
                    planName: 'trial',
                    billingCycle: 'monthly',
                    nextBillingDate: null,
                    trialEndDate: null,
                    pricePerCycle: null,
                    currency: null,
                    autoRenew: null,
                },
            });
        } catch (error) {
            console.error('Failed to fetch billing info:', error);
        } finally {
            setBillingLoading(false);
        }
    };

    const fetchAuditLogs = async () => {
        setAuditLoading(true);
        try {
            const response = await api.get('/audit-logs', {
                params: {
                    page: 1,
                    limit: 200,
                },
            });

            setAuditLogs(Array.isArray(response.data?.logs) ? response.data.logs : []);
        } catch (error) {
            console.error('Failed to fetch audit logs:', error);
        } finally {
            setAuditLoading(false);
        }
    };

    const resolveAuditUserDisplay = (userId?: string | null) => {
        const fallback = userId ? `${userId.slice(0, 8)}...` : 'Unknown';
        if (!userId) return { label: 'Unknown', initial: 'U' };
        const fromMap = auditUserMap[userId];
        const label = firstNonEmptyString(fromMap?.fullName, fromMap?.email) || fallback;
        return {
            label,
            initial: label.charAt(0).toUpperCase() || 'U',
        };
    };

    const auditSummaryText = (log: AuditLogItem) => {
        const action = String(log.action || '');
        const actionLower = action.toLowerCase();
        const entityLabel = humanizeAuditEntity(log.entityType || 'item');
        const newValueObj = parseAuditValueObject(log.newValue);
        const previousValueObj = parseAuditValueObject(log.previousValue);

        if (actionLower.includes('created') || action === 'NOTE_ADD') {
            if (String(log.entityType || '').toLowerCase() === 'calendar_event') {
                const title = firstNonEmptyString(newValueObj?.title, newValueObj?.name, newValueObj?.subject);
                if (title) return truncateLine(`Title: ${title}`);
            }
            if (action === 'NOTE_ADD' || String(log.entityType || '').toLowerCase() === 'thread_note') {
                const body = firstNonEmptyString(newValueObj?.body, newValueObj?.text, newValueObj?.note);
                if (body) return truncateLine(body, 60);
            }
            if (String(log.entityType || '').toLowerCase() === 'message') {
                const subject = firstNonEmptyString(newValueObj?.subject, newValueObj?.title);
                if (subject) return truncateLine(subject);
            }
            return truncateLine(`${entityLabel} was created`);
        }

        if (actionLower.includes('updated') || action === 'NOTE_UPDATE') {
            const prevStatus = firstNonEmptyString(previousValueObj?.status);
            const nextStatus = firstNonEmptyString(newValueObj?.status);
            if (prevStatus || nextStatus) {
                return truncateLine(`Status: ${prevStatus || 'Unknown'} -> ${nextStatus || 'Unknown'}`);
            }

            const prevTitle = firstNonEmptyString(previousValueObj?.title);
            const nextTitle = firstNonEmptyString(newValueObj?.title);
            if (prevTitle || nextTitle) {
                return truncateLine('Title changed');
            }

            return truncateLine(`Updated ${entityLabel}`);
        }

        if (actionLower.includes('deleted') || action === 'NOTE_DELETE') {
            return truncateLine(`${entityLabel} was deleted`);
        }

        if (actionLower.includes('assigned')) {
            const assignedUserId = firstNonEmptyString(newValueObj?.userId, newValueObj?.assignedUserId, newValueObj?.assigneeId);
            if (assignedUserId) {
                const resolvedAssignee = resolveAuditUserDisplay(assignedUserId).label;
                return truncateLine(`Assigned to ${resolvedAssignee}`);
            }
            return truncateLine('Assigned');
        }

        if (actionLower.includes('breached')) {
            return truncateLine('SLA deadline exceeded');
        }

        const payloadPreview = summarizeAuditPayload(log.newValue) !== '--'
            ? summarizeAuditPayload(log.newValue)
            : summarizeAuditPayload(log.previousValue);
        if (payloadPreview !== '--') {
            return truncateLine(payloadPreview, 110);
        }

        return truncateLine(`${entityLabel} - ${humanizeAuditAction(action)}`);
    };

    const fetchMailboxes = async (showLoading = true) => {
        if (showLoading) {
            setMailboxesLoading(true);
        }
        try {
            const res = await api.get('/mailboxes');
            const rows = Array.isArray(res.data) ? res.data : [];
            const normalizedRows = rows.map(normalizeMailbox);
            setMailboxes(normalizedRows);
            return normalizedRows;
        } catch (err) {
            console.error('Failed to fetch mailboxes:', err);
            return [] as Mailbox[];
        } finally {
            if (showLoading) {
                setMailboxesLoading(false);
            }
        }
    };

    const fetchOrganizationNotificationSettings = async () => {
        setOrgNotificationLoading(true);
        try {
            const response = await api.get('/notifications/org-settings');
            setOrgNotificationSettings(response.data?.types || {});
        } catch (error) {
            console.error('Failed to fetch notification settings:', error);
        } finally {
            setOrgNotificationLoading(false);
        }
    };

    const saveOrganizationNotificationSettings = async () => {
        setOrgNotificationSaving(true);
        try {
            await api.patch('/notifications/org-settings', { types: orgNotificationSettings });
            setSaved(true);
            setTimeout(() => setSaved(false), 1800);
        } catch (error) {
            console.error('Failed to save notification settings:', error);
        } finally {
            setOrgNotificationSaving(false);
        }
    };

    const fetchIntegrationStatus = async () => {
        try {
            const response = await api.get('/integrations/status');
            const data = response.data || {};
            setIntegrationStatus({
                google: {
                    connected: Boolean(data.google?.connected),
                    healthy: Boolean(data.google?.healthy),
                    account: data.google?.account || null,
                    lastCheckedAt: data.google?.lastCheckedAt || null,
                },
                microsoft: {
                    connected: Boolean(data.microsoft?.connected),
                    healthy: Boolean(data.microsoft?.healthy),
                    account: data.microsoft?.account || null,
                    lastCheckedAt: data.microsoft?.lastCheckedAt || null,
                },
                zoom: {
                    connected: Boolean(data.zoom?.connected),
                    healthy: Boolean(data.zoom?.healthy),
                    account: data.zoom?.account || null,
                    lastCheckedAt: data.zoom?.lastCheckedAt || null,
                },
            });
            const nextCalDavStatus: CalDavStatus = {
                connected: Boolean(data.caldav?.connected),
                url: data.caldav?.url || null,
                username: data.caldav?.username || null,
                calendarName: data.caldav?.calendarName || null,
                lastCheckedAt: data.caldav?.lastCheckedAt || null,
                lastError: data.caldav?.lastError || null,
            };
            setCalDavStatus(nextCalDavStatus);
            setCalDavUrl(nextCalDavStatus.url || '');
            setCalDavUsername(nextCalDavStatus.username || '');
        } catch (error) {
            console.error('Failed to fetch integrations status:', error);
        }
    };

    useEffect(() => {
        const fetchOrgData = async () => {
            setOrgLoading(true);
            try {
                const response = await api.get('/organizations/me');
                setOrgData(prev => ({ ...prev, ...response.data }));
            } catch (error) {
                console.error('Failed to fetch organization settings:', error);
            } finally {
                setOrgLoading(false);
            }
        };
        fetchOrgData();
        if (canViewMailboxesTab) {
            fetchMailboxes();
        }
        if (canViewUsersTab) {
            fetchUsers();
        }
        if (canViewTeamsTab) {
            fetchTeams();
        }
        if (canViewIntegrationsTab) {
            fetchIntegrationStatus();
        }

        const params = new URLSearchParams(location.search);
        const tabParam = params.get('tab');
        const checkoutSessionId = params.get('session_id');
        if (tabParam === 'billing' && params.get('success') === 'true') {
            setActiveTab('billing');
            if (checkoutSessionId) {
                api.post('/billing/checkout/sync', { sessionId: checkoutSessionId })
                    .catch((error) => console.error('Failed to sync checkout session:', error))
                    .finally(() => fetchBillingInfo());
            } else {
                fetchBillingInfo();
            }

            const nextParams = new URLSearchParams(location.search);
            nextParams.delete('success');
            nextParams.delete('session_id');
            window.history.replaceState({}, '', `${location.pathname}?${nextParams.toString()}`);
            return;
        }

        const oauthProvider = params.get('oauth') === 'microsoft' ? 'microsoft' : 'google';
        const isMailboxOauthCallback = tabParam === 'mailboxes' && Boolean(params.get('oauth'));
        const isIntegrationsOauthCallback = tabParam === 'integrations' && Boolean(params.get('oauth'));
        if (isMailboxOauthCallback && params.get('success') === 'true') {
            setActiveTab('mailboxes');
            setOauthBanner({ provider: oauthProvider, state: 'success' });
            if (canViewMailboxesTab) {
                fetchMailboxes();
            }
            if (canViewIntegrationsTab) {
                fetchIntegrationStatus();
            }
            setTimeout(() => setOauthBanner(null), 5000);
            const nextParams = new URLSearchParams(location.search);
            nextParams.delete('success');
            nextParams.delete('oauth');
            window.history.replaceState({}, '', `${location.pathname}?${nextParams.toString()}`);
        } else if (isMailboxOauthCallback && params.get('error') === 'true') {
            setActiveTab('mailboxes');
            setOauthBanner({ provider: oauthProvider, state: 'error' });
            setTimeout(() => setOauthBanner(null), 6000);
            const nextParams = new URLSearchParams(location.search);
            nextParams.delete('error');
            nextParams.delete('oauth');
            window.history.replaceState({}, '', `${location.pathname}?${nextParams.toString()}`);
        } else if (isIntegrationsOauthCallback && params.get('success') === 'true') {
            const provider = (params.get('oauth') === 'zoom' ? 'zoom' : oauthProvider) as IntegrationProvider;
            setActiveTab('integrations');
            setOauthBanner({ provider, state: 'success' });
            if (canViewIntegrationsTab) {
                fetchIntegrationStatus();
            }
            setTimeout(() => setOauthBanner(null), 5000);
            const nextParams = new URLSearchParams(location.search);
            nextParams.delete('success');
            nextParams.delete('oauth');
            window.history.replaceState({}, '', `${location.pathname}?${nextParams.toString()}`);
        } else if (isIntegrationsOauthCallback && params.get('error') === 'true') {
            const provider = (params.get('oauth') === 'zoom' ? 'zoom' : oauthProvider) as IntegrationProvider;
            setActiveTab('integrations');
            setOauthBanner({ provider, state: 'error' });
            setTimeout(() => setOauthBanner(null), 6000);
            const nextParams = new URLSearchParams(location.search);
            nextParams.delete('error');
            nextParams.delete('oauth');
            window.history.replaceState({}, '', `${location.pathname}?${nextParams.toString()}`);
        }
    }, []);

    useEffect(() => {
        if (!canInviteUsers) {
            setUsersSubTab('users');
            setPendingInvites([]);
            return;
        }
        fetchPendingInvites();
    }, [canInviteUsers]);

    useEffect(() => {
        if (!canViewBillingTab) {
            setBillingLoading(false);
            return;
        }
        fetchBillingInfo();
    }, [canViewBillingTab]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const response = await api.patch('/organizations/me', {
                name: orgData.name,
                locale: orgData.defaultLocale,
                defaultTimezone: orgData.defaultTimezone,
                emailFooter: orgData.emailFooter,
                logoUrl: orgData.logoUrl,
                enforceMfa: Boolean(orgData.enforceMfa)
            });
            setOrgData(prev => ({ ...prev, ...response.data }));
            window.dispatchEvent(new CustomEvent(ORGANIZATION_UPDATED_EVENT, { detail: response.data }));
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            console.error('Failed to save organization settings:', error);
        } finally {
            setSaving(false);
        }
    };
    const handleManageBilling = async () => {
        try {
            const response = await api.post('/billing/portal');
            if (response.data?.url) {
                window.location.href = response.data.url;
            }
        } catch (error) {
            console.error('Failed to open billing portal:', error);
            navigate('/billing/manage');
        }
    };

    const updateField = (key: string, value: string) => {
        setOrgData(prev => ({ ...prev, [key]: value }));
    };
    const integrationStates = useMemo(() => ({
        google: {
            connected: integrationStatus.google.connected,
            account: integrationStatus.google.account || null,
        },
        microsoft: {
            connected: integrationStatus.microsoft.connected,
            account: integrationStatus.microsoft.account || null,
        },
        zoom: {
            connected: integrationStatus.zoom.connected,
            account: integrationStatus.zoom.account,
        },
    }), [integrationStatus]);

    const handleDisconnect = async (provider: IntegrationProvider) => {
        if (provider === 'zoom') {
            try {
                await api.delete('/integrations/zoom');
                await fetchIntegrationStatus();
            } catch (error) {
                console.error('Failed to disconnect zoom:', error);
            }
            return;
        }

        const mailbox = mailboxes.find(item => provider === 'google' ? item.provider === 'GMAIL' : item.provider === 'OUTLOOK');
        if (!mailbox) return;

        try {
            await api.delete(`/mailboxes/${mailbox.id}/oauth`);
            await fetchMailboxes();
            await fetchIntegrationStatus();
        } catch (error) {
            console.error(`Failed to disconnect ${provider}:`, error);
        }
    };

    const connectProvider = async (provider: IntegrationProvider) => {
        if (provider === 'google') {
            setGoogleConnecting(true);
            try {
                const res = await api.get('/auth/google/url');
                window.location.href = res.data.url;
            } catch (error) {
                console.error('Failed to connect Google integration:', error);
                setGoogleConnecting(false);
            }
            return;
        }

        if (provider === 'microsoft') {
            setMicrosoftConnecting(true);
            try {
                const res = await api.get('/auth/microsoft/url');
                window.location.href = res.data.url;
            } catch (error) {
                console.error('Failed to connect Microsoft integration:', error);
                setMicrosoftConnecting(false);
            }
            return;
        }

        setZoomConnecting(true);
        try {
            const res = await api.get('/auth/zoom/url');
            window.location.href = res.data.url;
        } catch (error) {
            console.error('Failed to connect Zoom integration:', error);
            setOauthBanner({ provider: 'zoom', state: 'error' });
            setTimeout(() => setOauthBanner(null), 6000);
            setZoomConnecting(false);
        }
    };

    const syncCalDav = async () => {
        const nextUrl = calDavUrl.trim();
        const nextUsername = calDavUsername.trim();
        if (!nextUrl || !nextUsername || (!calDavPassword && !calDavStatus.connected)) {
            setCalDavMessage({ type: 'error', text: 'CalDAV URL and username are required. Enter a password the first time you connect.' });
            return;
        }

        setCalDavSyncing(true);
        setCalDavMessage(null);
        try {
            const response = await api.post('/calendar/sync/caldav', {
                calDavUrl: nextUrl,
                username: nextUsername,
                password: calDavPassword || undefined,
            });
            const synced = Number(response.data?.synced || 0);
            const deleted = Number(response.data?.deleted || 0);
            setCalDavMessage({ type: 'success', text: `CalDAV sync finished. Synced ${synced} event${synced === 1 ? '' : 's'} and marked ${deleted} missing event${deleted === 1 ? '' : 's'} as cancelled.` });
            setCalDavPassword('');
            await fetchIntegrationStatus();
        } catch (error: any) {
            setCalDavMessage({
                type: 'error',
                text: error?.response?.data?.message || 'Failed to sync CalDAV calendar.',
            });
        } finally {
            setCalDavSyncing(false);
        }
    };

    const disconnectCalDav = async () => {
        setCalDavDisconnecting(true);
        setCalDavMessage(null);
        try {
            await api.delete('/integrations/caldav');
            setCalDavStatus({
                connected: false,
                url: null,
                username: null,
                calendarName: null,
                lastCheckedAt: null,
                lastError: null,
            });
            setCalDavUrl('');
            setCalDavUsername('');
            setCalDavPassword('');
            setCalDavMessage({ type: 'success', text: 'CalDAV connection removed.' });
        } catch (error: any) {
            setCalDavMessage({
                type: 'error',
                text: error?.response?.data?.message || 'Failed to disconnect CalDAV.',
            });
        } finally {
            setCalDavDisconnecting(false);
        }
    };
    const savePartial = (updates: Partial<OrganizationSettingsSnapshot>) => {
        const next = { ...orgData, ...updates };
        setOrgData(next);
        window.dispatchEvent(new CustomEvent(ORGANIZATION_UPDATED_EVENT, { detail: next }));
    };
    const handleLogoFile = (file?: File | null) => {
        if (!file || !file.type.startsWith('image/')) return;
        setPendingLogoFile(file);
    };
    const handleInviteUser = async ({ email, role }: { email: string; role: InviteRole }) => {
        const normalizedEmail = email.trim().toLowerCase();
        const payload = { email: normalizedEmail, role: role.toUpperCase() };
        try {
            await api.post('/users/invite', payload);
            setInviteFeedback('User invited successfully.');
            if (canInviteUsers) {
                await fetchPendingInvites();
                setUsersSubTab('pending');
            }
            await fetchUsers();
        } catch (err: any) {
            console.error('Failed to invite user:', err);
            const message = err?.response?.data?.message || err?.response?.data?.error || 'Failed to invite user';
            throw new Error(message);
        }
    };

    const handleRevokeInvite = async (invite: PendingInviteRecord) => {
        if (!canInviteUsers) return;

        try {
            setRevokingInviteId(invite.id);
            await api.delete(`/invites/${invite.id}`);
            setPendingInvites(prev => prev.filter(item => item.id !== invite.id));
            setRevokeInviteConfirm(null);
        } catch (err) {
            console.error('Failed to revoke invite:', err);
        } finally {
            setRevokingInviteId(null);
        }
    };

    const inputCls = 'w-full px-3 py-2 border border-(--color-input-border) rounded-lg text-sm focus:ring-2 focus:ring-(--color-primary)/20 focus:outline-none bg-white transition-colors';
    const labelCls = 'block text-sm font-medium text-(--color-text-primary) mb-1.5';
    const auditEntities = useMemo(() => [...new Set(auditLogs.map(log => log.entityType))], [auditLogs]);

    const auditEntityOptions = useMemo(
        () => auditEntities.map((entity) => ({ value: entity, label: humanizeAuditEntity(entity) })),
        [auditEntities]
    );

    const auditSearchIndex = useMemo(() => {
        return auditLogs.map((log) => {
            const user = resolveAuditUserDisplay(log.userId);
            const actionLabel = humanizeAuditAction(log.action);
            const entityLabel = humanizeAuditEntity(log.entityType);
            const summary = auditSummaryText(log);
            return {
                log,
                actionLabel,
                entityLabel,
                userLabel: user.label,
                userInitial: user.initial,
                summary,
            };
        });
    }, [auditLogs, auditUserMap]);

    const filteredAuditLogs = useMemo(() => {
        return auditSearchIndex.filter(({ log, actionLabel, entityLabel, userLabel, summary }) => {
            const term = auditSearch.trim().toLowerCase();
            const matchesSearch = !term
                || actionLabel.toLowerCase().includes(term)
                || entityLabel.toLowerCase().includes(term)
                || userLabel.toLowerCase().includes(term)
                || summary.toLowerCase().includes(term);
            const matchesEntity = auditEntityFilter === 'all' || log.entityType === auditEntityFilter;
            return matchesSearch && matchesEntity;
        });
    }, [auditSearchIndex, auditSearch, auditEntityFilter]);

    const loadMailboxAccessEntries = async (mailboxId: string) => {
        const response = await api.get(`/mailboxes/${mailboxId}/access`);
        const records = Array.isArray(response.data) ? response.data : [];
        setMailboxAccessEntries(records.map((record: any) => ({
            accessId: record.id,
            key: `${record.user ? 'user' : 'team'}:${record.user?.id || record.team?.id}`,
            assigneeType: record.user ? 'user' : 'team',
            assigneeId: record.user?.id || record.team?.id,
            assigneeName: record.user?.fullName || record.team?.name,
            canRead: Boolean(record.canRead),
            canSend: Boolean(record.canSend),
            canManage: Boolean(record.canManage),
            canSetImapFlags: Boolean(record.canSetImapFlags),
        })));
    };

    const syncMailboxAccessEntries = async (mailboxId: string) => {
        const existingResponse = await api.get(`/mailboxes/${mailboxId}/access`);
        const existingRecords = Array.isArray(existingResponse.data) ? existingResponse.data : [];
        const existingByKey = new Map(existingRecords.map((record: any) => [`${record.user ? 'user' : 'team'}:${record.user?.id || record.team?.id}`, record]));
        const nextKeys = new Set(mailboxAccessEntries.map((entry) => entry.key));

        await Promise.all(mailboxAccessEntries.map((entry) => api.post(`/mailboxes/${mailboxId}/access`, {
            ...(entry.assigneeType === 'user' ? { userId: entry.assigneeId } : { teamId: entry.assigneeId }),
            canRead: entry.canRead,
            canSend: entry.canSend,
            canManage: entry.canManage,
            canSetImapFlags: entry.canSetImapFlags,
        })));

        const deletions = existingRecords
            .filter((record: any) => !nextKeys.has(`${record.user ? 'user' : 'team'}:${record.user?.id || record.team?.id}`))
            .map((record: any) => api.delete(`/mailboxes/${mailboxId}/access/${record.id}`));

        if (deletions.length > 0) {
            await Promise.all(deletions);
        }
    };

    // Mailbox handlers
    const handleSaveMailbox = async () => {
        setMailboxFormSaving(true);
        setMailboxFormError(null);
        const parseOptionalPort = (value: string) => {
            const trimmed = String(value || '').trim();
            if (!trimmed) return undefined;
            const parsed = Number.parseInt(trimmed, 10);
            return Number.isFinite(parsed) ? parsed : undefined;
        };
        const payload = {
            name: mailboxFormData.name,
            email: mailboxFormData.email,
            provider: mailboxFormData.provider,
            smtpHost: mailboxFormData.smtpHost,
            smtpPort: parseOptionalPort(mailboxFormData.smtpPort),
            smtpSecure: mailboxFormData.smtpSecure,
            smtpUser: mailboxFormData.smtpUser,
            smtpPass: mailboxFormData.smtpPass || undefined,
            imapHost: mailboxFormData.imapHost,
            imapPort: parseOptionalPort(mailboxFormData.imapPort),
            imapSecure: mailboxFormData.imapSecure,
            imapUser: mailboxFormData.imapUser,
            imapPass: mailboxFormData.imapPass || undefined,
            readStateMode: mailboxFormData.readStateMode,
        };
        try {
            if (editingMailbox) {
                const res = await api.patch(`/mailboxes/${editingMailbox.id}`, payload);
                await syncMailboxAccessEntries(editingMailbox.id);
                const updatedMailbox = { ...normalizeMailbox(res.data), mailboxAccess: mailboxAccessEntries };
                setMailboxes(prev => prev.map(m => m.id === editingMailbox.id ? updatedMailbox : m));
                await api.post(`/mailboxes/${editingMailbox.id}/sync`).catch(() => null);
                setMailboxes(prev => prev.map(m => m.id === editingMailbox.id ? { ...m, syncStatus: 'pending' } : m));
                setSyncToastMessage(`Sync queued for ${updatedMailbox.name}`);
            } else {
                const res = await api.post('/mailboxes', payload);
                await syncMailboxAccessEntries((res.data as Mailbox).id);
                const createdMailbox = { ...normalizeMailbox(res.data), mailboxAccess: mailboxAccessEntries };
                setMailboxes(prev => [...prev, createdMailbox]);
                await api.post(`/mailboxes/${createdMailbox.id}/sync`).catch(() => null);
                setMailboxes(prev => prev.map(m => m.id === createdMailbox.id ? { ...m, syncStatus: 'pending' } : m));
                setSyncToastMessage(`Sync queued for ${createdMailbox.name}`);
            }
            setShowMailboxForm(false);
            setEditingMailbox(null);
            resetMailboxForm();
            setTestConnResult(null);
            setTimeout(() => setSyncToastMessage(null), 3500);
        } catch (err: any) {
            const rawMessage = err?.response?.data?.message;
            const message = Array.isArray(rawMessage)
                ? rawMessage.join(', ')
                : rawMessage || 'Failed to save mailbox. Please check your details.';
            setMailboxFormError(message);
        } finally {
            setMailboxFormSaving(false);
        }
    };

    const handleEditMailbox = async (mailbox: Mailbox) => {
        setEditingMailbox(mailbox);
        setMailboxFormError(null);
        setTestConnResult(null);
        setMailboxFormData({
            name: mailbox.name,
            email: mailbox.email || '',
            provider: mailbox.provider,
            smtpHost: mailbox.smtpHost || '',
            smtpPort: mailbox.smtpPort?.toString() || '465',
            smtpSecure: mailbox.smtpSecure ?? true,
            smtpUser: mailbox.smtpUser || '',
            smtpPass: '',
            imapHost: mailbox.imapHost || '',
            imapPort: mailbox.imapPort?.toString() || '993',
            imapSecure: mailbox.imapSecure ?? true,
            imapUser: mailbox.imapUser || '',
            imapPass: '',
            readStateMode: (mailbox as any).readStateMode || 'shared' as 'personal' | 'shared' | 'hybrid',
        });
        await loadMailboxAccessEntries(mailbox.id);
        setAccessAssigneeType('user');
        setAccessAssigneeId('');
        setShowMailboxForm(true);
    };

    const handleDeleteMailbox = (mailbox: Mailbox) => {
        setDeletingMailbox(mailbox);
        setShowDeleteMailboxModal(true);
    };

    const confirmDeleteMailbox = async () => {
        if (!deletingMailbox) return;
        const mailboxToDelete = deletingMailbox;
        const previousMailboxes = mailboxes;
        setDeletingMailboxPending(true);
        try {
            setMailboxes(prev => prev.filter(m => m.id !== mailboxToDelete.id));
            setShowDeleteMailboxModal(false);
            setDeletingMailbox(null);
            window.dispatchEvent(new CustomEvent('sermuno:mailbox-deleted', {
                detail: { mailboxId: mailboxToDelete.id },
            }));
            await api.delete(`/mailboxes/${mailboxToDelete.id}`);
        } catch (err) {
            console.error('Failed to delete mailbox:', err);
            setMailboxes(previousMailboxes);
            window.dispatchEvent(new CustomEvent('sermuno:mailbox-delete-rollback', {
                detail: { mailboxId: mailboxToDelete.id },
            }));
        } finally {
            setDeletingMailboxPending(false);
        }
    };

    const resetMailboxForm = () => {
        setMailboxFormData({
            name: '', email: '', provider: 'SMTP',
            smtpHost: '', smtpPort: '465', smtpSecure: true, smtpUser: '', smtpPass: '',
            imapHost: '', imapPort: '993', imapSecure: true, imapUser: '', imapPass: '',
            readStateMode: 'shared',
        });
        setMailboxAccessEntries([]);
        setAccessAssigneeType('user');
        setAccessAssigneeId('');
        setMailboxFormError(null);
        setTestConnResult(null);
        setShowSmtpPassword(false);
        setShowImapPassword(false);
    };

    const activeAssignableUsers = useMemo(
        () => localUsers.filter(u => u.isActive !== false),
        [localUsers]
    );
    const pendingInviteIds = useMemo(
        () => new Set(pendingInvites.map(invite => invite.id)),
        [pendingInvites]
    );
    const userRows = useMemo(
        () => (canInviteUsers ? localUsers.filter(user => !pendingInviteIds.has(user.id)) : localUsers),
        [canInviteUsers, localUsers, pendingInviteIds]
    );
    const activeUsersSubTab = canInviteUsers ? usersSubTab : 'users';
    const activeAssignableTeams = useMemo(
        () => localTeams.filter(team => team.status !== 'deleted'),
        [localTeams]
    );
    const selectableAssignees = useMemo(() => {
        const taken = new Set(
            mailboxAccessEntries
                .filter(entry => entry.assigneeType === accessAssigneeType)
                .map(entry => entry.assigneeId)
        );
        if (accessAssigneeType === 'user') {
            return activeAssignableUsers
                .filter(user => !taken.has(user.id))
                .map(user => ({ id: user.id, name: user.fullName }));
        }
        return activeAssignableTeams
            .filter(team => !taken.has(team.id))
            .map(team => ({ id: team.id, name: team.name }));
    }, [accessAssigneeType, activeAssignableUsers, activeAssignableTeams, mailboxAccessEntries]);

    useEffect(() => {
        if (accessAssigneeId && !selectableAssignees.some(option => option.id === accessAssigneeId)) {
            setAccessAssigneeId('');
        }
    }, [accessAssigneeId, selectableAssignees]);

    const addMailboxAccessEntry = () => {
        if (!accessAssigneeId) return;
        const selected = selectableAssignees.find(option => option.id === accessAssigneeId);
        if (!selected) return;
        setMailboxAccessEntries(prev => ([
            ...prev,
            {
                key: `${accessAssigneeType}:${selected.id}`,
                assigneeType: accessAssigneeType,
                assigneeId: selected.id,
                assigneeName: selected.name,
                canRead: true,
                canSend: false,
                canManage: false,
                canSetImapFlags: false,
            },
        ]));
        setAccessAssigneeId('');
    };

    const removeMailboxAccessEntry = (entryKey: string) => {
        setMailboxAccessEntries(prev => prev.filter(entry => entry.key !== entryKey));
    };

    const toggleMailboxAccessPermission = (
        entryKey: string,
        permission: MailboxAccessPermissionKey,
        checked: boolean
    ) => {
        setMailboxAccessEntries(prev =>
            prev.map(entry =>
                entry.key === entryKey
                    ? { ...entry, [permission]: checked }
                    : entry
            )
        );
    };

    const handleTestConnection = async (type: 'smtp' | 'imap') => {
        setTestConnLoading(type);
        setTestConnResult(null);
        const isSmtp = type === 'smtp';
        const parsePort = (value: string, fallback: number) => {
            const parsed = Number.parseInt(String(value || ''), 10);
            return Number.isFinite(parsed) ? parsed : fallback;
        };
        const payload = {
            provider: String(mailboxFormData.provider || 'SMTP').toUpperCase(),
            ...(isSmtp
                ? {
                    smtpHost: mailboxFormData.smtpHost,
                    smtpPort: parsePort(mailboxFormData.smtpPort, mailboxFormData.smtpSecure ? 465 : 587),
                    smtpSecure: mailboxFormData.smtpSecure,
                    smtpUser: mailboxFormData.smtpUser,
                    smtpPass: mailboxFormData.smtpPass,
                }
                : {
                    imapHost: mailboxFormData.imapHost,
                    imapPort: parsePort(mailboxFormData.imapPort, mailboxFormData.imapSecure ? 993 : 143),
                    imapSecure: mailboxFormData.imapSecure,
                    imapUser: mailboxFormData.imapUser,
                    imapPass: mailboxFormData.imapPass,
                }),
        };
        try {
            const res = await api.post('/mailboxes/test-connection', payload);
            setTestConnResult({ type, ok: true, message: res.data.message || 'Connection successful' });
        } catch (err: any) {
            const rawMessage = err?.response?.data?.message;
            const msg = Array.isArray(rawMessage)
                ? rawMessage.join(', ')
                : rawMessage || 'Connection failed';
            setTestConnResult({ type, ok: false, message: msg });
        } finally {
            setTestConnLoading(null);
        }
    };

    const handleSyncNow = async (mailbox: Mailbox) => {
        setSyncingMailboxIds(prev => new Set(prev).add(mailbox.id));
        setSyncToastMessage(null);
        try {
            await api.post(`/mailboxes/${mailbox.id}/sync`);
            setMailboxes(prev => prev.map(m =>
                m.id === mailbox.id ? { ...m, syncStatus: 'pending' } : m
            ));
            setSyncToastMessage(`Sync queued for ${mailbox.name}`);
            setTimeout(() => setSyncToastMessage(null), 3500);

            const baselineLastSyncAt = mailbox.lastSyncAt ?? null;
            for (let attempt = 0; attempt < 15; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
                const refreshedMailboxes = await fetchMailboxes(false);
                const refreshedMailbox = refreshedMailboxes.find((item) => item.id === mailbox.id);

                if (!refreshedMailbox) {
                    break;
                }

                if (refreshedMailbox.syncStatus === 'error') {
                    break;
                }

                if (refreshedMailbox.syncStatus === 'idle') {
                    break;
                }

                if (
                    refreshedMailbox.syncStatus !== 'pending'
                    && refreshedMailbox.lastSyncAt
                    && refreshedMailbox.lastSyncAt !== baselineLastSyncAt
                ) {
                    break;
                }
            }
        } catch (err) {
            console.error('Sync failed:', err);
            setSyncToastMessage(`Sync failed for ${mailbox.name}`);
            setTimeout(() => setSyncToastMessage(null), 3500);
        } finally {
            setSyncingMailboxIds(prev => { const s = new Set(prev); s.delete(mailbox.id); return s; });
        }
    };

    const tabs = [
        { id: 'organization', label: t('general', 'General'), icon: Settings },
        { id: 'mailboxes', label: t('mailboxes', 'Mailboxes'), icon: Mail },
        { id: 'users', label: t('users', 'Users & Invites'), icon: Users },
        { id: 'teams', label: t('teams', 'Teams'), icon: UsersRound },
        { id: 'tags', label: t('sidebar_tags', 'Tags'), icon: Tag },
        { id: 'roles', label: t('roles', 'Roles & Permissions'), icon: ShieldQuestion },
        { id: 'integrations', label: t('integrations', 'Integrations'), icon: Plug },
        { id: 'billing', label: t('billing', 'Billing & Subscription'), icon: CreditCard },
        { id: 'notifications', label: t('notifications', 'Notifications'), icon: Bell },
        { id: 'audit', label: t('audit', 'Audit & Security'), icon: ScrollText },
    ].filter(tab => canAccess(currentRole, SETTINGS_TAB_ACCESS[tab.id as keyof typeof SETTINGS_TAB_ACCESS]));

    useEffect(() => {
        const tab = new URLSearchParams(location.search).get('tab');
        if (allowedSettingsTabIds.includes(tab as (typeof SETTINGS_TAB_IDS)[number])) {
            setActiveTab(tab as (typeof SETTINGS_TAB_IDS)[number]);
        } else if (!allowedSettingsTabIds.includes(activeTab as (typeof SETTINGS_TAB_IDS)[number]) && allowedSettingsTabIds.length > 0) {
            setActiveTab(allowedSettingsTabIds[0]);
        }
    }, [activeTab, allowedSettingsTabIds, location.search]);

    const handleTabChange = (tabId: string) => {
        if (tabId === activeTab) return;
        setActiveTab(tabId as (typeof SETTINGS_TAB_IDS)[number]);
        const next = new URLSearchParams(location.search);
        next.set('tab', tabId);
        window.history.replaceState({}, '', `${location.pathname}?${next.toString()}`);
    };

    useEffect(() => {
        if (activeTab === 'audit') {
            fetchAuditLogs();
        } else if (activeTab === 'notifications') {
            fetchOrganizationNotificationSettings();
        }
    }, [activeTab]);

    useEffect(() => {
        if (!socket || !isConnected) return;

        const handleMailboxSynced = (payload: any) => {
            const mailboxId = String(payload?.mailboxId || '');
            if (!mailboxId) return;

            setSyncingMailboxIds((prev) => {
                if (!prev.has(mailboxId)) return prev;
                const next = new Set(prev);
                next.delete(mailboxId);
                return next;
            });

            setMailboxes((prev) => prev.map((mailbox) => {
                if (String(mailbox.id) !== mailboxId) return mailbox;
                return {
                    ...mailbox,
                    syncStatus: normalizeMailboxSyncStatus(payload?.syncStatus),
                    lastSyncAt: payload?.lastSyncAt || mailbox.lastSyncAt || null,
                };
            }));

            fetchMailboxes(false).catch(() => {});
        };

        socket.on('mailbox:synced', handleMailboxSynced);
        return () => {
            socket.off('mailbox:synced', handleMailboxSynced);
        };
    }, [socket, isConnected]);

    const organizationFieldRows = useAdaptiveRows({
        rowHeight: 72,
        minRows: 4,
        maxRows: 8,
        viewportOffset: 300,
    });
    const orgNotificationSkeletonRows = useAdaptiveRows({
        rowHeight: 72,
        minRows: 4,
        maxRows: 10,
        viewportOffset: 340,
    });

    const organizationSkeleton = (
        <div className="space-y-6 animate-pulse">
            <div className="rounded-2xl border border-(--color-card-border) bg-white p-5 space-y-5">
                <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-(--color-background)" />
                    <div className="h-5 w-24 rounded bg-(--color-background)" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
                    <div className="space-y-4">
                        <div className="rounded-2xl border border-(--color-card-border) bg-(--color-background)/35 p-4">
                            <div className="mb-3 h-4 w-36 rounded bg-white/80" />
                            <div className="w-full rounded-2xl border-2 border-dashed border-(--color-card-border) bg-white p-4">
                                <div className="flex flex-wrap items-start gap-4">
                                    <div className="h-20 w-20 rounded-2xl border border-(--color-card-border) bg-(--color-background)" />
                                    <div className="min-w-0 flex-1 space-y-3 pt-1">
                                        <div className="h-8 w-36 rounded-lg bg-(--color-background)" />
                                        <div className="h-4 w-52 rounded bg-(--color-background)" />
                                        <div className="h-4 w-40 rounded bg-(--color-background)" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Array.from({ length: organizationFieldRows }, (_, index) => (
                                <div key={index} className="space-y-2">
                                    <div className="h-4 w-28 rounded bg-(--color-background)" />
                                    <div className="h-11 w-full rounded-lg bg-(--color-background)" />
                                </div>
                            ))}
                        </div>
                        <div className="space-y-2">
                            <div className="h-4 w-24 rounded bg-(--color-background)" />
                            <div className="h-28 w-full rounded-lg bg-(--color-background)" />
                            <div className="h-3 w-64 rounded bg-(--color-background)" />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex justify-end">
                <div className="h-11 w-44 rounded-xl bg-(--color-background)" />
            </div>
        </div>
    );

    return (
        <div className="w-full max-w-(--width-desktop) mx-auto space-y-5">
            {/* ── Mobile horizontal tab strip ── */}
            <div className="lg:hidden rounded-2xl border border-(--color-card-border) bg-white shadow-(--shadow-sm)">
                <div className="overflow-x-auto">
                    <div className="flex gap-1 p-2 min-w-max pr-2">
                        {tabs.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => handleTabChange(tab.id)}
                                    className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm shrink-0 transition-colors border whitespace-nowrap ${isActive
                                        ? 'bg-(--color-background) border-(--color-card-border) text-(--color-text-primary) shadow-sm font-medium'
                                        : 'border-transparent text-(--color-text-muted) hover:bg-(--color-background)/70 hover:text-(--color-text-primary)'}`}
                                >
                                    <Icon className="w-4 h-4 shrink-0" />
                                    <span>{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-5">
                {/* ── Desktop vertical sidebar ── */}
                <aside className="hidden lg:block bg-white rounded-2xl border border-(--color-card-border) shadow-(--shadow-sm) p-3 h-fit sticky top-4">
                    <div className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
                        Settings
                    </div>
                    <div className="space-y-1">
                        {tabs.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => handleTabChange(tab.id)}
                                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors border ${isActive
                                        ? 'bg-(--color-background) border-(--color-card-border) text-(--color-text-primary) shadow-sm'
                                        : 'border-transparent text-(--color-text-muted) hover:bg-(--color-background)/70 hover:text-(--color-text-primary)'}`}
                                >
                                    <Icon className="w-4 h-4 shrink-0" />
                                    <span className="truncate">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </aside>

                <div className="bg-white rounded-2xl border border-(--color-card-border) shadow-(--shadow-sm)">
                    <div className="p-4 sm:p-6">
                        {activeTab === 'organization' && (
                            orgLoading ? organizationSkeleton : (
                            <div className="space-y-6 animate-in fade-in">
                                <div className="rounded-2xl border border-(--color-card-border) bg-white p-5 space-y-5">
                                    <div className="flex items-center gap-2">
                                        <Building2 className="w-4 h-4 shrink-0 text-(--color-primary)" />
                                        <h3 className="text-base font-bold text-(--color-text-primary)">General</h3>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
                                        <div className="space-y-4">
                                            <div className="rounded-2xl border border-(--color-card-border) bg-(--color-background)/35 p-4">
                                                <div className="flex items-center justify-between mb-3">
                                                    <h4 className="text-sm font-bold text-(--color-text-primary)">Organization Image</h4>
                                                    {orgData.logoUrl && !isOrgReadOnly && (
                                                        <button
                                                            type="button"
                                                            onClick={() => savePartial({ logoUrl: undefined })}
                                                            className="text-xs font-medium text-red-600 hover:underline"
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (!isOrgReadOnly) logoInputRef.current?.click();
                                                    }}
                                                    onDragOver={(e) => {
                                                        if (isOrgReadOnly) return;
                                                        e.preventDefault();
                                                        setIsDragOverLogo(true);
                                                    }}
                                                    onDragLeave={() => {
                                                        if (!isOrgReadOnly) setIsDragOverLogo(false);
                                                    }}
                                                    onDrop={(e) => {
                                                        if (isOrgReadOnly) return;
                                                        e.preventDefault();
                                                        setIsDragOverLogo(false);
                                                        handleLogoFile(e.dataTransfer.files?.[0]);
                                                    }}
                                                    className={`w-full rounded-2xl border-2 border-dashed p-4 transition-colors text-left ${isDragOverLogo
                                                        ? 'border-(--color-primary) bg-(--color-background)'
                                                        : 'border-(--color-card-border) bg-white hover:bg-(--color-background)/35'}`}
                                                    disabled={isOrgReadOnly}
                                                >
                                                    <div className="flex flex-wrap items-start gap-4">
                                                        <div className="h-20 w-20 rounded-2xl border border-(--color-card-border) bg-white overflow-hidden shadow-sm shrink-0 flex items-center justify-center">
                                                            {orgData.logoUrl ? (
                                                                <img src={resolveOrganizationLogoUrl(orgData.logoUrl)} alt={orgData.name} className="h-full w-full object-cover" />
                                                            ) : (
                                                                <div className="h-full w-full flex items-center justify-center bg-(--color-accent)/25 text-2xl font-bold text-(--color-primary)">
                                                                    {(orgData.name?.charAt(0) || 'S').toUpperCase()}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="min-w-0">
                                                            {!isOrgReadOnly && (
                                                                <div className="inline-flex items-center gap-2 rounded-lg border border-(--color-card-border) bg-white px-3 py-1.5 text-xs font-medium text-(--color-text-primary) shadow-sm mb-2">
                                                                    <Upload className="w-3.5 h-3.5 shrink-0" />
                                                                    Upload / Edit Image
                                                                </div>
                                                            )}
                                                            <p className="text-sm font-medium text-(--color-text-primary)">{isOrgReadOnly ? 'Organization image' : 'Drag and drop your organization image here'}</p>
                                                        </div>
                                                    </div>
                                                </button>
                                                {!isOrgReadOnly && (
                                                    <input
                                                        ref={logoInputRef}
                                                        type="file"
                                                        accept="image/*"
                                                        className="hidden"
                                                        onChange={(e) => handleLogoFile(e.target.files?.[0])}
                                                    />
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div>
                                                    <label className={labelCls}>Organization Name</label>
                                                    <input type="text" value={orgData.name} onChange={e => updateField('name', e.target.value)} className={inputCls} readOnly={isOrgReadOnly} disabled={isOrgReadOnly} />
                                                </div>
                                                <div>
                                                    <label className={labelCls}>Default Language</label>
                                                    <select value={orgData.defaultLocale} onChange={e => updateField('defaultLocale', e.target.value)} className={inputCls} disabled={isOrgReadOnly}>
                                                        <option value="en">English</option>
                                                        <option value="nl">Dutch</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className={labelCls}>Default Timezone</label>
                                                    <select value={orgData.defaultTimezone} onChange={e => updateField('defaultTimezone', e.target.value)} className={inputCls} disabled={isOrgReadOnly}>
                                                        {COMMON_TIMEZONES.map(tz => (
                                                            <option key={tz} value={tz}>{tz}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                            <div>
                                                    <label className={labelCls}>Email Footer</label>
                                                    <textarea
                                                        value={orgData.emailFooter ?? ''}
                                                        onChange={e => updateField('emailFooter', e.target.value)}
                                                        rows={4}
                                                        className={`${inputCls} min-h-28 resize-y`}
                                                        readOnly={isOrgReadOnly}
                                                        disabled={isOrgReadOnly}
                                                    />
                                                <p className="mt-1 text-xs text-(--color-text-muted)">Appended to outgoing emails from your organization.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {canViewPlanAndLimits && (
                                    <div className="rounded-2xl border border-(--color-card-border) bg-white p-5 space-y-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h4 className="text-sm font-bold text-(--color-text-primary)">Plan & Subscription</h4>
                                                <p className="text-xs text-(--color-text-muted)">Current subscription and workspace limits.</p>
                                            </div>
                                            <StatusBadge
                                                label={String(billingInfo.subscriptionStatus || orgData.subscriptionStatus || 'active').toUpperCase()}
                                                variant="success"
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div className="rounded-xl border border-(--color-card-border) bg-(--color-background)/25 p-3">
                                                <div className="text-[10px] uppercase tracking-wide text-(--color-text-muted)">Current Plan</div>
                                                <div className="mt-1 text-sm font-semibold text-(--color-text-primary)">{formatPlanLabel(orgData.plan)}</div>
                                            </div>
                                            <div className="rounded-xl border border-(--color-card-border) bg-(--color-background)/25 p-3">
                                                <div className="text-[10px] uppercase tracking-wide text-(--color-text-muted)">Subscription</div>
                                                <div className="mt-1 text-sm font-semibold text-(--color-text-primary)">
                                                    {String(billingInfo.subscriptionStatus || orgData.subscriptionStatus || 'active').toUpperCase()}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                            <LimitRow label="Mailboxes" current={Number(orgData._count?.mailboxes || 0)} max={Number(orgData.maxMailboxes || 0)} />
                                            <LimitRow label="Users" current={Number(orgData._count?.users || 0)} max={Number(orgData.maxUsers || 0)} />
                                            <LimitRow label="Storage" current={0} max={Number(orgData.maxStorageGb || 0)} />
                                        </div>
                                    </div>
                                )}

                                {canEditOrganizationSettings ? <SaveButton onClick={handleSave} saved={saved} loading={saving} /> : null}
                            </div>
                            )
                        )}

                        {activeTab === 'mailboxes' && (
                            <div className="space-y-5 animate-in fade-in">
                                {showMailboxForm && canManageMailboxSettings ? (
                                    <>
                                        <div className="border-b border-(--color-card-border) pb-4">
                                            <h3 className="text-lg font-bold text-(--color-text-primary)">Mailboxes</h3>
                                            <p className="text-sm text-(--color-text-muted)">Manage your email mailboxes and configurations.</p>
                                        </div>

                                        <div className="rounded-2xl border border-(--color-card-border) bg-white p-6 space-y-6">
                                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--color-card-border) pb-4">
                                                <h4 className="text-base font-bold text-(--color-text-primary)">{editingMailbox ? 'Edit Mailbox' : 'Add New Mailbox'}</h4>
                                                <button type="button" onClick={() => { setShowMailboxForm(false); setEditingMailbox(null); resetMailboxForm(); }} className="text-(--color-text-muted) hover:text-(--color-text-primary)"><X className="w-5 h-5" /></button>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div><label className="block text-sm font-medium text-(--color-text-primary) mb-1.5">Mailbox Name</label><input type="text" value={mailboxFormData.name} onChange={e => setMailboxFormData({ ...mailboxFormData, name: e.target.value })} placeholder="e.g. Support Team" className={inputCls} /></div>
                                                <div><label className="block text-sm font-medium text-(--color-text-primary) mb-1.5">Email Address</label><input type="email" value={mailboxFormData.email} onChange={e => setMailboxFormData({ ...mailboxFormData, email: e.target.value })} placeholder="support@example.com" className={inputCls} /></div>
                                            </div>

                                            {/* Read State Mode */}
                                            <div className="space-y-2 pt-4 border-t border-(--color-card-border)">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-(--color-primary)" />
                                                    <h5 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wider">Read State Mode</h5>
                                                </div>
                                                <p className="text-xs text-(--color-text-muted) mb-2">Controls how conversations are marked as read across team members.</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {(['personal', 'shared', 'hybrid'] as const).map(mode => (
                                                        <button
                                                            key={mode}
                                                            type="button"
                                                            onClick={() => setMailboxFormData({ ...mailboxFormData, readStateMode: mode })}
                                                            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors capitalize ${mailboxFormData.readStateMode === mode
                                                                ? 'bg-(--color-primary) text-white border-(--color-primary)'
                                                                : 'bg-white text-(--color-text-muted) border-(--color-card-border) hover:border-(--color-primary) hover:text-(--color-primary)'
                                                                }`}
                                                        >
                                                            {mode.charAt(0).toUpperCase() + mode.slice(1)}
                                                        </button>
                                                    ))}
                                                </div>
                                                <p className="text-[11px] text-(--color-text-muted) mt-1">
                                                    {mailboxFormData.readStateMode === 'personal' && 'Each agent tracks read state individually.'}
                                                    {mailboxFormData.readStateMode === 'shared' && 'Marked as read for all team members simultaneously.'}
                                                    {mailboxFormData.readStateMode === 'hybrid' && 'Shared by default; agents can override individually.'}
                                                </p>
                                            </div>

                                            <div className="space-y-3 pt-4 border-t border-(--color-card-border)">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-(--color-primary)" />
                                                    <h5 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wider" style={{ fontFamily: 'var(--font-ui)' }}>Mailbox Access Management</h5>
                                                </div>
                                                <p className="text-xs text-(--color-text-muted)" style={{ fontFamily: 'var(--font-body)' }}>
                                                    Assign users or teams and configure independent mailbox permissions for each assignee.
                                                </p>

                                                <div className="rounded-xl border border-(--color-card-border) bg-(--color-background)/30 p-3 space-y-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => setAccessAssigneeType('user')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${accessAssigneeType === 'user'
                                                                ? 'bg-white text-(--color-primary) border-(--color-primary) shadow-sm'
                                                                : 'bg-white text-(--color-text-muted) border-(--color-card-border) hover:text-(--color-primary) hover:border-(--color-primary)'}`}
                                                            style={{ fontFamily: 'var(--font-ui)' }}
                                                        >
                                                            User
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setAccessAssigneeType('team')}
                                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${accessAssigneeType === 'team'
                                                                ? 'bg-white text-(--color-primary) border-(--color-primary) shadow-sm'
                                                                : 'bg-white text-(--color-text-muted) border-(--color-card-border) hover:text-(--color-primary) hover:border-(--color-primary)'}`}
                                                            style={{ fontFamily: 'var(--font-ui)' }}
                                                        >
                                                            Team
                                                        </button>
                                                    </div>

                                                    <div className="flex flex-col sm:flex-row gap-2">
                                                        <select
                                                            value={accessAssigneeId}
                                                            onChange={(e) => setAccessAssigneeId(e.target.value)}
                                                            className={inputCls}
                                                            style={{ fontFamily: 'var(--font-body)' }}
                                                        >
                                                            <option value="">
                                                                {accessAssigneeType === 'user' ? 'Select a user' : 'Select a team'}
                                                            </option>
                                                            {selectableAssignees.map(option => (
                                                                <option key={option.id} value={option.id}>{option.name}</option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            type="button"
                                                            onClick={addMailboxAccessEntry}
                                                            disabled={!accessAssigneeId}
                                                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-(--color-card-border) bg-white text-(--color-text-primary) hover:border-(--color-primary) hover:text-(--color-primary) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                            style={{ fontFamily: 'var(--font-ui)' }}
                                                        >
                                                            <Plus className="w-4 h-4" />
                                                            Add
                                                        </button>
                                                    </div>
                                                </div>

                                                {mailboxAccessEntries.length === 0 ? (
                                                    <div className="rounded-lg border border-dashed border-(--color-card-border) px-3 py-3 text-xs text-(--color-text-muted)" style={{ fontFamily: 'var(--font-body)' }}>
                                                        No users or teams assigned yet.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-3">
                                                        {mailboxAccessEntries.map(entry => (
                                                            <div key={entry.key} className="rounded-xl border border-(--color-card-border) bg-white p-3 space-y-3">
                                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                                    <div className="flex items-center gap-2">
                                                                        {entry.assigneeType === 'user' ? (
                                                                            <Users className="w-4 h-4 text-(--color-primary)" />
                                                                        ) : (
                                                                            <UsersRound className="w-4 h-4 text-(--color-primary)" />
                                                                        )}
                                                                        <span className="text-sm font-semibold text-(--color-text-primary)" style={{ fontFamily: 'var(--font-ui)' }}>{entry.assigneeName}</span>
                                                                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border border-(--color-card-border) bg-(--color-background) text-(--color-text-muted)">
                                                                            {entry.assigneeType}
                                                                        </span>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => removeMailboxAccessEntry(entry.key)}
                                                                        className="text-xs font-medium text-(--color-text-muted) hover:text-red-600 transition-colors"
                                                                        style={{ fontFamily: 'var(--font-ui)' }}
                                                                    >
                                                                        Remove
                                                                    </button>
                                                                </div>

                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                    {[
                                                                        { key: 'canRead' as const, label: 'Read', description: 'View messages, threads, and folders.' },
                                                                        { key: 'canSend' as const, label: 'Send', description: 'Send emails from this mailbox.' },
                                                                        { key: 'canManage' as const, label: 'Manage', description: 'Manage access and mailbox settings.' },
                                                                        { key: 'canSetImapFlags' as const, label: 'Set IMAP Flags', description: 'Set IMAP \\Seen flag for shared/hybrid read states.' },
                                                                    ].map(permission => (
                                                                        <label key={permission.key} className="flex items-start gap-2 rounded-lg border border-(--color-card-border) bg-(--color-background)/30 px-3 py-2">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={entry[permission.key]}
                                                                                onChange={(e) => toggleMailboxAccessPermission(entry.key, permission.key, e.target.checked)}
                                                                                className="mt-0.5 h-4 w-4 rounded border-(--color-card-border) text-(--color-primary) focus:ring-(--color-primary)"
                                                                            />
                                                                            <span className="min-w-0">
                                                                                <span className="block text-sm font-medium text-(--color-text-primary)" style={{ fontFamily: 'var(--font-ui)' }}>{permission.label}</span>
                                                                                <span className="block text-[11px] text-(--color-text-muted)" style={{ fontFamily: 'var(--font-body)' }}>{permission.description}</span>
                                                                            </span>
                                                                        </label>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="space-y-3 pt-4 border-t border-(--color-card-border)">
                                                <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-(--color-accent)" /><h5 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wider">SMTP Settings (Outgoing)</h5></div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-max">
                                                    <div className="col-span-1 md:col-span-2 lg:col-span-1 flex flex-col"><label className="block text-sm font-medium text-(--color-text-primary) mb-1">SMTP Host</label><input type="text" value={mailboxFormData.smtpHost} onChange={e => setMailboxFormData({ ...mailboxFormData, smtpHost: e.target.value })} placeholder="smtp.gmail.com" className={inputCls} /></div>
                                                    <div className="col-span-1 md:col-span-1 lg:col-span-1 flex flex-col">
                                                        <label className="block text-sm font-medium text-(--color-text-primary) mb-1">Port</label>
                                                        <input type="text" value={mailboxFormData.smtpPort} onChange={e => setMailboxFormData({ ...mailboxFormData, smtpPort: e.target.value })} placeholder={mailboxFormData.smtpSecure ? '465' : '587'} className={inputCls} />
                                                        <span className="text-[10px] text-(--color-text-muted) mt-0.5 block">{mailboxFormData.smtpSecure ? 'SSL: 465' : 'TLS: 587'}</span>
                                                    </div>
                                                    <div className="col-span-1 md:col-span-1 lg:col-span-1 flex flex-col"><label className="block text-sm font-medium text-(--color-text-primary) mb-1">Protocol</label><div className="flex-1 flex flex-col justify-start"><div className="flex rounded-lg border border-(--color-card-border) bg-(--color-background) p-1 gap-1 w-full overflow-hidden"><button type="button" onClick={() => setMailboxFormData({ ...mailboxFormData, smtpSecure: true, smtpPort: '465' })} className={`flex-1 min-w-0 px-2 py-1 rounded-md text-xs font-medium transition-colors truncate ${mailboxFormData.smtpSecure ? 'bg-white text-(--color-primary) shadow-sm border border-(--color-card-border)' : 'text-(--color-text-muted) hover:text-(--color-text-primary)'}`}>SSL</button><button type="button" onClick={() => setMailboxFormData({ ...mailboxFormData, smtpSecure: false, smtpPort: '587' })} className={`flex-1 min-w-0 px-2 py-1 rounded-md text-xs font-medium transition-colors truncate ${!mailboxFormData.smtpSecure ? 'bg-white text-(--color-primary) shadow-sm border border-(--color-card-border)' : 'text-(--color-text-muted) hover:text-(--color-text-primary)'}`}>TLS</button></div></div></div>
                                                    <div className="col-span-1 md:col-span-1 lg:col-span-1 flex flex-col"><label className="block text-sm font-medium text-(--color-text-primary) mb-1">SMTP Username</label><input type="text" value={mailboxFormData.smtpUser} onChange={e => setMailboxFormData({ ...mailboxFormData, smtpUser: e.target.value })} className={inputCls} /></div>
                                                    <div className="col-span-1 md:col-span-1 lg:col-span-1 flex flex-col">
                                                        <label className="block text-sm font-medium text-(--color-text-primary) mb-1">SMTP Password</label>
                                                        <div className="relative">
                                                            <input
                                                                type={showSmtpPassword ? 'text' : 'password'}
                                                                value={mailboxFormData.smtpPass}
                                                                onChange={e => setMailboxFormData({ ...mailboxFormData, smtpPass: e.target.value })}
                                                                className={`${inputCls} pr-10`}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowSmtpPassword((prev) => !prev)}
                                                                className="absolute inset-y-0 right-2 my-auto text-(--color-text-muted) hover:text-(--color-text-primary)"
                                                                aria-label={showSmtpPassword ? 'Hide SMTP password' : 'Show SMTP password'}
                                                            >
                                                                {showSmtpPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* SMTP Test */}
                                                <div className="flex items-center gap-3 pt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleTestConnection('smtp')}
                                                        disabled={testConnLoading !== null || !mailboxFormData.smtpHost || !mailboxFormData.smtpUser}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-(--color-card-border) text-(--color-text-muted) hover:border-(--color-primary) hover:text-(--color-primary) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {testConnLoading === 'smtp' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
                                                        Test SMTP
                                                    </button>
                                                    {testConnResult?.type === 'smtp' && (
                                                        <span className={`text-xs font-medium flex items-center gap-1 ${testConnResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                                                            {testConnResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                                                            {testConnResult.message}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="space-y-3 pt-4 border-t border-(--color-card-border)">
                                                <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-(--color-secondary)" /><h5 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wider">IMAP Settings (Incoming)</h5></div>
                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 auto-rows-max">
                                                    <div className="col-span-1 md:col-span-2 lg:col-span-1 flex flex-col"><label className="block text-sm font-medium text-(--color-text-primary) mb-1">IMAP Host</label><input type="text" value={mailboxFormData.imapHost} onChange={e => setMailboxFormData({ ...mailboxFormData, imapHost: e.target.value })} placeholder="imap.gmail.com" className={inputCls} /></div>
                                                    <div className="col-span-1 md:col-span-1 lg:col-span-1 flex flex-col">
                                                        <label className="block text-sm font-medium text-(--color-text-primary) mb-1">Port</label>
                                                        <input type="text" value={mailboxFormData.imapPort} onChange={e => setMailboxFormData({ ...mailboxFormData, imapPort: e.target.value })} placeholder={mailboxFormData.imapSecure ? '993' : '143'} className={inputCls} />
                                                        <span className="text-[10px] text-(--color-text-muted) mt-0.5 block">{mailboxFormData.imapSecure ? 'SSL: 993' : 'Plain: 143'}</span>
                                                    </div>
                                                    <div className="col-span-1 md:col-span-1 lg:col-span-1 flex flex-col"><label className="block text-sm font-medium text-(--color-text-primary) mb-1">Protocol</label><div className="flex-1 flex flex-col justify-start"><div className="flex rounded-lg border border-(--color-card-border) bg-(--color-background) p-1 gap-1 w-full overflow-hidden"><button type="button" onClick={() => setMailboxFormData({ ...mailboxFormData, imapSecure: true, imapPort: '993' })} className={`flex-1 min-w-0 px-2 py-1 rounded-md text-xs font-medium transition-colors truncate ${mailboxFormData.imapSecure ? 'bg-white text-(--color-primary) shadow-sm border border-(--color-card-border)' : 'text-(--color-text-muted) hover:text-(--color-text-primary)'}`}>SSL</button><button type="button" onClick={() => setMailboxFormData({ ...mailboxFormData, imapSecure: false, imapPort: '143' })} className={`flex-1 min-w-0 px-2 py-1 rounded-md text-xs font-medium transition-colors truncate ${!mailboxFormData.imapSecure ? 'bg-white text-(--color-primary) shadow-sm border border-(--color-card-border)' : 'text-(--color-text-muted) hover:text-(--color-text-primary)'}`}>Plain</button></div></div></div>
                                                    <div className="col-span-1 md:col-span-1 lg:col-span-1 flex flex-col"><label className="block text-sm font-medium text-(--color-text-primary) mb-1">IMAP Username</label><input type="text" value={mailboxFormData.imapUser} onChange={e => setMailboxFormData({ ...mailboxFormData, imapUser: e.target.value })} className={inputCls} /></div>
                                                    <div className="col-span-1 md:col-span-1 lg:col-span-1 flex flex-col">
                                                        <label className="block text-sm font-medium text-(--color-text-primary) mb-1">IMAP Password</label>
                                                        <div className="relative">
                                                            <input
                                                                type={showImapPassword ? 'text' : 'password'}
                                                                value={mailboxFormData.imapPass}
                                                                onChange={e => setMailboxFormData({ ...mailboxFormData, imapPass: e.target.value })}
                                                                className={`${inputCls} pr-10`}
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowImapPassword((prev) => !prev)}
                                                                className="absolute inset-y-0 right-2 my-auto text-(--color-text-muted) hover:text-(--color-text-primary)"
                                                                aria-label={showImapPassword ? 'Hide IMAP password' : 'Show IMAP password'}
                                                            >
                                                                {showImapPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* IMAP Test */}
                                                <div className="flex items-center gap-3 pt-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleTestConnection('imap')}
                                                        disabled={testConnLoading !== null || !mailboxFormData.imapHost || !mailboxFormData.imapUser}
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-(--color-card-border) text-(--color-text-muted) hover:border-(--color-primary) hover:text-(--color-primary) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {testConnLoading === 'imap' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
                                                        Test IMAP
                                                    </button>
                                                    {testConnResult?.type === 'imap' && (
                                                        <span className={`text-xs font-medium flex items-center gap-1 ${testConnResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                                                            {testConnResult.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                                                            {testConnResult.message}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Save error */}
                                            {mailboxFormError && (
                                                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
                                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                                    {mailboxFormError}
                                                </div>
                                            )}

                                            <div className="flex flex-wrap gap-2 justify-end pt-4 border-t border-(--color-card-border)">
                                                <button type="button" onClick={() => { setShowMailboxForm(false); setEditingMailbox(null); resetMailboxForm(); }} className="px-4 py-2 text-sm font-medium text-(--color-text-muted) hover:bg-(--color-background) rounded-lg transition-colors">Cancel</button>
                                                <button
                                                    type="button"
                                                    onClick={handleSaveMailbox}
                                                    disabled={mailboxFormSaving}
                                                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-(--color-cta-primary) text-white rounded-lg hover:bg-(--color-cta-secondary) transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                                                >
                                                    {mailboxFormSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                                                    {mailboxFormSaving ? 'Saving...' : 'Save Mailbox'}
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-card-border) pb-4">
                                            <div>
                                                <h3 className="text-lg font-bold text-(--color-text-primary)">Mailboxes</h3>
                                                <p className="text-sm text-(--color-text-muted)">Manage your email mailboxes and configurations.</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {canManageMailboxSettings && (
                                                    <>
                                                {/* Connect Google */}
                                                <button
                                                    type="button"
                                                    disabled={googleConnecting}
                                                    onClick={async () => {
                                                        setGoogleConnecting(true);
                                                        try {
                                                            const res = await api.get('/auth/google/url');
                                                            window.location.href = res.data.url;
                                                        } catch (err) {
                                                            console.error('Failed to get Google auth URL', err);
                                                            setGoogleConnecting(false);
                                                        }
                                                    }}
                                                    className="inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-(--color-card-border) bg-white text-(--color-text-primary) hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                >
                                                    {googleConnecting
                                                        ? <Loader2 className="w-4 h-4 animate-spin" />
                                                        : <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                                                    }
                                                    <span className="hidden sm:inline">Connect Google</span>
                                                    <span className="sm:hidden">Google</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={microsoftConnecting}
                                                    onClick={async () => {
                                                        setMicrosoftConnecting(true);
                                                        try {
                                                            const res = await api.get('/auth/microsoft/url');
                                                            window.location.href = res.data.url;
                                                        } catch (err) {
                                                            console.error('Failed to get Microsoft auth URL', err);
                                                            setMicrosoftConnecting(false);
                                                        }
                                                    }}
                                                    className="inline-flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-(--color-card-border) bg-white text-(--color-text-primary) hover:border-sky-400 hover:text-sky-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                                                >
                                                    {microsoftConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MicrosoftLogo className="w-4 h-4" />}
                                                    <span className="hidden sm:inline">Connect Microsoft</span>
                                                    <span className="sm:hidden">Microsoft</span>
                                                </button>
                                                {/* Add SMTP/IMAP Mailbox */}
                                                <button
                                                    type="button"
                                                    onClick={() => { setShowMailboxForm(true); setEditingMailbox(null); resetMailboxForm(); }}
                                                    className="flex shrink-0 items-center gap-2 px-4 py-2 bg-(--color-cta-primary) text-white rounded-lg text-sm font-medium hover:bg-(--color-cta-secondary) transition-colors"
                                                >
                                                    <Plus className="w-4 h-4" />
                                                    <span className="hidden sm:inline">Add Mailbox</span>
                                                    <span className="sm:hidden">Add</span>
                                                </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {oauthBanner?.state === 'success' && (
                                            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
                                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                                <span>
                                                    <strong>{oauthBanner.provider === 'microsoft' ? 'Microsoft mailbox connected!' : 'Google mailbox connected!'}</strong>{' '}
                                                    {oauthBanner.provider === 'microsoft'
                                                        ? 'Your Microsoft account has been linked and an initial sync has been queued.'
                                                        : 'Your Gmail account has been linked and an initial sync has been queued.'}
                                                </span>
                                                <button onClick={() => setOauthBanner(null)} className="ml-auto text-emerald-500 hover:text-emerald-700"><X className="w-4 h-4" /></button>
                                            </div>
                                        )}
                                        {oauthBanner?.state === 'error' && (
                                            <div className="flex items-center gap-2.5 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                                                <AlertCircle className="w-4 h-4 shrink-0" />
                                                <span>
                                                    <strong>{oauthBanner.provider === 'microsoft' ? 'Microsoft connection failed.' : 'Google connection failed.'}</strong>{' '}
                                                    {oauthBanner.provider === 'microsoft'
                                                        ? 'Please try again or check your Azure app permissions.'
                                                        : 'Please try again or check your Google Cloud credentials.'}
                                                </span>
                                                <button onClick={() => setOauthBanner(null)} className="ml-auto text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                                            </div>
                                        )}

                                        {mailboxesLoading ? (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                                {[1, 2, 3].map(i => (
                                                    <div key={i} className="bg-white rounded-xl border border-(--color-card-border) p-5 animate-pulse">
                                                        <div className="flex justify-between items-start mb-3">
                                                            <div className="w-10 h-10 rounded-lg bg-(--color-background)" />
                                                        </div>
                                                        <div className="h-4 bg-(--color-background) rounded w-3/4 mb-2" />
                                                        <div className="h-3 bg-(--color-background) rounded w-1/2 mb-4" />
                                                        <div className="flex gap-2">
                                                            <div className="h-5 bg-(--color-background) rounded-full w-14" />
                                                            <div className="h-5 bg-(--color-background) rounded-full w-10" />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : mailboxes.length === 0 ? (
                                            <div className="rounded-2xl border-2 border-dashed border-(--color-card-border) p-12 text-center">
                                                <div className="bg-(--color-background) w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Inbox className="w-8 h-8 text-(--color-accent)" /></div>
                                                <h4 className="text-lg font-bold text-(--color-text-primary) mb-1">No Mailboxes</h4>
                                                <p className="text-sm text-(--color-text-muted)">Create your first mailbox to start receiving emails.</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                                                {mailboxes.map((mb) => {
                                                    const isSyncing = syncingMailboxIds.has(mb.id);
                                                    const syncStatus = isSyncing ? 'syncing' : (mb.syncStatus as string);
                                                    const healthStatus = mb.status as string;
                                                    const syncErrorCount = (mb as any).syncErrorCount ?? 0;
                                                    const syncError = (mb as any).syncError as string | null;
                                                    const lastSyncAt = (mb as any).lastSyncAt as string | null;
                                                    const nextRetryAt = (mb as any).nextRetryAt as string | null;
                                                    const sharedMailbox = (mb as any).sharedMailbox as boolean;
                                                    const readStateMode = ((mb as any).readStateMode as string) || 'shared';

                                                    const healthDotColor =
                                                        healthStatus === 'healthy' ? 'bg-emerald-500' :
                                                            healthStatus === 'degraded' ? 'bg-amber-500' :
                                                                healthStatus === 'failed' ? 'bg-red-500' :
                                                                    'bg-gray-400';

                                                    const syncBadgeVariant =
                                                        syncStatus === 'error' ? 'error' :
                                                            syncStatus === 'syncing' ? 'info' :
                                                                syncStatus === 'pending' ? 'warning' :
                                                                    'neutral';
                                                    const syncBadgeLabel = syncStatus === 'syncing' ? 'Syncing…' :
                                                        syncStatus === 'error' ? 'Sync Error' :
                                                            syncStatus === 'pending' ? 'Pending' : 'Idle';

                                                    const readModeLabel =
                                                        readStateMode === 'personal' ? 'Personal' :
                                                            readStateMode === 'hybrid' ? 'Hybrid' : 'Shared';

                                                    function timeAgo(iso: string | null) {
                                                        if (!iso) return null;
                                                        const diffMs = Date.now() - new Date(iso).getTime();
                                                        const mins = Math.floor(diffMs / 60000);
                                                        if (mins < 1) return 'just now';
                                                        if (mins < 60) return `${mins}m ago`;
                                                        const hrs = Math.floor(mins / 60);
                                                        if (hrs < 24) return `${hrs}h ago`;
                                                        return `${Math.floor(hrs / 24)}d ago`;
                                                    }

                                                    return (
                                                        <div key={mb.id} className="bg-white rounded-xl border border-(--color-card-border) shadow-(--shadow-sm) hover:shadow-(--shadow-md) transition-shadow p-5 group flex flex-col gap-3">
                                                            {/* Top row: icon, health dot, actions */}
                                                            <div className="flex justify-between items-start">
                                                                <div className="flex items-center gap-2.5">
                                                                    <div className="relative p-2.5 bg-(--color-background) rounded-lg text-(--color-primary) group-hover:bg-(--color-primary) group-hover:text-white transition-colors">
                                                                        <Mail className="w-5 h-5" />
                                                                        {/* Health dot */}
                                                                        <span
                                                                            title={`Health: ${healthStatus}`}
                                                                            className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${healthDotColor}`}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                {canManageMailboxSettings && (
                                                                    <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                        <button onClick={() => handleEditMailbox(mb)} title="Edit mailbox" className="p-1.5 text-(--color-text-muted) hover:text-(--color-primary) hover:bg-(--color-background) rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                                                                        <button onClick={() => handleDeleteMailbox(mb)} title="Remove mailbox" className="p-1.5 text-(--color-text-muted) hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Name + email */}
                                                            <div>
                                                                <h5 className="text-base font-bold text-(--color-text-primary) group-hover:text-(--color-primary) transition-colors leading-tight">{mb.name}</h5>
                                                                <p className="text-[13px] text-(--color-text-muted) mt-0.5 truncate">{mb.email || mb.imapHost || 'No address configured'}</p>
                                                            </div>

                                                            {/* Badges row */}
                                                            <div className="flex flex-wrap gap-1.5">
                                                                <span className="px-2 py-0.5 bg-(--color-background) text-(--color-text-muted) rounded-full text-[10px] font-semibold uppercase tracking-wider">{mb.provider}</span>
                                                                <StatusBadge label={syncBadgeLabel} variant={syncBadgeVariant} dot />
                                                                {sharedMailbox && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-[10px] font-semibold">
                                                                        <UsersRound className="w-2.5 h-2.5" />
                                                                        Shared
                                                                    </span>
                                                                )}
                                                                {mb.teamCount > 0 && (
                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-(--color-background) text-(--color-text-muted) border border-(--color-card-border) rounded-full text-[10px] font-semibold">
                                                                        <UsersRound className="w-2.5 h-2.5" />
                                                                        {mb.teamCount} team{mb.teamCount !== 1 ? 's' : ''}
                                                                    </span>
                                                                )}
                                                                <span className="px-2 py-0.5 bg-(--color-background) text-(--color-text-muted) border border-(--color-card-border) rounded-full text-[10px] font-semibold capitalize">{readModeLabel}</span>
                                                            </div>

                                                            {/* Sync metadata */}
                                                            {(lastSyncAt || syncErrorCount > 0 || nextRetryAt) && (
                                                                <div className="flex flex-col gap-1 text-[11px] text-(--color-text-muted)">
                                                                    {lastSyncAt && (
                                                                        <span className="flex items-center gap-1">
                                                                            <Clock className="w-3 h-3 shrink-0" />
                                                                            Last sync: {timeAgo(lastSyncAt)}
                                                                        </span>
                                                                    )}
                                                                    {nextRetryAt && (
                                                                        <span className="flex items-center gap-1 text-amber-600">
                                                                            <RefreshCw className="w-3 h-3 shrink-0" />
                                                                            Retry: {new Date(nextRetryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                                        </span>
                                                                    )}
                                                                    {syncErrorCount > 0 && (
                                                                        <span className="flex items-center gap-1 text-red-500 font-medium">
                                                                            <AlertCircle className="w-3 h-3 shrink-0" />
                                                                            {syncErrorCount} error{syncErrorCount !== 1 ? 's' : ''}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* Error message snippet */}
                                                            {syncError && (
                                                                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-600 truncate">
                                                                    <AlertTriangle className="w-3 h-3 inline mr-1" />
                                                                    {syncError}
                                                                </div>
                                                            )}

                                                            {/* Action row */}
                                                            <div className="flex flex-wrap gap-2 pt-1 border-t border-(--color-card-border) mt-auto">
                                                                <button
                                                                    onClick={() => handleSyncNow(mb as any)}
                                                                    disabled={isSyncing}
                                                                    title="Sync this mailbox now"
                                                                    className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors bg-(--color-background) text-(--color-text-muted) hover:bg-(--color-primary) hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
                                                                >
                                                                    {isSyncing
                                                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                                                        : <RefreshCw className="w-3 h-3" />
                                                                    }
                                                                    {isSyncing ? 'Syncing…' : 'Sync Now'}
                                                                </button>
                                                                <button
                                                                    onClick={() => { setHealthMailbox(mb as Mailbox); setShowHealthModal(true); }}
                                                                    title="View health details"
                                                                    className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors bg-(--color-background) text-(--color-text-muted) hover:bg-(--color-primary) hover:text-white"
                                                                >
                                                                    <Activity className="w-3 h-3" />
                                                                    Health
                                                                </button>
                                                                <button
                                                                    onClick={() => { setFoldersMailbox(mb as Mailbox); setShowFoldersModal(true); }}
                                                                    title="Browse IMAP folders"
                                                                    className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors bg-(--color-background) text-(--color-text-muted) hover:bg-(--color-primary) hover:text-white"
                                                                >
                                                                    <FolderOpen className="w-3 h-3" />
                                                                    Folders
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        {activeTab === 'users' && (
                            <div className="space-y-4 animate-in fade-in">
                                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-(--color-card-border) pb-4">
                                    <div>
                                        <h3 className="text-lg font-bold text-(--color-text-primary)">Users & Invites</h3>
                                        <p className="text-sm text-(--color-text-muted)">Manage people within your organization.</p>
                                    </div>
                                    {canInviteUsers && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const userCount = localUsers.filter(u => u.isActive).length;
                                                const maxUsers = Number(orgData.maxUsers ?? 0);
                                                if (Number.isFinite(maxUsers) && maxUsers > 0 && userCount >= maxUsers) {
                                                    setShowUpgradeBlocker(true);
                                                } else {
                                                    setShowInviteUserModal(true);
                                                }
                                            }}
                                            className="px-4 py-2 bg-(--color-cta-primary) text-white text-sm font-medium rounded-lg hover:bg-(--color-cta-secondary) transition-colors shadow-sm"
                                        >
                                            Invite User
                                        </button>
                                    )}
                                </div>

                                {inviteFeedback && (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
                                        {inviteFeedback}
                                    </div>
                                )}

                                {canInviteUsers && (
                                    <div className="inline-flex rounded-lg border border-(--color-card-border) bg-(--color-background) p-1">
                                        <button
                                            type="button"
                                            onClick={() => setUsersSubTab('users')}
                                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeUsersSubTab === 'users'
                                                ? 'bg-white text-(--color-text-primary) border border-(--color-card-border)'
                                                : 'text-(--color-text-muted) hover:text-(--color-text-primary)'}`}
                                        >
                                            Users
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                setUsersSubTab('pending');
                                                await fetchPendingInvites();
                                            }}
                                            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeUsersSubTab === 'pending'
                                                ? 'bg-white text-(--color-text-primary) border border-(--color-card-border)'
                                                : 'text-(--color-text-muted) hover:text-(--color-text-primary)'}`}
                                        >
                                            Pending
                                        </button>
                                    </div>
                                )}

                                <div className="overflow-x-auto -mx-1 px-1">
                                    <div className="border border-(--color-card-border) rounded-lg overflow-hidden min-w-150">
                                        <table className="w-full text-left text-sm">
                                            <thead className="bg-(--color-background) text-(--color-text-muted) border-b border-(--color-card-border)">
                                                <tr>
                                                    {activeUsersSubTab === 'pending' ? (
                                                        <>
                                                            <th className="px-4 py-3 font-medium">Email</th>
                                                            <th className="px-4 py-3 font-medium">Role</th>
                                                            <th className="px-4 py-3 font-medium">Invited By</th>
                                                            <th className="px-4 py-3 font-medium">Invite Date</th>
                                                            <th className="px-4 py-3 font-medium">Status</th>
                                                            <th className="px-4 py-3 font-medium text-right">Actions</th>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <th className="px-4 py-3 font-medium">Name</th>
                                                            <th className="px-4 py-3 font-medium">Email</th>
                                                            <th className="px-4 py-3 font-medium">Role</th>
                                                            <th className="px-4 py-3 font-medium">Verified</th>
                                                            <th className="px-4 py-3 font-medium">Status</th>
                                                            <th className="px-4 py-3 font-medium text-right">Actions</th>
                                                        </>
                                                    )}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-(--color-card-border)">
                                                {activeUsersSubTab === 'pending' ? (
                                                    pendingInvitesLoading ? (
                                                        <tr>
                                                            <td className="px-4 py-8 text-center text-sm text-(--color-text-muted)" colSpan={6}>
                                                                Loading pending invites...
                                                            </td>
                                                        </tr>
                                                    ) : pendingInvites.length === 0 ? (
                                                        <tr>
                                                            <td className="px-4 py-8 text-center text-sm text-(--color-text-muted)" colSpan={6}>
                                                                No pending invites found.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        pendingInvites.map(invite => (
                                                            <tr key={invite.id} className="hover:bg-(--color-background)/50">
                                                                <td className="px-4 py-3 text-(--color-text-primary)">{invite.email}</td>
                                                                <td className="px-4 py-3">
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                                                                        {invite.role}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 text-(--color-text-muted)">{invite.invitedBy || '-'}</td>
                                                                <td className="px-4 py-3 text-(--color-text-muted)">{new Date(invite.inviteDate).toLocaleDateString()}</td>
                                                                <td className="px-4 py-3">
                                                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                                                        Pending
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 text-right">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setRevokeInviteConfirm(invite)}
                                                                        disabled={revokingInviteId === invite.id}
                                                                        className="inline-flex items-center gap-1 text-red-600 hover:underline text-xs font-medium disabled:opacity-60 disabled:no-underline"
                                                                    >
                                                                        <Trash2 className="w-3 h-3" />
                                                                        {revokingInviteId === invite.id ? 'Revoking...' : 'Revoke'}
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )
                                                ) : (
                                                    userRows.length === 0 ? (
                                                        <tr>
                                                            <td className="px-4 py-8 text-center text-sm text-(--color-text-muted)" colSpan={6}>
                                                                No users found.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        userRows.map(u => (
                                                            <tr key={u.id} className={`hover:bg-(--color-background)/50 ${!u.isActive ? 'opacity-60' : ''}`}>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex items-center gap-3">
                                                                        <div className="w-8 h-8 rounded-full bg-(--color-accent) text-(--color-primary) flex items-center justify-center font-bold text-xs overflow-hidden shrink-0">
                                                                            {(u as any).avatarUrl && !brokenAvatarUserIds.has(u.id) ? (
                                                                                <img
                                                                                    src={resolveAvatarUrl((u as any).avatarUrl)}
                                                                                    alt=""
                                                                                    referrerPolicy="no-referrer"
                                                                                    loading="lazy"
                                                                                    className="w-full h-full rounded-full object-cover"
                                                                                    onError={() => setBrokenAvatarUserIds(prev => new Set(prev).add(u.id))}
                                                                                />
                                                                            ) : ((u.fullName || u.email || '?').charAt(0).toUpperCase())}
                                                                        </div>
                                                                        <span className="font-medium text-(--color-text-primary)">{u.fullName}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3 text-(--color-text-muted)">{u.email}</td>
                                                                <td className="px-4 py-3"><span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">{u.role}</span></td>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <span title={u.emailVerified ? 'Email verified' : 'Email not verified'}>
                                                                            {u.emailVerified
                                                                                ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                                                                : <XCircle className="w-4 h-4 text-gray-300" />}
                                                                        </span>
                                                                        <span title={u.mfaEnabled ? 'MFA enabled' : 'MFA not enabled'}>
                                                                            {u.mfaEnabled
                                                                                ? <ShieldCheck className="w-4 h-4 text-blue-500" />
                                                                                : <ShieldOff className="w-4 h-4 text-gray-300" />}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    {u.isActive ? (
                                                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                                                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                                                            Active
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                                                                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                                                                            Inactive
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-3 text-right">
                                                                    <div className="flex items-center justify-end gap-2">
                                                                        {canManageUser(u) ? (
                                                                            <>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => { setEditingUser(u); setShowEditUserModal(true); }}
                                                                                    className="text-(--color-primary) hover:underline text-xs font-medium"
                                                                                >
                                                                                    Edit
                                                                                </button>
                                                                                {u.isActive ? (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => { setDeletingUser(u); setShowDeleteModal(true); }}
                                                                                        className="text-red-500 hover:underline text-xs font-medium"
                                                                                    >
                                                                                        Deactivate
                                                                                    </button>
                                                                                ) : (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={async () => {
                                                                                            try {
                                                                                                const res = await api.patch(`/users/${u.id}`, { isActive: true });
                                                                                                setLocalUsers(prev => sortUsersByRole(prev.map(x => x.id === u.id ? res.data : x)));
                                                                                            } catch (err) {
                                                                                                console.error('Failed to restore user:', err);
                                                                                            }
                                                                                        }}
                                                                                        className="inline-flex items-center gap-1 text-emerald-600 hover:underline text-xs font-medium"
                                                                                    >
                                                                                        <RotateCcw className="w-3 h-3" />
                                                                                        Restore
                                                                                    </button>
                                                                                )}
                                                                            </>
                                                                        ) : (
                                                                            <span className="text-xs text-(--color-text-muted)">No actions</span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )
                                                )}
                                            </tbody>
                                        </table>
                                    </div>

                                    <div className="mt-4 rounded-lg border border-(--color-card-border) bg-(--color-background) p-3 text-xs text-(--color-text-muted)">
                                        Team permissions are evaluated from team membership plus mailbox access entries (canRead, canSend, canManage, canSetImapFlags) using OR logic.
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'teams' && (
                            <div className="space-y-6 animate-in fade-in">
                                <div className={`bg-white p-5 ${selectedTeamId ? 'md:space-y-5' : 'rounded-2xl border border-(--color-card-border) space-y-5'}`}>
                                    {/* Header — hidden on mobile when panel open, visible on md+ */}
                                    <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${selectedTeamId ? 'hidden md:flex' : ''}`}>
                                        <div>
                                            <h3 className="text-lg font-bold text-(--color-text-primary)">Teams</h3>
                                            <p className="text-sm text-(--color-text-muted) whitespace-nowrap overflow-hidden text-ellipsis">Organize users into squads and departments.</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => openTeamPanel(null)}
                                            className="sm:shrink-0 sm:whitespace-nowrap whitespace-nowrap px-4 py-2 bg-(--color-cta-primary) text-white text-sm font-medium rounded-lg hover:bg-(--color-cta-secondary) transition-colors shadow-sm"
                                        >
                                            <Plus className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                                            Create Team
                                        </button>
                                    </div>

                                    {/* Split layout — always side by side on md+ when a panel is open */}
                                    <div className={selectedTeamId ? 'grid grid-cols-1 md:grid-cols-[minmax(0,280px)_1fr] gap-5' : ''}>
                                        {/* Left / Full: Team list — hidden on mobile when panel open, visible on md+ */}
                                        <div className={selectedTeamId ? 'hidden md:block md:space-y-2' : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'}>
                                            {localTeams.length === 0 && (
                                                <p className="text-sm text-(--color-text-muted) py-4 text-center">No teams yet. Create your first team.</p>
                                            )}
                                            {localTeams.map(team => {
                                                const lead = localUsers.find(u => u.id === team.leadId);
                                                const linkedMbCount = (team.linkedMailboxIds || []).length;
                                                const isActive = selectedTeamId === team.id;
                                                const createdLabel = team.createdAt ? new Date(team.createdAt).toLocaleDateString() : '--';
                                                return (
                                                    <button
                                                        key={team.id}
                                                        type="button"
                                                        onClick={() => openTeamPanel(team)}
                                                        className={`w-full text-left rounded-xl border p-3.5 transition-all ${isActive ? 'border-(--color-primary) bg-(--color-primary)/5 shadow-sm' : 'border-(--color-card-border) bg-white hover:border-(--color-primary)/40 hover:shadow-sm'}`}
                                                    >
                                                        <div className="flex items-center justify-between mb-1.5">
                                                            <span className={`text-sm font-bold ${isActive ? 'text-(--color-primary)' : 'text-(--color-text-primary)'}`}>{team.name}</span>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${team.status === 'deleted' ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                                                    {team.status || 'active'}
                                                                </span>
                                                                {isActive && <span className="w-2 h-2 rounded-full bg-(--color-primary)" />}
                                                            </div>
                                                        </div>
                                                        {team.description && (
                                                            <p className="mb-2 text-xs text-(--color-text-muted) line-clamp-2">{team.description}</p>
                                                        )}
                                                        <div className="flex flex-wrap gap-1.5">
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-(--color-background) text-(--color-text-muted) border border-(--color-card-border) rounded-full">
                                                                Role: {team.teamRole === 'lead' ? 'lead' : team.teamRole === 'member' ? 'member' : 'none'}
                                                            </span>
                                                            {lead && (
                                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-full">
                                                                    Lead: {lead.fullName.split(' ')[0]}
                                                                </span>
                                                            )}
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-(--color-background) text-(--color-text-muted) border border-(--color-card-border) rounded-full">
                                                                {team.members.length} member{team.members.length !== 1 ? 's' : ''}
                                                            </span>
                                                            {linkedMbCount > 0 && (
                                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-full">
                                                                    <Mail className="w-2.5 h-2.5" />{linkedMbCount}
                                                                </span>
                                                            )}
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-(--color-background) text-(--color-text-muted) border border-(--color-card-border) rounded-full">
                                                                Created: {createdLabel}
                                                            </span>
                                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 bg-(--color-background) text-(--color-text-muted) border border-(--color-card-border) rounded-full">
                                                                Workload: {team.workloadCount || 0}
                                                            </span>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {/* Right: Detail panel — only rendered when a team is selected */}
                                        {selectedTeamId && (() => {
                                            const isNew = selectedTeamId === 'new';
                                            const activeUsers = localUsers.filter(u => u.isActive !== false);
                                            return (
                                                <div className="md:rounded-xl md:border md:border-(--color-card-border) md:bg-white">
                                                    <div className="md:divide-y md:divide-(--color-card-border)">
                                                        {/* Panel header */}
                                                        <div className="flex items-center justify-between px-5 py-4 md:border-b md:border-(--color-card-border)">
                                                            <h4 className="text-base font-bold text-(--color-text-primary)">{isNew ? 'New Team' : teamDetailForm.name || 'Team Details'}</h4>
                                                            <button type="button" onClick={() => { setSelectedTeamId(null); setTeamDetailDirty(false); }} className="text-(--color-text-muted) hover:text-(--color-text-primary)"><X className="w-5 h-5" /></button>
                                                        </div>

                                                        <div className="px-5 py-5 space-y-6">
                                                            {/* 1. Basic Info */}
                                                            <section>
                                                                <SectionTitle>Basic Info</SectionTitle>
                                                                <div className="space-y-3">
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-(--color-text-primary) mb-1.5">Team Name</label>
                                                                        <input
                                                                            type="text"
                                                                            value={teamDetailForm.name}
                                                                            onChange={e => { setTeamDetailForm(p => ({ ...p, name: e.target.value })); setTeamDetailDirty(true); }}
                                                                            placeholder="e.g. Support"
                                                                            className="w-full px-3 py-2 border border-(--color-input-border) rounded-lg text-sm focus:ring-2 focus:ring-(--color-primary)/20 focus:outline-none bg-white transition-colors"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-sm font-medium text-(--color-text-primary) mb-1.5">Description</label>
                                                                        <textarea
                                                                            rows={2}
                                                                            value={teamDetailForm.description ?? ''}
                                                                            onChange={e => { setTeamDetailForm(p => ({ ...p, description: e.target.value })); setTeamDetailDirty(true); }}
                                                                            placeholder="What does this team handle?"
                                                                            className="w-full px-3 py-2 border border-(--color-input-border) rounded-lg text-sm focus:ring-2 focus:ring-(--color-primary)/20 focus:outline-none bg-white transition-colors resize-none"
                                                                        />
                                                                    </div>
                                                                    {teamDetailDirty && (
                                                                        <div className="flex items-center gap-2 pt-1">
                                                                            <button type="button" onClick={saveTeamDetail} disabled={!teamDetailForm.name.trim()} className="px-4 py-1.5 text-sm font-medium bg-(--color-cta-primary) text-white rounded-lg hover:bg-(--color-cta-secondary) transition-colors disabled:opacity-50">Save</button>
                                                                            <button type="button" onClick={() => { openTeamPanel(isNew ? null : localTeams.find(t => t.id === selectedTeamId) || null); setSelectedTeamId(isNew ? null : selectedTeamId); }} className="px-4 py-1.5 text-sm font-medium text-(--color-text-muted) hover:bg-(--color-background) rounded-lg transition-colors">Cancel</button>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </section>

                                                            {/* 2. Members + Roles */}
                                                            <section>
                                                                <SectionTitle>Members &amp; Roles</SectionTitle>
                                                                <div className="space-y-3">
                                                                    {/* Member selector */}
                                                                    <div className="rounded-lg border border-(--color-card-border) overflow-hidden divide-y divide-(--color-card-border)">
                                                                        {activeUsers.map(user => {
                                                                            const isMember = teamDetailForm.members.includes(user.id);
                                                                            const isLead = teamDetailForm.leadId === user.id;
                                                                            return (
                                                                                <div key={user.id} className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-(--color-background)/40 transition-colors">
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={isMember}
                                                                                        onChange={() => {
                                                                                            setTeamDetailDirty(true);
                                                                                            setTeamDetailForm(p => {
                                                                                                const next = isMember ? p.members.filter(id => id !== user.id) : [...p.members, user.id];
                                                                                                return { ...p, members: next, leadId: next.includes(p.leadId) ? p.leadId : '' };
                                                                                            });
                                                                                        }}
                                                                                        className="rounded border-(--color-card-border) text-(--color-primary) focus:ring-(--color-primary) w-4 h-4"
                                                                                    />
                                                                                    <div className="w-7 h-7 rounded-full bg-(--color-accent) flex items-center justify-center text-xs font-bold text-(--color-primary)">
                                                                                        {user.fullName.charAt(0)}
                                                                                    </div>
                                                                                    <span className={`flex-1 text-sm ${isMember ? 'text-(--color-text-primary) font-medium' : 'text-(--color-text-muted)'}`}>{user.fullName}</span>
                                                                                    {isMember && (
                                                                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${isLead ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-(--color-background) text-(--color-text-muted) border-(--color-card-border)'}`}>
                                                                                            {isLead ? 'Lead' : 'Member'}
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                    {/* Lead selector */}
                                                                    {teamDetailForm.members.length > 0 && (
                                                                        <div className="flex items-center gap-3">
                                                                            <label className="text-sm font-medium text-(--color-text-primary) w-20 shrink-0">Team Lead</label>
                                                                            <select
                                                                                value={teamDetailForm.leadId}
                                                                                onChange={e => { setTeamDetailForm(p => ({ ...p, leadId: e.target.value })); setTeamDetailDirty(true); }}
                                                                                className="flex-1 px-3 py-2 border border-(--color-input-border) rounded-lg text-sm focus:ring-2 focus:ring-(--color-primary)/20 focus:outline-none bg-white"
                                                                            >
                                                                                <option value="">None</option>
                                                                                {activeUsers.filter(u => teamDetailForm.members.includes(u.id)).map(u => (
                                                                                    <option key={u.id} value={u.id}>{u.fullName}</option>
                                                                                ))}
                                                                            </select>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </section>

                                                            {/* 3. Linked Mailboxes */}
                                                            <section>
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <SectionTitle noMargin>Linked Mailboxes</SectionTitle>
                                                                    <span className="text-xs text-(--color-text-muted)">{teamDetailForm.linkedMailboxIds.length} linked</span>
                                                                </div>
                                                                {!canEditTeamMailboxLinks && (
                                                                    <p className="mb-3 text-xs text-(--color-text-muted)">Only admins can link or unlink mailboxes from teams.</p>
                                                                )}
                                                                {/* Chips of selected */}
                                                                {teamDetailForm.linkedMailboxIds.length > 0 && (
                                                                    <div className="flex flex-wrap gap-1.5 mb-3">
                                                                        {teamDetailForm.linkedMailboxIds.map(mbId => {
                                                                            const mb = mailboxes.find(m => m.id === mbId);
                                                                            if (!mb) return null;
                                                                            return (
                                                                                <span key={mbId} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full text-xs font-semibold">
                                                                                    <Mail className="w-3 h-3" />
                                                                                    {mb.name}
                                                                                    {canEditTeamMailboxLinks && (
                                                                                        <button type="button" onClick={() => { setTeamDetailDirty(true); setTeamDetailForm(p => ({ ...p, linkedMailboxIds: p.linkedMailboxIds.filter(id => id !== mbId) })); }} className="ml-0.5 text-blue-400 hover:text-blue-700"><X className="w-3 h-3" /></button>
                                                                                    )}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                                {/* Checklist */}
                                                                <div className="rounded-lg border border-(--color-card-border) overflow-hidden divide-y divide-(--color-card-border)">
                                                                    {mailboxes.map(mb => {
                                                                        const linked = teamDetailForm.linkedMailboxIds.includes(mb.id);
                                                                        return (
                                                                            <label key={mb.id} className="flex items-center gap-3 px-3 py-2.5 bg-white hover:bg-(--color-background)/40 transition-colors cursor-pointer">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={linked}
                                                                                    disabled={!canEditTeamMailboxLinks}
                                                                                    onChange={() => {
                                                                                        setTeamDetailDirty(true);
                                                                                        setTeamDetailForm(p => ({
                                                                                            ...p,
                                                                                            linkedMailboxIds: linked ? p.linkedMailboxIds.filter(id => id !== mb.id) : [...p.linkedMailboxIds, mb.id],
                                                                                        }));
                                                                                    }}
                                                                                    className="rounded border-(--color-card-border) text-(--color-primary) focus:ring-(--color-primary) w-4 h-4"
                                                                                />
                                                                                <Mail className="w-4 h-4 text-(--color-text-muted)" />
                                                                                <span className="flex-1 text-sm text-(--color-text-primary)">{mb.name}</span>
                                                                                <span className="text-xs text-(--color-text-muted)">{mb.email}</span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </section>

                                                            {/* 4. Team Rules */}
                                                            <section>
                                                                <SectionTitle>Team Rules</SectionTitle>
                                                                <div className="flex items-center justify-between rounded-lg border border-(--color-card-border) px-4 py-3 bg-white">
                                                                    <div>
                                                                        <p className="text-sm font-medium text-(--color-text-primary)">Routing &amp; Assignment Rules</p>
                                                                        <p className="text-xs text-(--color-text-muted) mt-0.5">Rules that auto-assign threads to this team.</p>
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => navigate('/rules')}
                                                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-(--color-card-border) text-(--color-text-muted) hover:border-(--color-primary) hover:text-(--color-primary) transition-colors"
                                                                    >
                                                                        <Zap className="w-3.5 h-3.5" />
                                                                        Manage Rules
                                                                    </button>
                                                                </div>
                                                            </section>

                                                            {/* 5. Assignment Readiness */}
                                                            <section>
                                                                <div className="mb-2 text-xs text-(--color-text-muted)">
                                                                    Team workload: {localTeams.find((team) => team.id === selectedTeamId)?.workloadCount || 0} active thread assignment(s).
                                                                </div>
                                                                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3">
                                                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                                                    <p className="text-sm text-emerald-700">Threads can be assigned to this team.</p>
                                                                </div>
                                                            </section>

                                                            {/* 6. Archive Team */}
                                                            {!isNew && (
                                                                <section className="pt-2 border-t border-(--color-card-border)">
                                                                    <SectionTitle>Danger Zone</SectionTitle>
                                                                    {confirmArchiveTeamId === selectedTeamId ? (
                                                                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 space-y-3">
                                                                            <p className="text-sm font-medium text-amber-800">Archive <strong>{teamDetailForm.name}</strong>?</p>
                                                                            <p className="text-xs text-amber-700">This team will be removed from the active list. Existing thread assignments are preserved.</p>
                                                                            <div className="flex gap-2">
                                                                                <button type="button" onClick={() => archiveTeam(selectedTeamId!)} className="px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors">Archive Team</button>
                                                                                <button type="button" onClick={() => setConfirmArchiveTeamId(null)} className="px-3 py-1.5 text-xs font-semibold text-(--color-text-muted) hover:bg-(--color-background) rounded-lg transition-colors">Cancel</button>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => setConfirmArchiveTeamId(selectedTeamId)}
                                                                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors"
                                                                        >
                                                                            <Download className="w-4 h-4" />
                                                                            Archive Team
                                                                        </button>
                                                                    )}
                                                                </section>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'tags' && (
                            <div className="space-y-6 animate-in fade-in">
                                <TagsPage embedded />
                            </div>
                        )}

                        {activeTab === 'roles' && (
                            <div className="space-y-6 animate-in fade-in">
                                <div className="border-b border-(--color-card-border) pb-4">
                                    <h3 className="text-lg font-bold text-(--color-text-primary)">Roles & Permissions</h3>
                                    <p className="text-sm text-(--color-text-muted)">Manage effective role assignments using the live users API.</p>
                                </div>

                                {rolesError && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                        {rolesError}
                                    </div>
                                )}
                                {rolesSuccess && (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                        {rolesSuccess}
                                    </div>
                                )}

                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                    {ROLE_LEVELS.map((entry) => (
                                        <div key={entry.role} className="rounded-xl border border-(--color-card-border) bg-white p-4 shadow-(--shadow-sm)">
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-sm font-semibold text-(--color-text-primary)">{entry.role.toLowerCase()}</h4>
                                                <span className="inline-flex items-center rounded-full bg-(--color-background) px-2.5 py-0.5 text-xs font-medium text-(--color-text-muted)">level {entry.level}</span>
                                            </div>
                                            <p className="text-xs text-(--color-text-muted)">{entry.description}</p>
                                        </div>
                                    ))}
                                </div>

                                <div className="rounded-lg border border-(--color-card-border) bg-white p-4 space-y-4">
                                    <h4 className="text-sm font-semibold text-(--color-text-primary)">Permission Catalog</h4>
                                    <div className="space-y-3">
                                        {Object.entries(PERMISSION_CATALOG).map(([category, permissions]) => (
                                            <div key={category} className="rounded-lg border border-(--color-card-border) p-3">
                                                <div className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted) mb-2">{category}</div>
                                                <div className="flex flex-wrap gap-2 mb-3">
                                                    {permissions.map((permission) => (
                                                        <span key={permission} className="inline-flex items-center rounded-full border border-(--color-card-border) bg-(--color-background) px-2 py-0.5 text-xs text-(--color-text-primary)">
                                                            {permission}
                                                        </span>
                                                    ))}
                                                </div>
                                                <div className="flex flex-wrap gap-1.5 text-[11px]">
                                                    {ROLE_LEVELS.map((role) => {
                                                        const enabled = permissions.some((permission) => ROLE_PERMISSION_DEFAULTS[role.role].includes(permission));
                                                        return (
                                                            <span
                                                                key={`${category}-${role.role}`}
                                                                className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${enabled
                                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                                    : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
                                                            >
                                                                {role.role.toLowerCase()}: {enabled ? 'has access' : 'no access'}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-lg border border-(--color-card-border) overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full text-sm">
                                            <thead className="bg-(--color-background)">
                                                <tr>
                                                    <th className="px-4 py-3 text-left font-medium text-(--color-text-muted)">User</th>
                                                    <th className="px-4 py-3 text-left font-medium text-(--color-text-muted)">Current Role</th>
                                                    <th className="px-4 py-3 text-left font-medium text-(--color-text-muted)">Assign Role</th>
                                                    <th className="px-4 py-3 text-left font-medium text-(--color-text-muted)">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-(--color-card-border)">
                                                {localUsers.map((userRecord) => {
                                                    const manageable = canManageUser(userRecord);
                                                    const allowedRoles = allowedRolesForTarget(userRecord);
                                                    return (
                                                        <tr key={userRecord.id} className="hover:bg-(--color-background)/40">
                                                            <td className="px-4 py-3">
                                                                <div className="font-medium text-(--color-text-primary)">{userRecord.fullName || userRecord.email}</div>
                                                                <div className="text-xs text-(--color-text-muted)">{userRecord.email}</div>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                                                                    {userRecord.role}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                {manageable ? (
                                                                    <select
                                                                        value={userRecord.role}
                                                                        onChange={(event) => updateUserRole(userRecord.id, event.target.value as 'USER' | 'MANAGER' | 'ADMIN')}
                                                                        disabled={roleSavingUserId === userRecord.id}
                                                                        className="rounded-md border border-(--color-card-border) bg-white px-2 py-1.5 text-sm disabled:opacity-60"
                                                                    >
                                                                        {[userRecord.role, ...allowedRoles]
                                                                            .filter((value, index, array) => array.indexOf(value) === index)
                                                                            .map((role) => (
                                                                                <option key={role} value={role}>{role}</option>
                                                                            ))}
                                                                    </select>
                                                                ) : (
                                                                    <span className="text-xs text-(--color-text-muted)">No permission</span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                {roleSavingUserId === userRecord.id ? (
                                                                    <span className="inline-flex items-center gap-1 text-xs text-(--color-text-muted)">
                                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                                        Saving
                                                                    </span>
                                                                ) : userRecord.isActive ? (
                                                                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>
                                                                ) : (
                                                                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Inactive</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="rounded-lg border border-(--color-card-border) bg-(--color-background) p-3 text-xs text-(--color-text-muted)">
                                    Mailbox-level permissions are configured separately in the Mailboxes tab: canRead, canSend, canManage, canSetImapFlags.
                                </div>
                            </div>
                        )}

                        {activeTab === 'integrations' && (
                            <div className="space-y-6 animate-in fade-in">
                                <div className="border-b border-(--color-card-border) pb-4">
                                    <h3 className="text-lg font-bold text-(--color-text-primary)">Integrations</h3>
                                    <p className="text-sm text-(--color-text-muted)">Configure provider connections for mailboxes, calendar, meetings, and webhooks.</p>
                                </div>

                                {(oauthBanner?.provider === 'zoom' || oauthBanner?.provider === 'google' || oauthBanner?.provider === 'microsoft') && oauthBanner?.state === 'success' && (
                                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                        <strong>{oauthBanner.provider === 'zoom' ? 'Zoom connected!' : oauthBanner.provider === 'microsoft' ? 'Microsoft connected!' : 'Google connected!'}</strong> Integration is now available for supported modules.
                                    </div>
                                )}
                                {(oauthBanner?.provider === 'zoom' || oauthBanner?.provider === 'google' || oauthBanner?.provider === 'microsoft') && oauthBanner?.state === 'error' && (
                                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                                        <strong>{oauthBanner.provider === 'zoom' ? 'Zoom connection failed.' : oauthBanner.provider === 'microsoft' ? 'Microsoft connection failed.' : 'Google connection failed.'}</strong> Please try again.
                                    </div>
                                )}

                                <div className="rounded-xl border border-(--color-card-border) bg-white p-4 shadow-(--shadow-sm)">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-sm font-semibold text-(--color-text-primary)">Email Providers (OAuth)</h4>
                                        <span className="text-xs text-(--color-text-muted)">Google + Microsoft OAuth is reused across Mailboxes, Calendar, and Meetings.</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {[
                                            { key: 'google' as IntegrationProvider, name: 'Google (Gmail)', fallbackAccount: 'No account linked' },
                                            { key: 'microsoft' as IntegrationProvider, name: 'Microsoft (Outlook 365)', fallbackAccount: 'No account linked' },
                                        ].map((provider) => {
                                            const providerState = integrationStates[provider.key];
                                            return (
                                                <div key={provider.name} className="rounded-lg border border-(--color-card-border) p-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <h5 className="text-sm font-semibold text-(--color-text-primary)">{provider.name}</h5>
                                                            <p className="mt-1 text-xs text-(--color-text-muted)">{providerState.account || provider.fallbackAccount}</p>
                                                        </div>
                                                        <StatusBadge label={providerState.connected ? 'Connected' : 'Not Connected'} variant={providerState.connected ? 'success' : 'neutral'} />
                                                    </div>
                                                    <div className="mt-3 flex justify-end">
                                                        {providerState.connected ? (
                                                            <button type="button" onClick={() => handleDisconnect(provider.key).catch(console.error)} className="text-xs font-medium text-(--color-text-muted) hover:text-red-600 transition-colors">Disconnect</button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => connectProvider(provider.key).catch(console.error)}
                                                                disabled={(provider.key === 'google' && googleConnecting) || (provider.key === 'microsoft' && microsoftConnecting)}
                                                                className="inline-flex items-center justify-center rounded-lg border border-(--color-card-border) bg-white px-3 py-1.5 text-xs font-medium text-(--color-primary) hover:border-(--color-primary) hover:bg-(--color-background) transition-colors disabled:opacity-60"
                                                            >
                                                                Connect
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="rounded-xl border border-(--color-card-border) bg-white p-4 shadow-(--shadow-sm)">
                                    <h4 className="text-sm font-semibold text-(--color-text-primary) mb-3">Calendar Integrations</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                                        <div className="rounded-lg border border-(--color-card-border) p-3 flex items-center justify-between">
                                            <span className="text-sm text-(--color-text-primary)">Google Calendar</span>
                                            <StatusBadge label={integrationStates.google.connected ? 'Connected' : 'Requires Google OAuth'} variant={integrationStates.google.connected ? 'success' : 'neutral'} />
                                        </div>
                                        <div className="rounded-lg border border-(--color-card-border) p-3 flex items-center justify-between">
                                            <span className="text-sm text-(--color-text-primary)">Microsoft Outlook Calendar</span>
                                            <StatusBadge label={integrationStates.microsoft.connected ? 'Connected' : 'Requires Microsoft OAuth'} variant={integrationStates.microsoft.connected ? 'success' : 'neutral'} />
                                        </div>
                                    </div>

                                    <div className="rounded-lg border border-(--color-card-border) p-3 mb-4">
                                        <div className="mb-2 flex items-start justify-between gap-3">
                                            <div>
                                                <h5 className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">CalDAV (generic providers)</h5>
                                                <p className="mt-1 text-xs text-(--color-text-muted)">
                                                    {calDavStatus.connected
                                                        ? `${calDavStatus.calendarName || 'Calendar connected'}${calDavStatus.lastCheckedAt ? ` • Last sync ${new Date(calDavStatus.lastCheckedAt).toLocaleString()}` : ''}`
                                                        : 'Connect Apple Calendar, Nextcloud, or any CalDAV-compatible provider.'}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <StatusBadge label={calDavStatus.connected ? 'Connected' : 'Not Connected'} variant={calDavStatus.connected ? 'success' : 'neutral'} />
                                                {calDavStatus.connected && (
                                                    <button
                                                        type="button"
                                                        onClick={() => disconnectCalDav().catch(console.error)}
                                                        disabled={calDavDisconnecting}
                                                        className="text-xs font-medium text-(--color-text-muted) hover:text-red-600 transition-colors disabled:opacity-60"
                                                    >
                                                        {calDavDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <form
                                            className="space-y-2"
                                            onSubmit={(event) => {
                                                event.preventDefault();
                                                void syncCalDav();
                                            }}
                                        >
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                                <input value={calDavUrl} onChange={(e) => setCalDavUrl(e.target.value)} placeholder="CalDAV URL" autoComplete="url" className="px-3 py-2 rounded-lg border border-(--color-card-border) text-sm" />
                                                <input value={calDavUsername} onChange={(e) => setCalDavUsername(e.target.value)} placeholder="Username" autoComplete="username" className="px-3 py-2 rounded-lg border border-(--color-card-border) text-sm" />
                                                <input type="password" value={calDavPassword} onChange={(e) => setCalDavPassword(e.target.value)} placeholder={calDavStatus.connected ? 'Password (leave blank to reuse saved secret)' : 'Password or app password'} autoComplete="current-password" className="px-3 py-2 rounded-lg border border-(--color-card-border) text-sm" />
                                            </div>
                                            <div className="flex items-center justify-between gap-3">
                                                {calDavMessage ? (
                                                    <span className={`text-xs ${calDavMessage.type === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>{calDavMessage.text}</span>
                                                ) : calDavStatus.lastError ? (
                                                    <span className="text-xs text-amber-700">{calDavStatus.lastError}</span>
                                                ) : <span className="text-xs text-(--color-text-muted)">Sync external calendars via CalDAV.</span>}
                                                <button type="submit" disabled={calDavSyncing} className="inline-flex items-center justify-center rounded-lg border border-(--color-card-border) px-3 py-1.5 text-xs font-medium text-(--color-primary) hover:bg-(--color-background) disabled:opacity-60">
                                                    {calDavSyncing ? 'Syncing...' : 'Sync CalDAV'}
                                                </button>
                                            </div>
                                        </form>
                                    </div>

                                    <div className="rounded-lg border border-(--color-card-border) p-3">
                                        <h5 className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted) mb-2">iCal Feed (read-only URL)</h5>
                                        <div className="flex flex-col md:flex-row gap-2 md:items-center">
                                            <input
                                                readOnly
                                                value={`${api.defaults.baseURL}/calendar/feed/${currentUser?.id}.ics`}
                                                className="w-full px-3 py-2 rounded-lg border border-(--color-card-border) bg-(--color-background) text-xs text-(--color-text-muted)"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => navigator.clipboard.writeText(`${api.defaults.baseURL}/calendar/feed/${currentUser?.id}.ics`).catch(() => {})}
                                                className="inline-flex items-center justify-center rounded-lg border border-(--color-card-border) px-3 py-2 text-xs font-medium text-(--color-primary) hover:bg-(--color-background)"
                                            >
                                                Copy URL
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-(--color-card-border) bg-white p-4 shadow-(--shadow-sm)">
                                    <h4 className="text-sm font-semibold text-(--color-text-primary) mb-3">Video Conferencing</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div className="rounded-lg border border-(--color-card-border) p-3">
                                            <div className="text-sm font-medium text-(--color-text-primary)">Google Meet</div>
                                            <div className="mt-1 text-xs text-(--color-text-muted)">Available via Google Calendar integration.</div>
                                            <div className="mt-2"><StatusBadge label={integrationStates.google.connected ? 'Ready' : 'Connect Google OAuth'} variant={integrationStates.google.connected ? 'success' : 'neutral'} /></div>
                                        </div>
                                        <div className="rounded-lg border border-(--color-card-border) p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <div>
                                                    <div className="text-sm font-medium text-(--color-text-primary)">Zoom</div>
                                                    <div className="mt-1 text-xs text-(--color-text-muted)">Separate OAuth connection required.</div>
                                                </div>
                                                <StatusBadge label={integrationStates.zoom.connected ? 'Connected' : 'Not Connected'} variant={integrationStates.zoom.connected ? 'success' : 'neutral'} />
                                            </div>
                                            <div className="mt-2 flex justify-end">
                                                {integrationStates.zoom.connected ? (
                                                    <button type="button" onClick={() => handleDisconnect('zoom').catch(console.error)} className="text-xs font-medium text-(--color-text-muted) hover:text-red-600 transition-colors">Disconnect</button>
                                                ) : (
                                                    <button type="button" onClick={() => connectProvider('zoom').catch(console.error)} disabled={zoomConnecting} className="inline-flex items-center justify-center rounded-lg border border-(--color-card-border) bg-white px-3 py-1.5 text-xs font-medium text-(--color-primary) hover:border-(--color-primary) hover:bg-(--color-background) transition-colors disabled:opacity-60">Connect</button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="rounded-lg border border-(--color-card-border) p-3">
                                            <div className="text-sm font-medium text-(--color-text-primary)">Microsoft Teams</div>
                                            <div className="mt-1 text-xs text-(--color-text-muted)">Available via Microsoft Outlook Calendar integration.</div>
                                            <div className="mt-2"><StatusBadge label={integrationStates.microsoft.connected ? 'Ready' : 'Connect Microsoft OAuth'} variant={integrationStates.microsoft.connected ? 'success' : 'neutral'} /></div>
                                        </div>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-(--color-card-border) bg-white p-4 shadow-(--shadow-sm)">
                                    <div className="flex items-center justify-between mb-3">
                                        <h4 className="text-sm font-semibold text-(--color-text-primary)">Webhooks</h4>
                                        <button type="button" onClick={() => navigate('/webhooks')} className="inline-flex items-center justify-center rounded-lg border border-(--color-card-border) px-3 py-1.5 text-xs font-medium text-(--color-primary) hover:bg-(--color-background)">Manage Webhooks</button>
                                    </div>
                                    <p className="text-xs text-(--color-text-muted) mb-2">Outgoing webhooks system with event subscriptions:</p>
                                    <div className="flex flex-wrap gap-2">
                                        {WEBHOOK_INTEGRATION_EVENTS.map((eventType) => (
                                            <span key={eventType} className="inline-flex items-center rounded-full border border-(--color-card-border) bg-(--color-background) px-2 py-0.5 text-xs text-(--color-text-primary)">
                                                {eventType}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="rounded-lg border border-(--color-card-border) bg-(--color-background) p-3 text-xs text-(--color-text-muted)">
                                    Admin has full access to integrations. Manager and user roles cannot access this tab.
                                </div>
                            </div>
                        )}

                        {activeTab === 'billing' && (
                            <div className="space-y-6 animate-in fade-in">
                                <div className="border-b border-(--color-card-border) pb-4">
                                    <h3 className="text-lg font-bold text-(--color-text-primary)">Billing & Subscription</h3>
                                    <p className="text-sm text-(--color-text-muted)">Manage your plan and usage limits.</p>
                                </div>
                                {billingLoading ? (
                                    <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
                                        <div className="rounded-xl border border-(--color-border) bg-(--color-primary) p-4 sm:p-6 shadow-(--shadow-sm)">
                                            <div className="animate-pulse">
                                                <div className="h-3 w-24 rounded bg-(--color-accent)/40" />
                                                <div className="mt-3 h-10 w-56 rounded bg-(--color-accent)/35" />
                                                <div className="mt-4 space-y-2">
                                                    <div className="h-4 w-44 rounded bg-(--color-accent)/30" />
                                                    <div className="h-4 w-48 rounded bg-(--color-accent)/30" />
                                                    <div className="h-4 w-36 rounded bg-(--color-accent)/30" />
                                                    <div className="h-4 w-44 rounded bg-(--color-accent)/30" />
                                                    <div className="h-4 w-40 rounded bg-(--color-accent)/30" />
                                                    <div className="h-4 w-36 rounded bg-(--color-accent)/30" />
                                                </div>
                                                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="h-16 rounded-lg border border-(--color-accent) bg-(--color-secondary)" />
                                                    <div className="h-16 rounded-lg border border-(--color-accent) bg-(--color-secondary)" />
                                                </div>
                                                <div className="mt-4 flex gap-3">
                                                    <div className="h-10 w-32 rounded-lg bg-(--color-accent)/35" />
                                                    <div className="h-10 w-32 rounded-lg border border-(--color-accent)" />
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="space-y-4 border border-(--color-card-border) rounded-xl p-5 shadow-sm bg-white animate-pulse">
                                                <div className="h-6 w-36 rounded bg-(--color-background)" />
                                                <div className="space-y-3">
                                                    <div className="h-4 w-20 rounded bg-(--color-background)" />
                                                    <div className="h-2 rounded bg-(--color-background)" />
                                                </div>
                                                <div className="space-y-3">
                                                    <div className="h-4 w-24 rounded bg-(--color-background)" />
                                                    <div className="h-2 rounded bg-(--color-background)" />
                                                </div>
                                                <div className="space-y-3">
                                                    <div className="h-4 w-20 rounded bg-(--color-background)" />
                                                    <div className="h-2 rounded bg-(--color-background)" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-6">
                                    <div className="rounded-xl border border-(--color-border) bg-(--color-primary) p-4 sm:p-6 shadow-(--shadow-sm)">
                                        <div className="flex items-start justify-between gap-4 mb-4">
                                            <div>
                                                <p className="text-xs font-medium tracking-wide text-(--color-accent)" style={{ fontFamily: 'var(--font-ui)' }}>Current Plan</p>
                                                <h3 className="mt-2 text-3xl font-bold text-(--color-background)" style={{ fontFamily: 'var(--font-headline)' }}>{formatPlanLabel(billingInfo.currentPlan || orgData.plan)}</h3>
                                            </div>
                                            <span
                                                className="inline-flex items-center rounded-full border border-(--color-accent) bg-(--color-secondary) px-3 py-1 text-xs font-medium text-(--color-background)"
                                                style={{ fontFamily: 'var(--font-ui)' }}
                                            >
                                                {String(billingInfo.subscriptionStatus || orgData.subscriptionStatus || 'active')}
                                            </span>
                                        </div>

                                        <div className="space-y-2 mb-5">
                                            {[
                                                'Unlimited Users',
                                                'Unlimited Mailboxes',
                                                '100GB Storage',
                                                'Priority 24/7 Support',
                                                'Advanced Analytics',
                                                'Custom Branding',
                                            ].map((feature) => (
                                                <div key={feature} className="flex items-center gap-2 text-sm text-(--color-background)" style={{ fontFamily: 'var(--font-body)' }}>
                                                    <Check className="h-4 w-4 shrink-0 text-(--color-accent)" />
                                                    <span>{feature}</span>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                                            <div className="rounded-lg border border-(--color-accent) bg-(--color-secondary) px-3 py-2.5">
                                                <p className="text-[10px] uppercase tracking-wide text-(--color-accent) font-medium" style={{ fontFamily: 'var(--font-ui)' }}>Renewal Date</p>
                                                <p className="text-sm text-(--color-background) mt-1" style={{ fontFamily: 'var(--font-body)' }}>
                                                    {billingInfo.renewalDate ? `Next billing: ${new Date(billingInfo.renewalDate).toLocaleDateString()}` : 'Not scheduled yet'}
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-(--color-accent) bg-(--color-secondary) px-3 py-2.5">
                                                <p className="text-[10px] uppercase tracking-wide text-(--color-accent) font-medium" style={{ fontFamily: 'var(--font-ui)' }}>Payment Method</p>
                                                <div className="mt-1 flex items-center gap-2 text-(--color-background)">
                                                    {billingInfo.paymentMethod ? (
                                                        <>
                                                            <span className="inline-flex items-center justify-center rounded-md border border-(--color-accent) bg-(--color-primary) px-2 py-0.5 text-[10px] font-medium min-w-9" style={{ fontFamily: 'var(--font-ui)' }}>
                                                                {String(billingInfo.paymentMethod.brand || 'card').toUpperCase()}
                                                            </span>
                                                            <span className="text-sm" style={{ fontFamily: 'var(--font-body)' }}>**** {billingInfo.paymentMethod.last4}</span>
                                                        </>
                                                    ) : (
                                                        <span className="text-sm" style={{ fontFamily: 'var(--font-body)' }}>No payment method on file</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex flex-wrap items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => navigate('/billing/plans')}
                                                className="inline-flex items-center justify-center rounded-lg bg-(--color-cta-secondary) px-4 py-2 text-sm font-medium text-(--color-background) transition-colors hover:bg-(--color-cta-primary)"
                                            >
                                                Upgrade Plan
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => navigate('/billing/manage')}
                                                className="inline-flex items-center justify-center rounded-lg border border-(--color-accent) bg-(--color-primary) px-4 py-2 text-sm font-medium text-(--color-accent) transition-colors hover:bg-(--color-secondary)"
                                                style={{ fontFamily: 'var(--font-ui)' }}
                                            >
                                                Manage Billing
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="space-y-4 border border-(--color-card-border) rounded-xl p-5 shadow-sm bg-white">
                                            <h3 className="text-base font-bold text-(--color-text-primary)">Usage Metrics</h3>
                                            <ProgressBar label="Users" current={billingInfo.usage.usersUsed || orgData._count?.users || 0} max={billingInfo.usage.usersTotal || orgData.maxUsers} />
                                            <ProgressBar label="Mailboxes" current={billingInfo.usage.mailboxesUsed || orgData._count?.mailboxes || 0} max={billingInfo.usage.mailboxesTotal || orgData.maxMailboxes} />
                                            <ProgressBar label="Storage" current={billingInfo.usage.storageUsedGb || 0} max={billingInfo.usage.storageTotalGb || orgData.maxStorageGb} unit="GB" />
                                        </div>
                                    </div>
                                </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'notifications' && (
                            <div className="space-y-6 animate-in fade-in">
                                <div className="border-b border-(--color-card-border) pb-4">
                                    <h3 className="text-lg font-bold text-(--color-text-primary)">Notification Settings</h3>
                                    <p className="text-sm text-(--color-text-muted)">Control org-level notification types, allowed channels, and defaults applied to users.</p>
                                </div>

                                {orgNotificationLoading ? (
                                    <div className="space-y-3">
                                        {Array.from({ length: orgNotificationSkeletonRows }, (_, index) => (
                                            <div key={index} className="rounded-xl border border-(--color-card-border) bg-white p-4">
                                                <div className="h-4 w-40 rounded bg-(--color-background) animate-pulse" />
                                                <div className="mt-2 h-3 w-72 rounded bg-(--color-background) animate-pulse" />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {Object.entries(orgNotificationSettings).map(([type, setting]) => (
                                            <div key={type} className="rounded-xl border border-(--color-card-border) bg-white p-4 space-y-3 shadow-(--shadow-sm)">
                                                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                                    <div>
                                                        <div className="text-sm font-semibold text-(--color-text-primary)">{type.replace(/_/g, ' ')}</div>
                                                        <div className="mt-1 text-xs text-(--color-text-muted)">Allowed channels and default config for this notification type.</div>
                                                    </div>
                                                    <label className="flex items-center gap-2 text-xs text-(--color-text-primary)">
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(setting?.enabled)}
                                                            onChange={(event) => setOrgNotificationSettings((prev) => ({ ...prev, [type]: { ...prev[type], enabled: event.target.checked } }))}
                                                            className="w-4 h-4 rounded border-(--color-card-border)"
                                                        />
                                                        Enabled
                                                    </label>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                                    {['in_app', 'email', 'push', 'desktop'].map((channel) => (
                                                        <label key={channel} className="flex items-center gap-2 text-xs text-(--color-text-primary)">
                                                            <input
                                                                type="checkbox"
                                                                checked={Boolean(setting?.channels?.[channel])}
                                                                onChange={(event) => setOrgNotificationSettings((prev) => ({
                                                                    ...prev,
                                                                    [type]: {
                                                                        ...prev[type],
                                                                        channels: {
                                                                            ...(prev[type]?.channels || {}),
                                                                            [channel]: event.target.checked,
                                                                        },
                                                                    },
                                                                }))}
                                                                className="w-4 h-4 rounded border-(--color-card-border)"
                                                            />
                                                            {channel.replace('_', ' ')}
                                                        </label>
                                                    ))}
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-(--color-text-muted) mb-1">Config JSON</label>
                                                    <textarea
                                                        value={JSON.stringify(setting?.config || {}, null, 2)}
                                                        onChange={(event) => {
                                                            try {
                                                                const next = JSON.parse(event.target.value || '{}');
                                                                setOrgNotificationSettings((prev) => ({ ...prev, [type]: { ...prev[type], config: next } }));
                                                            } catch {
                                                                // keep invalid draft out of state
                                                            }
                                                        }}
                                                        className="min-h-28 w-full rounded-lg border border-(--color-card-border) px-3 py-2 text-sm font-mono"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => saveOrganizationNotificationSettings()}
                                        disabled={orgNotificationSaving}
                                        className="inline-flex items-center justify-center rounded-lg bg-(--color-cta-primary) px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-(--color-cta-secondary) disabled:opacity-60"
                                    >
                                        {orgNotificationSaving ? 'Saving...' : 'Save Notification Settings'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'audit' && (
                            <div className="space-y-6 animate-in fade-in">
                                <div className="border-b border-(--color-card-border) pb-4">
                                    <h3 className="text-lg font-bold text-(--color-text-primary)">Audit & Security</h3>
                                    <p className="text-sm text-(--color-text-muted)">Review organization activity and manage security enforcement.</p>
                                </div>

                                <div className="rounded-2xl border border-(--color-card-border) bg-(--color-background)/35 p-2">
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setAuditSubTab('audit')}
                                            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border transition-colors ${auditSubTab === 'audit'
                                                ? 'bg-white border-(--color-card-border) text-(--color-text-primary) shadow-sm'
                                                : 'border-transparent text-(--color-text-muted) hover:bg-white/60'}`}
                                        >
                                            <ScrollText className="w-4 h-4 shrink-0" />
                                            Audit
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAuditSubTab('security')}
                                            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border transition-colors ${auditSubTab === 'security'
                                                ? 'bg-white border-(--color-card-border) text-(--color-text-primary) shadow-sm'
                                                : 'border-transparent text-(--color-text-muted) hover:bg-white/60'}`}
                                        >
                                            <ShieldQuestion className="w-4 h-4 shrink-0" />
                                            Security
                                        </button>
                                    </div>
                                </div>

                                {auditSubTab === 'audit' && (
                                    <div className="space-y-4">
                                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                            <div className="relative flex-1 max-w-md">
                                                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-(--color-text-muted)" />
                                                <input
                                                    type="text"
                                                    placeholder="Search action, entity, user, or summary..."
                                                    value={auditSearch}
                                                    onChange={(e) => setAuditSearch(e.target.value)}
                                                    className="w-full pl-9 pr-3 py-2 text-sm border border-(--color-card-border) rounded-lg focus:ring-2 focus:ring-(--color-primary)/20 bg-white"
                                                />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Filter className="w-4 h-4 text-(--color-text-muted)" />
                                                <select
                                                    value={auditEntityFilter}
                                                    onChange={(e) => setAuditEntityFilter(e.target.value)}
                                                    className="px-3 py-2 text-sm border border-(--color-card-border) rounded-lg bg-white focus:ring-2 focus:ring-(--color-primary)/20"
                                                >
                                                    <option value="all">All entities</option>
                                                    {auditEntityOptions.map((entity) => (
                                                        <option key={entity.value} value={entity.value}>{entity.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        <div className="rounded-xl border border-(--color-card-border) bg-(--color-background)/35 px-4 py-3 text-xs text-(--color-text-muted)">
                                            Keep the list concise here. Use <span className="font-semibold text-(--color-text-primary)">View details</span> on any row to inspect full previous/new values and metadata.
                                        </div>

                                        {/* Mobile: card list */}
                                        <div className="md:hidden space-y-2">
                                            {auditLoading ? (
                                                <div className="bg-white rounded-xl border border-(--color-card-border) px-4 py-10 text-center text-sm text-(--color-text-muted)">
                                                    Loading audit logs...
                                                </div>
                                            ) : filteredAuditLogs.length === 0 ? (
                                                <div className="bg-white rounded-xl border border-(--color-card-border) px-4 py-10 text-center text-sm text-(--color-text-muted)">
                                                    No audit logs found for the selected filters.
                                                </div>
                                            ) : filteredAuditLogs.map(({ log, actionLabel, entityLabel, userLabel, summary }) => (
                                                <div key={log.id} className="bg-white rounded-xl border border-(--color-card-border) p-4 space-y-2.5">
                                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <StatusBadge label={actionLabel} variant={auditActionVariant[log.action] || 'neutral'} />
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedAuditLog({ log, actionLabel, entityLabel, userLabel, summary })}
                                                            className="text-xs font-medium text-(--color-cta-primary) hover:underline"
                                                        >
                                                            View details
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-1 gap-1.5 text-xs text-(--color-text-muted)">
                                                        <div><span className="font-semibold text-(--color-text-primary)">Entity:</span> {entityLabel}</div>
                                                        <div><span className="font-semibold text-(--color-text-primary)">User:</span> {userLabel}</div>
                                                        <div><span className="font-semibold text-(--color-text-primary)">Change:</span> {summary}</div>
                                                        <div><span className="font-semibold text-(--color-text-primary)">Time:</span> {new Date(log.createdAt).toLocaleString()}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Desktop: table */}
                                        <div className="hidden md:block bg-white rounded-xl border border-(--color-card-border) shadow-(--shadow-sm) overflow-hidden">
                                            <div className="overflow-x-auto">
                                                <table className="w-full table-auto text-left">
                                                    <thead>
                                                        <tr className="border-b border-(--color-card-border)">
                                                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-(--color-text-muted) bg-(--color-background)/40 whitespace-nowrap">Action</th>
                                                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-(--color-text-muted) bg-(--color-background)/40">Entity</th>
                                                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-(--color-text-muted) bg-(--color-background)/40">User</th>
                                                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-(--color-text-muted) bg-(--color-background)/40">Change</th>
                                                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-(--color-text-muted) bg-(--color-background)/40 whitespace-nowrap">Timestamp</th>
                                                            <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wider text-(--color-text-muted) bg-(--color-background)/40 text-right">Details</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-(--color-card-border)">
                                                        {filteredAuditLogs.map(({ log, actionLabel, entityLabel, userLabel, summary }) => (
                                                            <tr key={log.id} className="hover:bg-(--color-background)/30">
                                                                <td className="px-3 py-3 align-top">
                                                                    <StatusBadge label={actionLabel} variant={auditActionVariant[log.action] || 'neutral'} />
                                                                </td>
                                                                <td className="px-3 py-3 text-sm text-(--color-text-muted) align-top whitespace-nowrap">{entityLabel}</td>
                                                                <td className="px-3 py-3 text-xs text-(--color-text-muted) align-top whitespace-nowrap">{userLabel}</td>
                                                                <td className="px-3 py-3 text-xs text-(--color-text-primary) align-top max-w-[480px]">{summary}</td>
                                                                <td className="px-3 py-3 text-xs text-(--color-text-muted) whitespace-nowrap align-top">
                                                                    <div>{new Date(log.createdAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                                                    <div className="text-[10px] text-(--color-text-muted)/80 mt-0.5">{relativeTime(new Date(log.createdAt))}</div>
                                                                </td>
                                                                <td className="px-3 py-3 text-right align-top">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setSelectedAuditLog({ log, actionLabel, entityLabel, userLabel, summary })}
                                                                        className="text-xs font-medium text-(--color-cta-primary) hover:underline"
                                                                    >
                                                                        View details
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                        {!auditLoading && filteredAuditLogs.length === 0 && (
                                                            <tr>
                                                                <td colSpan={6} className="px-3 py-10 text-center text-sm text-(--color-text-muted)">
                                                                    No audit logs found for the selected filters.
                                                                </td>
                                                            </tr>
                                                        )}
                                                        {auditLoading && (
                                                            <tr>
                                                                <td colSpan={6} className="px-3 py-10 text-center text-sm text-(--color-text-muted)">
                                                                    Loading audit logs...
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {auditSubTab === 'security' && (
                                    <div className="space-y-4">
                                        <div className="rounded-2xl border border-(--color-card-border) bg-white p-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
                                            <div>
                                                <h4 className="text-base font-bold text-(--color-text-primary)">Enforce MFA for Organization</h4>
                                                <p className="text-sm text-(--color-text-muted) mt-1">
                                                    When enabled, users without MFA will see an MFA-required gate before accessing protected pages.
                                                </p>
                                                <p className="text-xs text-(--color-text-muted) mt-2">
                                                    Invite acceptance remains available. Users must enable TOTP (Google Authenticator compatible) after sign in.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => savePartial({ enforceMfa: !orgData.enforceMfa })}
                                                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 ${orgData.enforceMfa
                                                    ? 'bg-(--color-cta-primary)'
                                                    : 'bg-(--color-accent)/30 hover:bg-(--color-accent)/80'}`}
                                                aria-pressed={Boolean(orgData.enforceMfa)}
                                                aria-label="Toggle enforce MFA"
                                            >
                                                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${orgData.enforceMfa ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </div>

                                        <div className={`rounded-2xl border p-4 ${orgData.enforceMfa ? 'border-emerald-200 bg-emerald-50' : 'border-(--color-card-border) bg-(--color-background)/35'}`}>
                                            <div className="text-sm font-semibold text-(--color-text-primary)">
                                                {orgData.enforceMfa ? 'MFA enforcement is ON' : 'MFA enforcement is OFF'}
                                            </div>
                                            <p className="text-sm text-(--color-text-muted) mt-1">
                                                {orgData.enforceMfa
                                                    ? 'Users without MFA must first enable MFA before accessing most application pages.'
                                                    : 'Users can access pages without MFA and may enable MFA later from User Settings.'}
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Phase 2: Workspace Configurations - hidden for Phase 1 */}
                    </div>
                </div>
            </div>

            <Modal
                isOpen={Boolean(selectedAuditLog)}
                onClose={() => setSelectedAuditLog(null)}
                title={selectedAuditLog ? `Audit Details - ${selectedAuditLog.actionLabel}` : 'Audit Details'}
                size="lg"
            >
                {selectedAuditLog && (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-(--color-card-border) bg-(--color-background)/35 p-4">
                            <div className="text-sm font-semibold text-(--color-text-primary)">Summary</div>
                            <p className="mt-1 text-sm text-(--color-text-muted)">{selectedAuditLog.summary}</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <div className="rounded-lg border border-(--color-card-border) bg-white p-3">
                                <div className="text-xs uppercase tracking-wide text-(--color-text-muted)">Entity</div>
                                <div className="font-medium text-(--color-text-primary)">{selectedAuditLog.entityLabel}</div>
                            </div>
                            <div className="rounded-lg border border-(--color-card-border) bg-white p-3">
                                <div className="text-xs uppercase tracking-wide text-(--color-text-muted)">Entity ID</div>
                                <div className="font-medium text-(--color-text-primary) break-all">{selectedAuditLog.log.entityId || '--'}</div>
                            </div>
                            <div className="rounded-lg border border-(--color-card-border) bg-white p-3">
                                <div className="text-xs uppercase tracking-wide text-(--color-text-muted)">User</div>
                                <div className="font-medium text-(--color-text-primary)">{selectedAuditLog.userLabel}</div>
                                <div className="text-xs text-(--color-text-muted) mt-0.5 break-all">{selectedAuditLog.log.userId || '--'}</div>
                            </div>
                            <div className="rounded-lg border border-(--color-card-border) bg-white p-3">
                                <div className="text-xs uppercase tracking-wide text-(--color-text-muted)">Request</div>
                                <div className="font-medium text-(--color-text-primary)">{selectedAuditLog.log.ipAddress || '--'}</div>
                                <div className="text-xs text-(--color-text-muted) mt-0.5 break-all">{selectedAuditLog.log.userAgent || '--'}</div>
                            </div>
                            <div className="rounded-lg border border-(--color-card-border) bg-white p-3 sm:col-span-2">
                                <div className="text-xs uppercase tracking-wide text-(--color-text-muted)">Timestamp</div>
                                <div className="font-medium text-(--color-text-primary)">{new Date(selectedAuditLog.log.createdAt).toLocaleString()}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="rounded-xl border border-(--color-card-border) bg-white p-4">
                                <div className="text-sm font-semibold text-(--color-text-primary) mb-2">Previous Value</div>
                                <div className="space-y-1.5">
                                    {(auditPayloadLines(selectedAuditLog.log.previousValue).length
                                        ? auditPayloadLines(selectedAuditLog.log.previousValue)
                                        : ['--']).map((line, index) => (
                                        <p key={`prev-${index}`} className="text-xs text-(--color-text-muted) break-words">{line}</p>
                                    ))}
                                </div>
                            </div>
                            <div className="rounded-xl border border-(--color-card-border) bg-white p-4">
                                <div className="text-sm font-semibold text-(--color-text-primary) mb-2">New Value</div>
                                <div className="space-y-1.5">
                                    {(auditPayloadLines(selectedAuditLog.log.newValue).length
                                        ? auditPayloadLines(selectedAuditLog.log.newValue)
                                        : ['--']).map((line, index) => (
                                        <p key={`next-${index}`} className="text-xs text-(--color-text-muted) break-words">{line}</p>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            {pendingLogoFile && (
                <AvatarCropModal
                    file={pendingLogoFile}
                    onClose={() => setPendingLogoFile(null)}
                    onApply={(logoDataUrl) => {
                        savePartial({ logoUrl: logoDataUrl });
                        setPendingLogoFile(null);
                    }}
                />
            )}
            <InviteUserModal
                isOpen={showInviteUserModal}
                onClose={() => setShowInviteUserModal(false)}
                onInvite={handleInviteUser}
            />
            <EditUserModal
                isOpen={showEditUserModal}
                onClose={() => { setShowEditUserModal(false); setEditingUser(null); }}
                user={editingUser}
                allowedRoles={allowedRolesForTarget(editingUser)}
                onSave={async (updated) => {
                    try {
                        const res = await api.patch(`/users/${updated.id}`, updated);
                        setLocalUsers(prev => sortUsersByRole(prev.map(u => u.id === updated.id ? res.data : u)));
                    } catch (err) {
                        console.error('Failed to update user:', err);
                    }
                }}
            />
            <SoftDeleteModal
                isOpen={showDeleteModal}
                onClose={() => { setShowDeleteModal(false); setDeletingUser(null); }}
                userName={deletingUser?.fullName || ''}
                onConfirm={async () => {
                    if (deletingUser) {
                        try {
                            const res = await api.patch(`/users/${deletingUser.id}`, { isActive: false });
                            setLocalUsers(prev => sortUsersByRole(prev.map(u => u.id === deletingUser.id ? res.data : u)));
                            setShowDeleteModal(false);
                            setDeletingUser(null);
                        } catch (err) {
                            console.error('Failed to deactivate user:', err);
                        }
                    }
                }}
            />
            <UpgradeBlockerModal
                isOpen={showUpgradeBlocker}
                onClose={() => setShowUpgradeBlocker(false)}
                resourceName="users"
            />
            <TeamModal
                isOpen={showTeamModal}
                onClose={() => { setShowTeamModal(false); setEditingTeam(null); }}
                team={editingTeam}
                users={localUsers}
                onSave={(team) => {
                    setLocalTeams(prev => {
                        const exists = prev.some(t => t.id === team.id);
                        if (exists) return prev.map(t => (t.id === team.id ? team : t));
                        return [...prev, team];
                    });
                }}
            />
            <DeleteMailboxModal
                isOpen={showDeleteMailboxModal}
                onClose={() => {
                    if (deletingMailboxPending) return;
                    setShowDeleteMailboxModal(false);
                    setDeletingMailbox(null);
                }}
                mailboxName={deletingMailbox?.name || ''}
                onConfirm={confirmDeleteMailbox}
                isSubmitting={deletingMailboxPending}
            />
            <MailboxHealthModal
                isOpen={showHealthModal}
                onClose={() => { setShowHealthModal(false); setHealthMailbox(null); }}
                mailbox={healthMailbox}
            />
            <MailboxFoldersModal
                isOpen={showFoldersModal}
                onClose={() => { setShowFoldersModal(false); setFoldersMailbox(null); }}
                mailbox={foldersMailbox}
            />
            <ConfirmDialog
                isOpen={Boolean(revokeInviteConfirm)}
                title="Revoke Invite"
                description={revokeInviteConfirm ? `Are you sure you want to revoke invite for "${revokeInviteConfirm.email}"?` : ''}
                confirmLabel="Revoke"
                isSubmitting={Boolean(revokeInviteConfirm && revokingInviteId === revokeInviteConfirm.id)}
                onCancel={() => setRevokeInviteConfirm(null)}
                onConfirm={() => {
                    if (revokeInviteConfirm) {
                        void handleRevokeInvite(revokeInviteConfirm);
                    }
                }}
            />

            {/* Sync success toast */}
            {syncToastMessage && (
                <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg animate-in slide-in-from-bottom-2">
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                    <span className="text-sm font-medium">{syncToastMessage}</span>
                    <button onClick={() => setSyncToastMessage(null)} className="ml-2 text-white/70 hover:text-white">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
};

/* --- Sub-components --- */

const SectionTitle: React.FC<{ children: React.ReactNode; noMargin?: boolean }> = ({ children, noMargin }) => (
    <h5 className={`text-xs font-semibold text-(--color-text-muted) uppercase tracking-wider ${noMargin ? '' : 'mb-2'}`}>{children}</h5>
);

const SaveButton: React.FC<{ onClick: () => void; saved?: boolean; loading?: boolean }> = ({ onClick, saved = false, loading = false }) => (
    <div className="pt-4 mt-6 flex justify-end">
        <button
            onClick={onClick}
            disabled={loading || saved}
            className={`inline-flex items-center px-5 py-2.5 text-sm font-medium text-white rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-(--color-cta-primary) disabled:opacity-70 disabled:cursor-not-allowed ${saved
                ? 'bg-emerald-600 hover:bg-emerald-600'
                : 'bg-(--color-cta-primary) hover:bg-(--color-cta-secondary)'}`}
        >
            {loading ? (
                <svg className="animate-spin w-4 h-4 mr-2 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
            ) : saved ? <Check className="w-4 h-4 mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            {loading ? 'Saving...' : saved ? 'Applied' : 'Apply Changes'}
        </button>
    </div>
);

const LimitRow: React.FC<{ label: string; current: number; max: number }> = ({ label, current, max }) => {
    const safeMax = Math.max(1, Number(max || 0));
    const pct = Math.min((current / safeMax) * 100, 100);
    return (
        <div className="rounded-xl border border-(--color-card-border) bg-(--color-background)/25 p-3">
            <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-medium text-(--color-text-primary)">{label}</span>
                <span className="text-xs text-(--color-text-muted)">{current} / {max || 0}</span>
            </div>
            <div className="h-2 rounded-full bg-white border border-(--color-card-border)/80 overflow-hidden">
                <div
                    className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-(--color-primary)'}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

const ProgressBar: React.FC<{ label: string; current: number; max: number; unit?: string }> = ({ label, current, max, unit = '' }) => {
    const safeMax = Math.max(1, Number(max || 0));
    const pct = Math.min((current / safeMax) * 100, 100);
    return (
        <div className="space-y-1.5">
            <div className="flex justify-between text-sm font-medium">
                <span className="text-(--color-text-primary)">{label}</span>
                <span className="text-(--color-text-muted)">{current} / {max} {unit}</span>
            </div>
            <div className="w-full bg-(--color-background) rounded-full h-2.5 overflow-hidden border border-(--color-card-border)/50">
                <div className={`h-full rounded-full transition-all duration-500 ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-(--color-primary)'}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

export default SettingsPage;

