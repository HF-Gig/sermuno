import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import api, { resolveAvatarUrl } from '../../../lib/api';
import { hasPermission } from '../../../hooks/usePermission';
import { useWebSocket } from '../../../context/WebSocketContext';
import { useAuth } from '../../../context/AuthContext';
import StatusBadge from '../../../components/ui/StatusBadge';
import ComposeDrawer from '../../../components/compose/ComposeDrawer';
import SaasCalendarPicker from '../../../components/ui/SaasCalendarPicker';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { InboxThreadListSkeleton } from '../../../components/skeletons/InboxThreadListSkeleton';
import { ThreadDetailSkeleton } from '../../../components/skeletons/ThreadDetailSkeleton';
import {
    Inbox as InboxIcon, SendHorizontal, User, ChevronDown,
    Clock, AlertCircle, Search, Tag, Hash,
    FileText, Paperclip, Type, Reply, FileSignature,
    CheckCircle2, Archive, Trash2,
    MoreHorizontal, Users, EyeOff, Star,
    ArrowLeft, Check, Plus, X, Loader2, Columns2, ChevronLeft, ChevronRight
} from 'lucide-react';
import { clsx } from 'clsx';

const statusMap: Record<string, { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' }> = {
    new: { label: 'New', variant: 'info' },
    in_progress: { label: 'In Progress', variant: 'warning' },
    waiting: { label: 'Waiting', variant: 'neutral' },
    resolved: { label: 'Resolved', variant: 'success' },
    archived: { label: 'Archived', variant: 'error' },
    open: { label: 'New', variant: 'info' },
    pending: { label: 'Waiting', variant: 'neutral' },
    closed: { label: 'Resolved', variant: 'success' },
};

const apiStatusToUiStatus = (status?: string | null, assignedUserId?: string | null) => {
    switch (String(status || '').toUpperCase()) {
        case 'OPEN': return assignedUserId ? 'in_progress' : 'new';
        case 'PENDING': return 'waiting';
        case 'SNOOZED': return 'waiting';
        case 'CLOSED': return 'resolved';
        case 'ARCHIVED': return 'archived';
        case 'TRASH': return 'archived';
        case 'NEW':
        default:
            return 'new';
    }
};

const uiStatusToApiStatus = (status?: string | null) => {
    switch (String(status || '').toLowerCase()) {
        case 'in_progress':
        case 'open':
            return 'OPEN';
        case 'waiting':
        case 'pending':
            return 'PENDING';
        case 'resolved':
        case 'done':
        case 'closed':
            return 'CLOSED';
        case 'archived':
            return 'ARCHIVED';
        case 'new':
        default:
            return 'NEW';
    }
};

const sanitizeEmailHtml = (html: string) => {
    if (!html) return '';

    const noStyles = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<link[^>]*>/gi, '');

    return noStyles.replace(/<img\b([^>]*?)\bsrc=(['"])(.*?)\2([^>]*)>/gi, (match, before, quote, src, after) => {
        const normalizedSrc = String(src || '').trim();
        const isAllowed = /^(https?:|data:|blob:|\/)/i.test(normalizedSrc);
        return isAllowed ? match : '';
    });
};

const decodeQuotedPrintable = (value: string) => {
    if (!value) return '';
    const joined = value.replace(/=\r?\n/g, '');
    return joined.replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
};

const decodeHtmlEntities = (value: string) => {
    if (!value || typeof window === 'undefined') return value;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
};

const extractMimePart = (raw: string, contentType: 'text/html' | 'text/plain') => {
    const pattern = new RegExp(
        `Content-Type:\\s*${contentType.replace('/', '\\/')}[\\s\\S]*?(?:\\r?\\n){2}([\\s\\S]*?)(?=\\r?\\n--|$)`,
        'i'
    );
    const match = raw.match(pattern);
    return match?.[1]?.trim() || '';
};

const normalizeMessageBody = (bodyHtml?: string, bodyText?: string) => {
    if (bodyHtml && bodyHtml.trim()) {
        return sanitizeEmailHtml(bodyHtml);
    }

    const raw = String(bodyText || '');
    const looksLikeMime = /content-type:\s*multipart\//i.test(raw) || /content-transfer-encoding:\s*quoted-printable/i.test(raw);

    if (!looksLikeMime) {
        return raw.replace(/\n/g, '<br/>');
    }

    const rawHtmlPart = extractMimePart(raw, 'text/html');
    if (rawHtmlPart) {
        const decodedHtml = decodeHtmlEntities(decodeQuotedPrintable(rawHtmlPart));
        return sanitizeEmailHtml(decodedHtml);
    }

    const rawTextPart = extractMimePart(raw, 'text/plain');
    if (rawTextPart) {
        return decodeHtmlEntities(decodeQuotedPrintable(rawTextPart)).replace(/\n/g, '<br/>');
    }

    return decodeHtmlEntities(decodeQuotedPrintable(raw)).replace(/\n/g, '<br/>');
};

const formatSize = (bytes?: number) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const normalizeAddressList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    return input
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
};

const resolveFolderType = (name: string): FolderNavType | null => {
    const normalized = String(name || '').toLowerCase();
    if (normalized === '[gmail]' || normalized.includes('all mail') || normalized.includes('starred')) return null;
    if (normalized === 'inbox' || normalized.includes('/inbox')) return 'inbox';
    if (normalized.includes('sent')) return 'sent';
    if (normalized.includes('draft')) return 'drafts';
    if (normalized.includes('spam')) return 'spam';
    if (normalized.includes('trash')) return 'trash';
    return 'custom';
};

type SidebarFilterItem = {
    id: string;
    label: string;
    icon: React.FC<{ className?: string }>;
};

const globalItems: SidebarFilterItem[] = [
    { id: 'all', label: 'All Inboxes', icon: InboxIcon },
    { id: 'my-threads', label: 'My Threads', icon: User },
    { id: 'unassigned', label: 'Unassigned', icon: Users },
    { id: 'team-inbox', label: 'Team Inbox', icon: Users },
];

const quickFilters: SidebarFilterItem[] = [
    { id: 'priority-high', label: 'High', icon: AlertCircle },
    { id: 'priority-normal', label: 'Normal', icon: Clock },
    { id: 'priority-low', label: 'Low', icon: CheckCircle2 },
    { id: 'sla-at-risk', label: 'SLA At Risk', icon: AlertCircle },
    { id: 'sla-breached', label: 'SLA Breached', icon: AlertCircle },
];

const statusFilterOptions = ['All', 'new', 'open', 'pending', 'closed'];
const replyAfterSendOptions: Array<{ value: ScheduledStatePreset; label: string }> = [
    { value: 'no_change', label: 'No change' },
    { value: 'new', label: 'New' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'waiting', label: 'Waiting' },
    { value: 'resolved', label: 'Resolved' },
];

/* ---- Thread type options (for filter) ---- */
const threadTypes = ['All', 'Return', 'Cancellation', 'Pre-sales', 'Support', 'Billing'];

type FolderNavType = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | 'custom';

const folderOrder: FolderNavType[] = ['inbox', 'sent', 'drafts', 'spam', 'trash'];

const folderIcons: Record<FolderNavType, React.FC<{ className?: string }>> = {
    inbox: InboxIcon,
    sent: SendHorizontal,
    drafts: FileText,
    spam: AlertCircle,
    trash: Trash2,
    custom: Hash,
};

const folderLabelByType: Record<FolderNavType, string> = {
    inbox: 'Inbox',
    sent: 'Sent',
    drafts: 'Drafts',
    spam: 'Spam',
    trash: 'Trash',
    custom: 'Custom',
};

type SidebarItemKind = 'folder' | 'filter' | 'tag';
type AssigneeOption = { id: string; label: string; type: 'user' | 'team' };
type RecurrencePreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
type ScheduledStatePreset = 'no_change' | 'new' | 'in_progress' | 'waiting' | 'resolved';
type MailboxNavItem = { id: string; name: string; email: string; unreadCount: number; provider?: string };
type MentionedUser = {
    id: string;
    fullName: string;
    email: string;
    avatarUrl?: string | null;
    mentionKey: string;
};
type InternalNote = {
    id: string;
    body: string;
    createdAt: string;
    user?: { id?: string; fullName?: string; email?: string; avatarUrl?: string | null };
    mentionedUsers?: MentionedUser[];
};

type SidebarCounts = {
    [id: string]: number;
};

const getProviderKey = (provider?: string | null): 'gmail' | 'microsoft' | 'smtp' => {
    const normalized = String(provider || '').trim().toUpperCase();
    if (normalized === 'GMAIL' || normalized === 'GOOGLE') return 'gmail';
    if (normalized === 'OUTLOOK' || normalized === 'MICROSOFT' || normalized === 'OFFICE365' || normalized === 'EXCHANGE') return 'microsoft';
    return 'smtp';
};

const weekdayByIndex = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const uuidLikePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toThreadRouteCode = (threadId: string): string => {
    const base = String(threadId || '').replace(/^t/, '');
    if (!base) return '0';
    let hash = 0;
    for (let i = 0; i < base.length; i += 1) {
        hash = (hash * 31 + base.charCodeAt(i)) % 1000000;
    }
    return String(hash).padStart(6, '0');
};

const normalizeThreadApiId = (threadId: string): string => {
    const raw = String(threadId || '').trim();
    if (/^t\d+$/.test(raw)) {
        return raw.slice(1);
    }
    return raw;
};

const emptySidebarCounts: SidebarCounts = {};

const buildRrule = (preset: RecurrencePreset, scheduledFor: Date | null) => {
    if (!scheduledFor || preset === 'none') return null;

    if (preset === 'daily') return 'FREQ=DAILY;INTERVAL=1';
    if (preset === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;INTERVAL=1';
    if (preset === 'weekly') {
        const weekday = weekdayByIndex[scheduledFor.getDay()] || 'MO';
        return `FREQ=WEEKLY;BYDAY=${weekday};INTERVAL=1`;
    }
    const dayOfMonth = Math.min(31, Math.max(1, scheduledFor.getDate()));
    return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth};INTERVAL=1`;
};

/* ================================================================ */
const InboxPage: React.FC = () => {
    const { filter, threadId } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { socket, isConnected } = useWebSocket();
    const { user, loading: authLoading } = useAuth();
    const canViewUsers = hasPermission(user?.permissions, 'users:view');
    const canViewTeams = hasPermission(user?.permissions, 'teams:view');

    const [activeFilter, setActiveFilter] = useState(filter || 'all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedType, setSelectedType] = useState('All');
    const [activeMailboxId, setActiveMailboxId] = useState<string>('');
    const [mailboxes, setMailboxes] = useState<MailboxNavItem[]>([]);
    const [mailboxDerivedCounts, setMailboxDerivedCounts] = useState<{ starred: number; archive: number }>({ starred: 0, archive: 0 });
    const [mailboxFolders, setMailboxFolders] = useState<Array<{ id: string; name: string; unreadCount?: number; type: FolderNavType }>>([]);
    const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([]);
    const [activeFolderId, setActiveFolderId] = useState<string>('');
    const [activeTagId, setActiveTagId] = useState<string | null>(null);
    const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
    const [activeSidebarItem, setActiveSidebarItem] = useState<{ kind: SidebarItemKind, id: string }>(() => (
        filter
            ? { kind: 'filter', id: filter }
            : { kind: 'filter', id: 'all' }
    ));

    const [expandedFolders, setExpandedFolders] = useState(() => {
        try {
            return localStorage.getItem('inbox.sidebar.folders') !== '0';
        } catch {
            return true;
        }
    });
    const [expandedMore, setExpandedMore] = useState(() => {
        try {
            return localStorage.getItem('inbox.sidebar.quickFilters') !== '0';
        } catch {
            return true;
        }
    });
    const [expandedMailboxes, setExpandedMailboxes] = useState(() => {
        try {
            return localStorage.getItem('inbox.sidebar.mailboxes') !== '0';
        } catch {
            return true;
        }
    });
    const [expandedTags, setExpandedTags] = useState(() => {
        try {
            return localStorage.getItem('inbox.sidebar.tags') !== '0';
        } catch {
            return true;
        }
    });
    const [expandedStatus, setExpandedStatus] = useState(() => {
        try {
            return localStorage.getItem('inbox.sidebar.status') !== '0';
        } catch {
            return true;
        }
    });

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState<string>('All');

    const [localReplies, setLocalReplies] = useState<Record<string, any[]>>({});

    const [openDropdown, setOpenDropdown] = useState<string | null>(null);

    const ProviderLogo = ({ provider, className = 'w-4 h-4' }: { provider?: string; className?: string }) => {
        const providerKey = getProviderKey(provider);

        if (providerKey === 'gmail') {
            return (
                <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
                    <path fill="#EA4335" d="M3 7.5v9A2.5 2.5 0 0 0 5.5 19H7V10.4L3 7.5Z" />
                    <path fill="#4285F4" d="M17 19h1.5A2.5 2.5 0 0 0 21 16.5v-9l-4 2.9V19Z" />
                    <path fill="#34A853" d="M7 19h10V10.4l-5 3.6-5-3.6V19Z" />
                    <path fill="#FBBC04" d="M3 7.5 12 14l9-6.5V6.8A2.8 2.8 0 0 0 18.2 4H5.8A2.8 2.8 0 0 0 3 6.8v.7Z" />
                </svg>
            );
        }

        if (providerKey === 'microsoft') {
            return (
                <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
                    <rect x="3" y="3" width="8.2" height="8.2" fill="#F25022" />
                    <rect x="12.8" y="3" width="8.2" height="8.2" fill="#7FBA00" />
                    <rect x="3" y="12.8" width="8.2" height="8.2" fill="#00A4EF" />
                    <rect x="12.8" y="12.8" width="8.2" height="8.2" fill="#FFB900" />
                </svg>
            );
        }

        return (
            <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
                <path fill="#374151" d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Zm2.2.5L12 12.1 17.8 8a.7.7 0 0 0-.5-.2h-10.6a.7.7 0 0 0-.5.2Z" />
            </svg>
        );
    };

    const [threadOverrides, setThreadOverrides] = useState<Record<string, { status?: string, assignee?: string, tags?: string[], snoozeUntil?: string }>>({});

    const [isComposeOpen, setIsComposeOpen] = useState(false);

    const [isReplying, setIsReplying] = useState(false);
    const [replyError, setReplyError] = useState('');
    const [isReplyScheduleOpen, setIsReplyScheduleOpen] = useState(false);
    const [replyScheduledAt, setReplyScheduledAt] = useState<Date | null>(null);
    const [replyRecurrencePreset, setReplyRecurrencePreset] = useState<RecurrencePreset>('none');
    const [replyScheduledState, setReplyScheduledState] = useState<ScheduledStatePreset>('no_change');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const [isThreadLoading, setIsThreadLoading] = useState(false);
    const [isThreadListLoading, setIsThreadListLoading] = useState(false);
    const [showCustomSnoozeDatePicker, setShowCustomSnoozeDatePicker] = useState(false);
    const [customSnoozeDate, setCustomSnoozeDate] = useState<Date | null>(null);

    const [unreadCount, setUnreadCount] = useState(3);

    const [activeTab, setActiveTab] = useState<'notes' | 'activity'>('notes');
    const [internalNotes, setInternalNotes] = useState<InternalNote[]>([]);
    const [isAddingNote, setIsAddingNote] = useState(false);
    const [newNote, setNewNote] = useState('');
    const [noteError, setNoteError] = useState('');

    // Rich reply editor state
    const [replyEditorTab, setReplyEditorTab] = useState<'reply' | 'note'>('reply');
    const [replyHtml, setReplyHtml] = useState('');
    const [noteHtml, setNoteHtml] = useState('');
    const [showTemplateRow, setShowTemplateRow] = useState(false);
    const [isReplyExpanded, setIsReplyExpanded] = useState(false);
    const [replyTemplates, setReplyTemplates] = useState<{ id: string; name: string; bodyHtml: string }[]>([]);
    const [availableSignatures, setAvailableSignatures] = useState<Array<{ id: string; name: string; bodyHtml?: string; contentHtml?: string; mailboxId?: string | null; assignedMailboxIds?: string[] }>>([]);
    const [selectedSignatureId, setSelectedSignatureId] = useState<string>('');
    const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
    const [isSavingNote, setIsSavingNote] = useState(false);
    const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
    const [activityLog, setActivityLog] = useState<{ id: string, text: string, time: string }[]>([]);
    const [isPageLoading, setIsPageLoading] = useState(true);
    const [apiThreads, setApiThreads] = useState<any[]>([]);
    const [apiThreadMessages, setApiThreadMessages] = useState<any[]>([]);
    const [apiTags, setApiTags] = useState<any[]>([]);
    const [loadedThread, setLoadedThread] = useState<any>(null);
    const [sidebarCounts, setSidebarCounts] = useState<SidebarCounts>(emptySidebarCounts);
    const [hasAttachedMailbox, setHasAttachedMailbox] = useState<boolean | null>(null);

    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [isSplitMode, setIsSplitMode] = useState(true);
    const [isLg, setIsLg] = useState(() => window.innerWidth >= 1024);
    const [isXl, setIsXl] = useState(() => window.innerWidth >= 1280);
    const [mailboxDataVersion, setMailboxDataVersion] = useState(0);
    const [realtimeListVersion, setRealtimeListVersion] = useState(0);
    const hasLoadedOnceRef = useRef(false);

    const toThreadPath = useCallback((id: string) => {
        const rawId = String(id || '').replace(/^t/, '');
        return `/inbox/thread/${toThreadRouteCode(rawId)}?tid=${encodeURIComponent(rawId)}`;
    }, []);

    useEffect(() => {
        const mqLg = window.matchMedia('(min-width: 1024px)');
        const mqXl = window.matchMedia('(min-width: 1280px)');
        const sync = () => {
            setIsLg(mqLg.matches);
            setIsXl(mqXl.matches);
        };
        sync();
        mqLg.addEventListener('change', sync);
        mqXl.addEventListener('change', sync);
        return () => {
            mqLg.removeEventListener('change', sync);
            mqXl.removeEventListener('change', sync);
        };
    }, []);

    useEffect(() => {
        if (!isXl && isSplitMode) {
            setIsSplitMode(false);
        }
    }, [isSplitMode, isXl]);

    useEffect(() => {
        const handleMainSidebarOpen = (event: Event) => {
            const isOpen = Boolean((event as CustomEvent<boolean>).detail);
            if (isOpen) {
                setIsSplitMode(false);
            }
        };
        window.addEventListener('sermuno:main-sidebar-opened', handleMainSidebarOpen as EventListener);
        return () => window.removeEventListener('sermuno:main-sidebar-opened', handleMainSidebarOpen as EventListener);
    }, []);

    const detectedTimezone = useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch {
            return 'UTC';
        }
    }, []);

    const hasAccessToken = Boolean(localStorage.getItem('accessToken'));
    const canFetchProtectedData = !authLoading && hasAccessToken;

    // Auto-collapse sidebar when split mode is on
    useEffect(() => {
        window.dispatchEvent(new CustomEvent('sermuno:sidebar-collapse', { detail: isSplitMode }));
    }, [isSplitMode]);

    useEffect(() => {
        localStorage.setItem('inbox.sidebar.quickFilters', expandedMore ? '1' : '0');
    }, [expandedMore]);

    useEffect(() => {
        localStorage.setItem('inbox.sidebar.status', expandedStatus ? '1' : '0');
    }, [expandedStatus]);

    useEffect(() => {
        localStorage.setItem('inbox.sidebar.mailboxes', expandedMailboxes ? '1' : '0');
    }, [expandedMailboxes]);

    useEffect(() => {
        localStorage.setItem('inbox.sidebar.folders', expandedFolders ? '1' : '0');
    }, [expandedFolders]);

    useEffect(() => {
        localStorage.setItem('inbox.sidebar.tags', expandedTags ? '1' : '0');
    }, [expandedTags]);

    const [localMessages, setLocalMessages] = useState<any[]>([]);
    const lastFetchedFoldersMailboxIdRef = useRef<string | null>(null);
    const autoSyncTriggeredMailboxIdRef = useRef<string | null>(null);
    const realtimeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sidebarRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const apiThreadsRef = useRef<any[]>([]);

    useEffect(() => {
        apiThreadsRef.current = apiThreads;
    }, [apiThreads]);

    const baseThreads = useMemo(() => {
        return apiThreads;
    }, [apiThreads]);

    const overriddenMocks = useMemo(() => {
        return baseThreads.map(t => {
            const threadId = String(t.id);
            const normalizedId = threadId.startsWith('t') ? threadId.slice(1) : threadId;
            const override = threadOverrides[threadId] || threadOverrides[normalizedId] || threadOverrides[`t${normalizedId}`];
            if (!override) return t;
            return {
                ...t,
                status: override.status || t.status,
                assignedTo: override.assignee !== undefined ? override.assignee : t.assignedTo,
                tags: override.tags || t.tags,
                snoozeUntil: override.snoozeUntil
            };
        });
    }, [baseThreads, threadOverrides]);

    const seedThreadFolderById = useMemo(() => new Map<string, string>(), []);

    const folderItems = useMemo(() => {
        if (mailboxFolders.length > 0) {
            return mailboxFolders;
        }

        return [] as Array<{ id: string; name: string; unreadCount?: number; type: FolderNavType }>;
    }, [mailboxFolders]);

    const activeFolder = useMemo(
        () => folderItems.find(folder => folder.id === activeFolderId) ?? null,
        [folderItems, activeFolderId]
    );

    const navFolderItems = useMemo(
        () => folderItems,
        [folderItems]
    );

    const activeTagName = useMemo(
        () => apiTags.find((tag: any) => tag.id === activeTagId)?.name ?? null,
        [activeTagId, apiTags]
    );

    const organizationTags = useMemo(
        () => apiTags.filter((tag: any) => String(tag.scope || '').toLowerCase() !== 'personal'),
        [apiTags],
    );

    const personalTags = useMemo(
        () => apiTags.filter((tag: any) => String(tag.scope || '').toLowerCase() === 'personal'),
        [apiTags],
    );

    const activeMailbox = useMemo(
        () => mailboxes.find((mailbox) => String(mailbox.id) === String(activeMailboxId)) || null,
        [mailboxes, activeMailboxId],
    );

    const allFilterItems = useMemo(() => [...globalItems, ...quickFilters], []);

    const scheduleThreadListRefresh = useCallback(() => {
        if (!canFetchProtectedData) return;
        if (realtimeRefreshTimerRef.current) {
            clearTimeout(realtimeRefreshTimerRef.current);
        }

        realtimeRefreshTimerRef.current = setTimeout(() => {
            setRealtimeListVersion((prev) => prev + 1);
        }, 250);
    }, [canFetchProtectedData]);

    useEffect(() => {
        return () => {
            if (realtimeRefreshTimerRef.current) {
                clearTimeout(realtimeRefreshTimerRef.current);
            }
            if (sidebarRefreshTimerRef.current) {
                clearTimeout(sidebarRefreshTimerRef.current);
            }
        };
    }, []);

    /* Filtered threads */
    const threads = useMemo(() => {
        let list = [...overriddenMocks];

        if (activeSidebarItem.kind === 'folder') {
            if (activeFolder?.type === 'spam' || activeFolder?.type === 'trash') {
                list = list.filter(thread => thread.status === activeFolder.type);
            }
            // For regular folders (Inbox/Sent/Drafts), backend already filters by folderId.
            // Avoid re-filtering by latest message folder on client because that can hide
            // valid threads (e.g. sent threads where latest message moved to another folder).
        }

        if (activeSidebarItem.kind === 'tag' && activeTagName) {
            list = list.filter(thread => (thread.tags || []).includes(activeTagName));
        }

        if (!(activeSidebarItem.kind === 'filter' && activeSidebarItem.id === 'snoozed')) {
            list = list.filter(thread => !thread.snoozeUntil || new Date(thread.snoozeUntil) <= new Date());
        }

        if (selectedStatus !== 'All') {
            const normalizedStatus = selectedStatus.toLowerCase();
            list = list.filter(thread => {
                const threadStatus = String(thread.status || '').toLowerCase();
                if (normalizedStatus === 'open') return threadStatus === 'open' || threadStatus === 'in_progress';
                if (normalizedStatus === 'pending') return threadStatus === 'pending' || threadStatus === 'waiting';
                if (normalizedStatus === 'closed') return threadStatus === 'closed' || threadStatus === 'done';
                return threadStatus === normalizedStatus;
            });
        }

        if (searchTerm) {
            const term = searchTerm.toLowerCase();
            list = list.filter(t => t.subject.toLowerCase().includes(term) || t.from.toLowerCase().includes(term));
        }
        return list;
    }, [searchTerm, overriddenMocks, activeFolder, activeTagName, selectedStatus, activeSidebarItem]);

    const splitPanelLabel = 'Toggle Split View';

    const loadInboxCounts = useCallback(async () => {
        if (!canFetchProtectedData) return;

        const includeTagCounts = expandedTags || Boolean(activeTagId);

        try {
            const response = await api.get('/threads/counts/inbox', {
                params: {
                    ...(activeMailboxId ? { mailboxId: activeMailboxId } : {}),
                    includeTagCounts,
                },
            });

            const sidebar = response.data?.sidebar || {};
            const mailbox = response.data?.mailbox || {};

            setSidebarCounts({
                all: Number(sidebar.all || 0),
                'my-threads': Number(sidebar['my-threads'] || 0),
                unassigned: Number(sidebar.unassigned || 0),
                'team-inbox': Number(sidebar['team-inbox'] || 0),
                'priority-high': Number(sidebar['priority-high'] || 0),
                'priority-normal': Number(sidebar['priority-normal'] || 0),
                'priority-low': Number(sidebar['priority-low'] || 0),
                'sla-at-risk': Number(sidebar['sla-at-risk'] || 0),
                'sla-breached': Number(sidebar['sla-breached'] || 0),
            });

            setMailboxDerivedCounts({
                starred: Number(mailbox.starred || 0),
                archive: Number(mailbox.archive || 0),
            });

            if (includeTagCounts) {
                setTagCounts(response.data?.tags || {});
            }
        } catch (error) {
            console.error('Failed to load inbox counts:', error);
        }
    }, [activeMailboxId, canFetchProtectedData, expandedTags, activeTagId]);

    const resolvedRouteThreadId = useMemo(() => {
        const queryThreadId = searchParams.get('tid');
        if (queryThreadId) return queryThreadId;

        const routeThreadId = String(threadId || '').replace(/^t/, '');
        if (!routeThreadId) return '';
        if (uuidLikePattern.test(routeThreadId)) return routeThreadId;

        const matched = overriddenMocks.find((entry) => toThreadRouteCode(String(entry.id)) === routeThreadId);
        return matched ? String(matched.id).replace(/^t/, '') : '';
    }, [searchParams, threadId, overriddenMocks]);

    const openThread = resolvedRouteThreadId
        ? overriddenMocks.find(t => {
            const candidate = String(t.id);
            const normalizedCandidate = candidate.startsWith('t') ? candidate.slice(1) : candidate;
            return normalizedCandidate === resolvedRouteThreadId;
        }) || loadedThread || null
        : null;

    useEffect(() => {
        const fetchThreads = async () => {
            if (!canFetchProtectedData) {
                return [];
            }
            if (activeSidebarItem.kind === 'folder' && (!activeMailboxId || !activeFolderId)) {
                return [];
            }

            let url = '/threads';
            const params = new URLSearchParams();

            params.append('page', currentPage.toString());
            params.append('limit', '20');

            if (selectedStatus !== 'All') {
                params.append('status', selectedStatus.toUpperCase());
            }

            if (searchTerm.trim()) {
                params.append('search', searchTerm.trim());
            }

            if (activeMailboxId) {
                params.append('mailboxId', activeMailboxId);
            }
            if (activeSidebarItem.kind === 'folder' && activeFolderId) {
                params.append('folderId', activeFolderId);
            }
            if (activeSidebarItem.kind === 'folder' && activeFolder?.type) {
                params.append('folder', activeFolder.type);
            }

            if (activeSidebarItem.kind === 'tag' && activeTagId) {
                params.append('tagId', activeTagId);
            }

            if (activeSidebarItem.kind === 'filter') {
                switch (activeSidebarItem.id) {
                    case 'my-threads':
                        params.append('assigned', 'me');
                        break;
                    case 'unassigned':
                        params.append('assigned', 'unassigned');
                        break;
                    case 'team-inbox':
                        params.append('assigned', 'team');
                        break;
                    case 'priority-high':
                        params.append('priority', 'HIGH');
                        break;
                    case 'priority-normal':
                        params.append('priority', 'NORMAL');
                        break;
                    case 'priority-low':
                        params.append('priority', 'LOW');
                        break;
                    case 'sla-at-risk':
                        params.append('slaDue', 'soon');
                        break;
                    case 'sla-breached':
                        params.append('slaBreached', 'true');
                        break;
                    case 'mailbox-starred':
                        params.append('folder', 'starred');
                        break;
                    case 'mailbox-archive':
                        params.append('folder', 'archive');
                        break;
                    default:
                        break;
                }
            }

            if (params.toString()) {
                url += `?${params.toString()}`;
            }

            const res = await api.get(url);

            if (res.data.pagination) {
                setTotalPages(res.data.pagination.totalPages || 1);
            }

            return res.data.threads.map((t: any) => ({
                id: t.id,
                subject: t.subject || '(No Subject)',
                from: t.contact?.email || t.messages?.[0]?.fromEmail || 'unknown@example.com',
                assignedTo: t.assignedUser?.fullName || t.assignedTeam?.name || '',
                assignedToUserId: t.assignedUser?.id || null,
                assignedToTeamId: t.assignedTeam?.id || null,
                status: apiStatusToUiStatus(t.status, t.assignedUser?.id),
                tags: (t.tags || []).map((tt: any) => tt.tag?.name || ''),
                time: t.updatedAt || new Date().toISOString(),
                snippet: t.messages?.[0]?.bodyText?.substring(0, 100) || '',
                read: t.messages?.[0]?.isRead ?? true,
                unreadCount: t.messages?.[0]?.isRead === false ? 1 : 0,
                folderId: t.messages?.[0]?.folderId || seedThreadFolderById.get(String(t.id)) || 'f1',
                mailboxId: t.mailbox?.id || activeMailboxId,
                mailboxName: t.mailbox?.name || t.mailbox?.email || '',
                mailboxEmail: t.mailbox?.email || '',
                mailboxProvider: t.mailbox?.provider || '',
                starred: Boolean(t.starred),
                noteCount: Number(t?._count?.notes || 0),
                priority: String(t.priority || '').toLowerCase(),
                slaBreached: Boolean(t.slaBreached),
                firstResponseDueAt: t.firstResponseDueAt || null,
                resolutionDueAt: t.resolutionDueAt || null,
                assignedTeamName: t.assignedTeam?.name || '',
                snoozeUntil: t.snoozedUntil || null,
                contactName: t.contact?.name || t.contact?.fullName || '',
                companyName: t.company?.name || '',
            }));
        };

        const fetchTags = async () => {
            if (!canFetchProtectedData) {
                return [];
            }
            const res = await api.get('/tags');
            if (Array.isArray(res.data)) {
                return res.data;
            }
            return res.data.tags || [];
        };

        const fetchData = async () => {
            if (!canFetchProtectedData) {
                return;
            }
            if (activeSidebarItem.kind === 'folder' && (!activeMailboxId || !activeFolderId)) {
                return;
            }

            // Only show full-page loading once on first protected fetch.
            const showFullPageLoader = !hasLoadedOnceRef.current && apiThreads.length === 0;
            if (showFullPageLoader) {
                setIsPageLoading(true);
            } else if (isSplitMode) {
                setIsThreadListLoading(true);
            }
            try {
                const [threadsData, tagsData] = await Promise.all([fetchThreads(), fetchTags()]);
                setApiThreads(threadsData);
                setApiTags(tagsData);
                hasLoadedOnceRef.current = true;
            } catch (e) {
                console.error('Failed to load initial data:', e);
            } finally {
                if (showFullPageLoader) {
                    setIsPageLoading(false);
                } else if (isSplitMode) {
                    setIsThreadListLoading(false);
                }
            }
        };

        fetchData();
    }, [activeFolderId, activeFolder?.type, activeMailboxId, activeSidebarItem.kind, activeSidebarItem.id, activeTagId, selectedStatus, currentPage, seedThreadFolderById, isSplitMode, searchTerm, canFetchProtectedData, realtimeListVersion]);

    useEffect(() => {
        loadInboxCounts();
    }, [loadInboxCounts]);

    useEffect(() => {
        const fetchMailboxFolders = async () => {
            if (!canFetchProtectedData) {
                return;
            }
            try {
                const mailboxResponse = await api.get('/mailboxes');
                const availableMailboxes = Array.isArray(mailboxResponse.data) ? mailboxResponse.data : [];
                if (availableMailboxes.length === 0) {
                    setHasAttachedMailbox(false);
                    setMailboxes([]);
                    setMailboxFolders([]);
                    setActiveMailboxId('');
                    setActiveFolderId('');
                    lastFetchedFoldersMailboxIdRef.current = null;
                    return;
                }

                setHasAttachedMailbox(true);

                const unreadResponses = await Promise.allSettled(
                    availableMailboxes.map((mailbox: any) => api.get(`/mailboxes/${mailbox.id}/unread-count`)),
                );

                const nextMailboxes: MailboxNavItem[] = availableMailboxes.map((mailbox: any, index: number) => {
                    const unreadEntry = unreadResponses[index];
                    const unreadCount = unreadEntry?.status === 'fulfilled'
                        ? Number(unreadEntry.value?.data?.unreadCount || 0)
                        : 0;
                    return {
                        id: mailbox.id,
                        name: mailbox.name || mailbox.email || 'Mailbox',
                        email: mailbox.email || '',
                        unreadCount,
                        provider: String(mailbox.provider || '').toUpperCase(),
                    };
                });
                setMailboxes(nextMailboxes);

                const mailboxId = activeMailboxId || availableMailboxes[0].id;
                if (lastFetchedFoldersMailboxIdRef.current === mailboxId) {
                    return;
                }
                lastFetchedFoldersMailboxIdRef.current = mailboxId;
                setActiveMailboxId(mailboxId);
                const folderResponse = await api.get(`/mailboxes/${mailboxId}/folders`);
                const folders = Array.isArray(folderResponse.data) ? folderResponse.data : [];
                const canonicalFolders = new Map<FolderNavType, { id: string; name: string; unreadCount?: number; type: FolderNavType }>();
                const customFolders: Array<{ id: string; name: string; unreadCount?: number; type: FolderNavType }> = [];

                folders.forEach((folder: any) => {
                    const apiType = String(folder.type || '').toLowerCase();
                    const inferredType = resolveFolderType(folder.name);
                    const type = (apiType === 'inbox' || apiType === 'sent' || apiType === 'drafts' || apiType === 'spam' || apiType === 'trash')
                        ? (apiType as FolderNavType)
                        : inferredType;
                    if (!type) return;

                    if (type === 'custom') {
                        customFolders.push({
                            id: folder.id,
                            name: folder.name || 'Custom folder',
                            unreadCount: Number(folder.unreadCount || 0),
                            type: 'custom',
                        });
                        return;
                    }

                    if (canonicalFolders.has(type)) return;

                    canonicalFolders.set(type, {
                        id: folder.id,
                        name: folderLabelByType[type],
                        unreadCount: Number(folder.unreadCount || 0),
                        type,
                    });
                });

                const nextFolders = folderOrder
                    .filter((type) => canonicalFolders.has(type))
                    .map((type) => canonicalFolders.get(type)!)
                    .concat(customFolders);

                setMailboxFolders(nextFolders);
                if (nextFolders.length > 0 && !nextFolders.some((folder: any) => folder.id === activeFolderId)) {
                    setActiveFolderId(nextFolders[0].id);
                }
            } catch (error) {
                console.error('Failed to fetch mailbox folders:', error);
            }
        };

        fetchMailboxFolders();
    }, [activeMailboxId, activeFolderId, canFetchProtectedData, mailboxDataVersion]);

    useEffect(() => {
        if (!canFetchProtectedData) return;
        if (hasAttachedMailbox !== true) return;
        if (!activeMailboxId) return;
        if (isPageLoading || isThreadListLoading) return;
        if (apiThreads.length > 0) return;
        if (autoSyncTriggeredMailboxIdRef.current === activeMailboxId) return;

        autoSyncTriggeredMailboxIdRef.current = activeMailboxId;
        api.post(`/mailboxes/${activeMailboxId}/sync`).catch((err) => {
            console.error('Failed to trigger inbox auto-sync:', err);
        });
    }, [activeMailboxId, apiThreads.length, canFetchProtectedData, hasAttachedMailbox, isPageLoading, isThreadListLoading]);

    useEffect(() => {
        const fetchAssigneeOptions = async () => {
            if (!canFetchProtectedData) {
                return;
            }
            if (!canViewUsers && !canViewTeams) {
                setAssigneeOptions([]);
                return;
            }
            try {
                const [usersResponse, teamsResponse] = await Promise.all([
                    canViewUsers ? api.get('/users') : Promise.resolve({ data: [] }),
                    canViewTeams ? api.get('/teams') : Promise.resolve({ data: [] }),
                ]);
                const users = Array.isArray(usersResponse.data) ? usersResponse.data : [];
                const teams = Array.isArray(teamsResponse.data) ? teamsResponse.data : [];
                setAssigneeOptions([
                    ...users.map((entry: any) => ({ id: entry.id, label: entry.fullName, type: 'user' as const })),
                    ...teams.map((entry: any) => ({ id: entry.id, label: entry.name, type: 'team' as const })),
                ]);
            } catch (error) {
                console.error('Failed to load assignee options:', error);
            }
        };

        fetchAssigneeOptions();
    }, [canFetchProtectedData, canViewTeams, canViewUsers]);

    // reset page to 1 on filter changes
    useEffect(() => {
        setCurrentPage(1);
    }, [selectedType, selectedStatus]);

    useEffect(() => {
        if (!canFetchProtectedData) {
            return;
        }
        if (resolvedRouteThreadId) {
            const fetchThreadStr = async () => {
                setIsThreadLoading(true);
                try {
                    const normalizedThreadId = resolvedRouteThreadId;
                    const [threadRes, notesRes, messagesRes] = await Promise.all([
                        api.get(`/threads/${normalizedThreadId}`),
                        api.get(`/threads/${normalizedThreadId}/notes`),
                        api.get(`/messages`, { params: { threadId: normalizedThreadId, limit: 100 } }),
                    ]);
                    const res = threadRes;
                    const rawMessages = messagesRes.data?.items || messagesRes.data?.messages || (Array.isArray(messagesRes.data) ? messagesRes.data : []);
                    
                    // Store the loaded thread data so it persists across pagination
                    const linkedMailbox = mailboxes.find((entry) => String(entry.id) === String(res.data.mailboxId));
                    setLoadedThread({
                        id: res.data.id,
                        subject: res.data.subject || '(No Subject)',
                        from: res.data.contact?.email || rawMessages?.[0]?.fromEmail || 'unknown@example.com',
                        assignedTo: res.data.assignedUser?.fullName || res.data.assignedTeam?.name || '',
                        assignedToUserId: res.data.assignedUser?.id || null,
                        assignedToTeamId: res.data.assignedTeam?.id || null,
                        assignedTeamName: res.data.assignedTeam?.name || '',
                        status: apiStatusToUiStatus(res.data.status, res.data.assignedUser?.id),
                        starred: Boolean(res.data.starred),
                        tags: (res.data.tags || []).map((tagEntry: any) => tagEntry?.tag?.name || tagEntry?.name).filter(Boolean),
                        unreadCount: 0,
                        noteCount: Number(res.data?._count?.notes || 0),
                        mailboxId: res.data.mailboxId || '',
                        mailboxName: linkedMailbox?.name || linkedMailbox?.email || '',
                        mailboxEmail: linkedMailbox?.email || '',
                        priority: String(res.data.priority || '').toLowerCase(),
                        slaBreached: Boolean(res.data.slaBreached),
                        firstResponseDueAt: res.data.firstResponseDueAt || null,
                        resolutionDueAt: res.data.resolutionDueAt || null,
                        time: res.data.createdAt || new Date().toISOString(),
                        snippet: (rawMessages?.[0]?.bodyText || rawMessages?.[0]?.bodyHtml || '').substring(0, 100),
                        contactName: res.data.contact?.name || res.data.contact?.fullName || '',
                        companyName: res.data.company?.name || '',
                    });
                    
                    const unreadInboundIds = (rawMessages || [])
                        .filter((message: any) => message.direction === 'INBOUND' && message.isRead === false)
                        .map((message: any) => message.id);
                    setApiThreadMessages(rawMessages.map((m: any) => ({
                        id: m.id,
                        threadId: res.data.id,
                        fromEmail: m.fromEmail,
                        toEmail: (m.to || []).join(', '),
                        to: normalizeAddressList(m.to),
                        cc: normalizeAddressList(m.cc),
                        bcc: normalizeAddressList(m.bcc),
                        replyTo: normalizeAddressList(m.replyTo),
                        subject: res.data.subject,
                        bodyText: m.bodyText || '',
                        bodyHtml: m.bodyHtml || '',
                        createdAt: m.createdAt,
                        direction: m.direction,
                        isRead: m.isRead,
                        attachments: m.attachments || []
                    })));
                    setInternalNotes(Array.isArray(notesRes.data) ? notesRes.data : []);

                    const actualThreadId = resolvedRouteThreadId;
                    setApiThreads(prev => {
                        const idx = prev.findIndex(t => String(t.id) === actualThreadId);
                        if (idx >= 0 && unreadInboundIds.length > 0) {
                            const newThreads = [...prev];
                            newThreads[idx] = { ...newThreads[idx], unreadCount: 0, read: true };
                            return newThreads;
                        }
                        return prev;
                    });

                    if (unreadInboundIds.length > 0) {
                        api.patch('/messages', { ids: unreadInboundIds, isRead: true }).catch(console.error);
                    }
                } catch (e) {
                    console.error('Failed to fetch thread messages:', e);
                } finally {
                    setIsThreadLoading(false);
                }
            };
            fetchThreadStr();
        } else {
            setIsThreadLoading(false);
            setApiThreadMessages([]);
            setInternalNotes([]);
            setLoadedThread(null);
        }
    }, [resolvedRouteThreadId, canFetchProtectedData, mailboxes]);

    useEffect(() => {
        api.get('/templates').then(res => {
            setReplyTemplates(Array.isArray(res.data) ? res.data.map((t: any) => ({ id: t.id, name: t.name, bodyHtml: t.bodyHtml })) : []);
        }).catch(() => {});
    }, []);

    useEffect(() => {
        setSelectedSignatureId('');
    }, [resolvedRouteThreadId]);

    useEffect(() => {
        if (!canFetchProtectedData || !activeMailboxId) {
            setAvailableSignatures([]);
            setSelectedSignatureId('');
            return;
        }

        api.get('/signatures/available')
            .then((res) => {
                const rows = Array.isArray(res.data) ? res.data : [];
                const filtered = rows.filter((signature: any) => {
                    const assignedMailboxIds = normalizeAddressList(signature?.assignedMailboxIds);
                    if (assignedMailboxIds.length === 0) return true;
                    return assignedMailboxIds.includes(activeMailboxId);
                });
                setAvailableSignatures(filtered);
                setSelectedSignatureId((prev) => (filtered.some((signature: any) => signature.id === prev) ? prev : ''));
            })
            .catch(() => {
                setAvailableSignatures([]);
                setSelectedSignatureId('');
            });
    }, [canFetchProtectedData, activeMailboxId]);

    const mappedInternalNoteMessages = useMemo(() => (
        internalNotes.map((note) => ({
            id: note.id,
            type: 'internal-note',
            threadId: normalizeThreadApiId(String(openThread?.id || '')),
            fromEmail: note.user?.email || 'internal-note',
            toEmail: '',
            subject: openThread?.subject || '',
            bodyText: note.body,
            bodyHtml: String(note.body || '').replace(/\n/g, '<br/>'),
            createdAt: note.createdAt,
            direction: 'OUTBOUND' as const,
            isRead: true,
            user: note.user || { fullName: user?.fullName, email: user?.email, avatarUrl: user?.avatarUrl },
            mentionedUsers: Array.isArray(note.mentionedUsers) ? note.mentionedUsers : [],
        }))
    ), [internalNotes, openThread?.id, openThread?.subject, user?.fullName, user?.email, user?.avatarUrl]);

    // Sync local messages when thread changes
    useEffect(() => {
        if (openThread) {
            const sessionReplies = localReplies[openThread.id] || [];
            const merged = [...apiThreadMessages, ...mappedInternalNoteMessages, ...sessionReplies]
                .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
            setLocalMessages(merged);
        } else {
            setLocalMessages([]);
        }
    }, [openThread?.id, localReplies[openThread?.id || ''], apiThreadMessages, mappedInternalNoteMessages]);

    useEffect(() => {
        if (!resolvedRouteThreadId) return;
        const noteCount = internalNotes.length;

        setApiThreads((prev) => prev.map((thread) => (
            String(thread.id) === String(resolvedRouteThreadId)
                ? { ...thread, noteCount }
                : thread
        )));

        setLoadedThread((prev: any) => {
            if (!prev || String(prev.id) !== String(resolvedRouteThreadId)) return prev;
            return { ...prev, noteCount };
        });
    }, [internalNotes, resolvedRouteThreadId]);

    // Scroll to bottom when messages change
    useEffect(() => {
        if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [localMessages]);

    const handleStatusChange = async (threadIdValue: string, status: string) => {
        handleOverride(threadIdValue, { status });
        await api.patch(`/threads/${String(threadIdValue).replace('t', '')}`, { status: uiStatusToApiStatus(status) });
    };

    const handleSnooze = async (threadIdValue: string, date: Date | null) => {
        handleOverride(threadIdValue, { snoozeUntil: date ? format(date, 'MMM d, yyyy') : undefined });
        await api.patch(`/threads/${String(threadIdValue).replace('t', '')}`, { snoozedUntil: date ? date.toISOString() : null });
    };

    const handleAssign = async (threadIdValue: string, option: AssigneeOption | null) => {
        handleOverride(threadIdValue, { assignee: option?.label || '' });
        await api.post(`/threads/${String(threadIdValue).replace('t', '')}/assign`, {
            userId: option?.type === 'user' ? option.id : undefined,
            teamId: option?.type === 'team' ? option.id : undefined,
        });
    };

    const handleToggleStar = async (threadIdValue: string, nextValue?: boolean) => {
        const threadId = String(threadIdValue).replace('t', '');
        const existing = apiThreads.find((entry) => String(entry.id) === threadId || String(entry.id) === threadIdValue);
        const starred = typeof nextValue === 'boolean' ? nextValue : !Boolean(existing?.starred);
        await api.patch(`/threads/${threadId}/star`, { starred });
        setApiThreads((prev) => prev.map((entry) => (
            String(entry.id) === threadId
                ? { ...entry, starred }
                : entry
        )));
        refreshSidebarDataForEvent(existing?.mailboxId || activeMailboxId || null, threadId);
    };

    const handleToggleArchive = async (threadIdValue: string, archived: boolean) => {
        const threadId = String(threadIdValue).replace('t', '');
        let nextStatus = archived ? 'new' : 'archived';
        if (archived) {
            const response = await api.post(`/threads/${threadId}/unarchive`);
            nextStatus = apiStatusToUiStatus(response?.data?.status);
        } else {
            const response = await api.post(`/threads/${threadId}/archive`);
            nextStatus = apiStatusToUiStatus(response?.data?.status);
        }

        setApiThreads((prev) => prev.map((entry) => {
            if (String(entry.id) !== threadId) return entry;
            return {
                ...entry,
                status: nextStatus,
            };
        }));

        const mailboxId = apiThreadsRef.current.find((entry) => String(entry.id) === threadId)?.mailboxId || activeMailboxId || null;
        refreshSidebarDataForEvent(mailboxId, threadId);
        setOpenDropdown(null);
    };

    const handleSetThreadReadState = async (threadIdValue: string, isRead: boolean) => {
        const threadId = String(threadIdValue).replace('t', '');
        const messagesRes = await api.get('/messages', { params: { threadId, limit: 100 } });
        const rows = messagesRes.data?.items || messagesRes.data?.messages || [];
        const inboundIds = (Array.isArray(rows) ? rows : [])
            .filter((message: any) => message.direction === 'INBOUND' && message.isRead !== isRead)
            .map((message: any) => message.id);

        if (inboundIds.length > 0) {
            await api.patch('/messages', { ids: inboundIds, isRead });
        }

        setApiThreads((prev) => prev.map((entry) => {
            if (String(entry.id) !== threadId) return entry;
            return {
                ...entry,
                unreadCount: isRead ? 0 : Math.max(1, Number(entry.unreadCount || 0)),
                read: isRead,
            };
        }));

        if (String(actualOpenThread?.id || '') === threadId) {
            setApiThreadMessages((prev) => prev.map((message) => (
                message.direction === 'INBOUND' ? { ...message, isRead } : message
            )));
        }

        const mailboxId = apiThreadsRef.current.find((entry) => String(entry.id) === threadId)?.mailboxId || activeMailboxId || null;
        refreshSidebarDataForEvent(mailboxId, threadId);
        setOpenDropdown(null);
    };

    const handleToggleMessageReadState = async (messageId: string, currentReadState: boolean) => {
        const nextReadState = !currentReadState;
        await api.patch('/messages', { ids: [messageId], isRead: nextReadState });

        setApiThreadMessages((prev) => {
            const nextMessages = prev.map((message) => (
                String(message.id) === String(messageId)
                    ? { ...message, isRead: nextReadState }
                    : message
            ));

            const unreadInbound = nextMessages.filter((message) => message.direction === 'INBOUND' && message.isRead === false).length;
            if (resolvedRouteThreadId) {
                setApiThreads((threadsPrev) => threadsPrev.map((thread) => (
                    String(thread.id) === String(resolvedRouteThreadId)
                        ? { ...thread, unreadCount: unreadInbound, read: unreadInbound === 0 }
                        : thread
                )));
                setLoadedThread((threadPrev: any) => {
                    if (!threadPrev || String(threadPrev.id) !== String(resolvedRouteThreadId)) return threadPrev;
                    return { ...threadPrev, unreadCount: unreadInbound, read: unreadInbound === 0 };
                });
            }

            return nextMessages;
        });

        const openThreadMailboxId = apiThreadsRef.current.find((entry) => String(entry.id) === String(resolvedRouteThreadId || ''))?.mailboxId || activeMailboxId || null;
        refreshSidebarDataForEvent(openThreadMailboxId, resolvedRouteThreadId || null);
    };

    const handleDownloadAttachment = async (_messageId: string, attachment: any) => {
        const attachmentId = String(attachment?.id || '');
        if (!attachmentId) return;

        try {
            const response = await api.get(`/attachments/${attachmentId}/download-link`);
            const downloadUrl = response.data?.url;
            if (downloadUrl) {
                window.open(downloadUrl, '_blank', 'noopener,noreferrer');
            }
        } catch (error) {
            console.error('Failed to download attachment:', error);
        }
    };

    const handleReply = async (
        scheduledFor?: Date | null,
        recurrencePreset?: RecurrencePreset,
        scheduledStatePreset?: ScheduledStatePreset,
    ) => {
        const plainText = replyHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!plainText) {
            setReplyError('Message cannot be empty');
            return;
        }
        if (!openThread) return;

        const mailboxIdForSend = activeMailboxId || openThread.mailboxId;
        if (!mailboxIdForSend) {
            setReplyError('Select a mailbox from the sidebar.');
            return;
        }

        const latestInbound = apiThreadMessages.find((message) => message.direction === 'INBOUND');
        const senderEmail = String(latestInbound?.fromEmail || openThread.from || '').trim();
        if (!senderEmail) {
            setReplyError('Could not determine recipient for this thread.');
            return;
        }

        const toRecipients: string[] = [senderEmail];
        const ccRecipients: string[] = [];
        const bccRecipients: string[] = [];

        const selectedSignature = availableSignatures.find((signature) => signature.id === selectedSignatureId);
        const signatureHtml = String(selectedSignature?.bodyHtml || selectedSignature?.contentHtml || '').trim();
        const finalBodyHtml = signatureHtml ? `${replyHtml}<br/><br/>${signatureHtml}` : replyHtml;
        const finalBodyText = `${plainText}${signatureHtml ? `\n\n${String(signatureHtml).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()}` : ''}`.trim();
        const baseSubject = String(openThread.subject || latestInbound?.subject || '(no subject)').trim();
        const sendSubject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`;

        const resolvedScheduledAt = scheduledFor || null;
        const resolvedRecurrence = recurrencePreset || 'none';
        const resolvedScheduledState = scheduledStatePreset ?? replyScheduledState ?? 'no_change';
        const rrule = buildRrule(resolvedRecurrence, resolvedScheduledAt);

        setReplyError('');
        setIsReplying(true);

        try {
            const actualThreadId = String(openThread.id).replace('t', '');
            const payload = {
                mailboxId: mailboxIdForSend,
                threadId: actualThreadId,
                to: toRecipients,
                cc: ccRecipients,
                bcc: bccRecipients,
                subject: sendSubject,
                bodyHtml: finalBodyHtml,
                bodyText: finalBodyText,
                ...(resolvedScheduledAt ? { scheduledAt: resolvedScheduledAt.toISOString() } : {}),
                ...(rrule ? { rrule, timezone: detectedTimezone } : {}),
            };

            if (resolvedScheduledAt) {
                await api.post('/scheduled-messages', payload);
                if (resolvedScheduledState !== 'no_change' && actualOpenThread) {
                    await handleStatusChange(openThread.id, resolvedScheduledState);
                }
            } else {
                const res = await api.post('/messages/send', payload);
                if (!res?.data?.id) {
                    throw new Error('Message send API did not return message details.');
                }

                const newMsg = {
                    id: res.data?.id || `msg-${Date.now()}`,
                    threadId: openThread.id,
                    fromEmail: res.data?.fromEmail || user?.email || 'me@sermuno.local',
                    toEmail: Array.isArray(res.data?.to) ? res.data.to.join(', ') : toRecipients.join(', '),
                    to: Array.isArray(res.data?.to) ? res.data.to : toRecipients,
                    cc: Array.isArray(res.data?.cc) ? res.data.cc : ccRecipients,
                    bcc: Array.isArray(res.data?.bcc) ? res.data.bcc : bccRecipients,
                    subject: res.data?.subject || sendSubject,
                    bodyText: res.data?.bodyText || finalBodyText,
                    bodyHtml: res.data?.bodyHtml || finalBodyHtml,
                    createdAt: res.data?.createdAt || new Date().toISOString(),
                    direction: 'OUTBOUND' as const,
                    attachments: res.data?.attachments || [],
                };

                setLocalReplies(prev => ({
                    ...prev,
                    [openThread.id]: [...(prev[openThread.id] || []), newMsg]
                }));
            }
        } catch (err) {
            console.error('Failed to send reply:', err);
            const apiMessage =
                err &&
                typeof err === 'object' &&
                'response' in err &&
                (err as { response?: { data?: { message?: string } } }).response?.data?.message;
            setReplyError(typeof apiMessage === 'string' ? apiMessage : 'Failed to send or schedule reply. Please try again.');
            setIsReplying(false);
            return;
        }

        if (resolvedScheduledState !== 'no_change' && actualOpenThread) {
            await handleStatusChange(openThread.id, resolvedScheduledState);
        } else if (actualOpenThread?.status === 'new') {
            // Auto-change status from New to In Progress on first reply
            await handleStatusChange(openThread.id, 'in_progress');
        }

        setReplyHtml('');
        setReplyScheduledAt(null);
        setReplyRecurrencePreset('none');
        setIsReplyScheduleOpen(false);
        setIsReplying(false);

        setActivityLog(prev => [{
            id: `act-${Date.now()}`,
            text: resolvedScheduledAt
                ? `Reply scheduled to ${toRecipients.join(', ')}`
                : `Reply sent to ${toRecipients.join(', ')}`,
            time: 'Just now'
        }, ...prev]);
    };

    const handleScheduleReply = () => {
        if (!replyScheduledAt) return;
        handleReply(replyScheduledAt, replyRecurrencePreset, replyScheduledState);
    };

    const handleEditNote = (noteId: string, noteText: string) => {
        setReplyEditorTab('note');
        setNoteHtml(noteText);
        setEditingNoteId(noteId);
        window.scrollTo(0, document.body.scrollHeight);
    };

    const handleDeleteNote = async (noteId: string) => {
        if (!actualOpenThread) return;
        try {
            await api.delete(`/threads/${normalizeThreadApiId(String(actualOpenThread.id))}/notes/${noteId}`);
            setInternalNotes(prev => prev.filter(note => note.id !== noteId));
        } catch (err) {
            console.error('Failed to delete note:', err);
        }
    };

    const handleUpdateNote = async () => {
        if (!editingNoteId || !actualOpenThread) return;
        const plainText = noteHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!plainText) return;
        setIsSavingNote(true);
        try {
            const response = await api.patch(
                `/threads/${normalizeThreadApiId(String(actualOpenThread.id))}/notes/${editingNoteId}`,
                { body: plainText }
            );
            setInternalNotes(prev => prev.map(note =>
                note.id === editingNoteId
                    ? response.data
                    : note
            ));
            setNoteHtml('');
            setEditingNoteId(null);
        } catch (err) {
            console.error('Failed to update note:', err);
        } finally {
            setIsSavingNote(false);
        }
    };

    const handleSaveNote = async () => {
        const plainText = noteHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!plainText || !actualOpenThread) return;
        setIsSavingNote(true);
        try {
            const response = await api.post(`/threads/${normalizeThreadApiId(String(actualOpenThread.id))}/notes`, { body: plainText });
            setInternalNotes(prev => {
                const existingIndex = prev.findIndex(note => note.id === response.data.id);
                if (existingIndex === -1) {
                    return [...prev, response.data];
                }

                const next = [...prev];
                next[existingIndex] = response.data;
                return next;
            });
            setNoteHtml('');
        } catch (err) {
            console.error('Failed to save note:', err);
        } finally {
            setIsSavingNote(false);
        }
    };

    const shouldProcessMailboxEvent = useCallback((mailboxId?: string | null, threadId?: string | null) => {
        if (!activeMailboxId) return true;

        const normalizedMailboxId = String(mailboxId || '').trim();
        if (normalizedMailboxId) {
            return normalizedMailboxId === String(activeMailboxId);
        }

        const normalizedThreadId = String(threadId || '').trim();
        if (normalizedThreadId) {
            const existing = apiThreadsRef.current.find((thread) => String(thread.id) === normalizedThreadId);
            if (existing?.mailboxId) {
                return String(existing.mailboxId) === String(activeMailboxId);
            }
        }

        return true;
    }, [activeMailboxId]);

    const refreshSidebarDataForEvent = useCallback((mailboxId?: string | null, threadId?: string | null) => {
        if (!shouldProcessMailboxEvent(mailboxId, threadId)) return;
        if (sidebarRefreshTimerRef.current) {
            clearTimeout(sidebarRefreshTimerRef.current);
        }

        sidebarRefreshTimerRef.current = setTimeout(() => {
            loadInboxCounts();
        }, 200);
    }, [shouldProcessMailboxEvent, loadInboxCounts]);

    // ── WebSocket real-time listeners ──
    useEffect(() => {
        if (!socket || !isConnected) return;

        const handleNewThread = (thread: any) => {
            const mailboxId = thread?.mailboxId || thread?.mailbox?.id || null;
            if (!shouldProcessMailboxEvent(mailboxId, thread?.id)) return;
            scheduleThreadListRefresh();
            refreshSidebarDataForEvent(mailboxId, thread?.id);
        };

        const handleThreadUpdated = (data: any) => {
            const updatedThreadId = String(data?.threadId || data?.id || '');
            if (!updatedThreadId) return;
            const eventMailboxId = data?.mailboxId || data?.mailbox?.id || null;
            if (!shouldProcessMailboxEvent(eventMailboxId, updatedThreadId)) return;

            const existsOnCurrentPage = apiThreadsRef.current.some((thread) => String(thread.id) === updatedThreadId);

            setApiThreads(prev =>
                prev.map(t =>
                    String(t.id) === updatedThreadId
                        ? {
                            ...t,
                            status: data.status ? apiStatusToUiStatus(data.status) : t.status,
                            assignedTo: data.assignedUser?.fullName || data.assignedTeam?.name || t.assignedTo,
                            assignedToUserId: data.assignedUser?.id ?? t.assignedToUserId,
                            assignedToTeamId: data.assignedTeam?.id ?? t.assignedToTeamId,
                            starred: data.starred ?? t.starred,
                        }
                        : t
                )
            );

            if (!existsOnCurrentPage || currentPage > 1) {
                scheduleThreadListRefresh();
            }

            refreshSidebarDataForEvent(eventMailboxId, updatedThreadId);
        };

        const handleNewMessage = (message: any) => {
            const eventMailboxId = message?.mailboxId || null;
            const eventThreadId = String(message?.threadId || '');

            if (message.direction === 'INBOUND' && resolvedRouteThreadId && String(message.threadId) === resolvedRouteThreadId) {
                const mapped = {
                    id: message.id,
                    threadId: message.threadId,
                    fromEmail: message.fromEmail,
                    toEmail: (message.to || []).join(', '),
                    to: normalizeAddressList(message.to),
                    cc: normalizeAddressList(message.cc),
                    bcc: normalizeAddressList(message.bcc),
                    replyTo: normalizeAddressList(message.replyTo),
                    subject: message.subject || '',
                    bodyText: message.bodyText || '',
                    bodyHtml: message.bodyHtml || '',
                    createdAt: message.createdAt,
                    direction: message.direction,
                    isRead: message.isRead,
                    attachments: message.attachments || [],
                };
                setApiThreadMessages(prev => [...prev, mapped]);
            }

            if (!shouldProcessMailboxEvent(eventMailboxId, eventThreadId)) return;

            scheduleThreadListRefresh();
            refreshSidebarDataForEvent(eventMailboxId, eventThreadId);
        };

        const handleMailboxSynced = (payload: any) => {
            if (!payload?.mailboxId) return;
            if (!shouldProcessMailboxEvent(payload.mailboxId, null)) return;
            lastFetchedFoldersMailboxIdRef.current = null;
            setMailboxDataVersion((prev) => prev + 1);
            scheduleThreadListRefresh();
            refreshSidebarDataForEvent(payload.mailboxId, null);
        };

        const handleThreadNoteAdded = (payload: any) => {
            if (!payload?.threadId || !payload?.note) return;
            setApiThreads((prev) => prev.map((thread) => (
                String(thread.id) === String(payload.threadId)
                    ? { ...thread, noteCount: Number(thread.noteCount || 0) + 1 }
                    : thread
            )));
            if (String(payload.threadId) !== String(resolvedRouteThreadId || '')) return;
            setInternalNotes(prev => {
                if (prev.some((note) => String(note.id) === String(payload.note.id))) {
                    return prev;
                }
                return [...prev, payload.note];
            });
        };

        socket.on('new_thread', handleNewThread);
        socket.on('thread_updated', handleThreadUpdated);
        socket.on('thread:updated', handleThreadUpdated);
        socket.on('thread:assigned', handleThreadUpdated);
        socket.on('thread:status_changed', handleThreadUpdated);
        socket.on('new_message', handleNewMessage);
        socket.on('message:new', handleNewMessage);
        socket.on('mailbox:synced', handleMailboxSynced);
        socket.on('thread:note_added', handleThreadNoteAdded);

        return () => {
            socket.off('new_thread', handleNewThread);
            socket.off('thread_updated', handleThreadUpdated);
            socket.off('thread:updated', handleThreadUpdated);
            socket.off('thread:assigned', handleThreadUpdated);
            socket.off('thread:status_changed', handleThreadUpdated);
            socket.off('new_message', handleNewMessage);
            socket.off('message:new', handleNewMessage);
            socket.off('mailbox:synced', handleMailboxSynced);
            socket.off('thread:note_added', handleThreadNoteAdded);
        };
    }, [activeFolderId, socket, isConnected, resolvedRouteThreadId, scheduleThreadListRefresh, currentPage, shouldProcessMailboxEvent, refreshSidebarDataForEvent]);

    // Derived open thread with overrides
    const actualOpenThread = useMemo(() => {
        if (!openThread) return null;
        const override = threadOverrides[openThread.id];
        if (!override) return openThread;
        return {
            ...openThread,
            status: override.status || openThread.status,
            assignedTo: override.assignee !== undefined ? override.assignee : openThread.assignedTo,
            tags: override.tags || openThread.tags,
            snoozeUntil: override.snoozeUntil
        };
    }, [openThread, threadOverrides]);

    const threadParticipants = useMemo(() => {
        const participants = new Set<string>();
        if (actualOpenThread?.from) participants.add(String(actualOpenThread.from));
        localMessages.forEach((message) => {
            if (message?.fromEmail) participants.add(String(message.fromEmail));
            normalizeAddressList(message?.to).forEach((email) => participants.add(email));
            normalizeAddressList(message?.cc).forEach((email) => participants.add(email));
        });
        return Array.from(participants).filter(Boolean).slice(0, 8);
    }, [actualOpenThread?.from, localMessages]);

    const relatedThreads = useMemo(() => {
        if (!actualOpenThread?.from) return [];
        return apiThreads
            .filter((thread) => String(thread.id) !== String(actualOpenThread.id) && String(thread.from || '').toLowerCase() === String(actualOpenThread.from || '').toLowerCase())
            .slice(0, 4);
    }, [apiThreads, actualOpenThread?.from, actualOpenThread?.id]);

    const handleOverride = (threadId: string, updates: { status?: string, assignee?: string, tags?: string[], snoozeUntil?: string }) => {
        setThreadOverrides(prev => ({
            ...prev,
            [threadId]: {
                ...(prev[threadId] || {}),
                ...updates
            }
        }));
        setOpenDropdown(null);

        if (updates.status) {
            const statusVal = updates.status;
            setActivityLog(prev => [{ id: `act-${Date.now()}-status`, text: `Status changed to ${statusVal.replace('_', ' ')}`, time: 'Just now' }, ...prev]);
        }
        if (updates.assignee !== undefined) {
            setActivityLog(prev => [{ id: `act-${Date.now()}-Assignee`, text: `Assignee set to ${updates.assignee || 'Unassigned'}`, time: 'Just now' }, ...prev]);
        }
        if (updates.tags) {
            setActivityLog(prev => [{ id: `act-${Date.now()}-tags`, text: `Tags updated`, time: 'Just now' }, ...prev]);
        }
        if (updates.snoozeUntil) {
            setActivityLog(prev => [{ id: `act-${Date.now()}-snooze`, text: `Snoozed until ${updates.snoozeUntil}`, time: 'Just now' }, ...prev]);
        }
    };

    const handleAddTag = (tag: string) => {
        if (!actualOpenThread) return;
        const currentTags = actualOpenThread.tags;
        if (!currentTags.includes(tag)) {
            // Find tag ID by name
            const tagObj = apiTags.find((t: any) => t.name === tag);
            if (!tagObj) return;

            api.post(`/threads/${actualOpenThread.id}/tags`, { tagId: tagObj.id }).catch(console.error);
            handleOverride(actualOpenThread.id, { tags: [...currentTags, tag] });
        }
    };

    const handleRemoveTag = (tag: string) => {
        if (!actualOpenThread) return;
        const currentTags = actualOpenThread.tags;

        // Find tag ID by name
        const tagObj = apiTags.find((t: any) => t.name === tag);
        if (tagObj) {
            api.delete(`/threads/${actualOpenThread.id}/tags/${tagObj.id}`).catch(console.error);
        }

        handleOverride(actualOpenThread.id, { tags: currentTags.filter((t: string) => t !== tag) });
    };

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (openDropdown && !(e.target as Element).closest('.dropdown-container')) {
                setOpenDropdown(null);
            }
        };
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpenDropdown(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [openDropdown]);

    useEffect(() => {
        if (openDropdown !== 'snooze') {
            setShowCustomSnoozeDatePicker(false);
        }
    }, [openDropdown]);

    useEffect(() => {
        if (searchParams.get('compose') === '1') {
            setIsComposeOpen(true);
        }
    }, [searchParams]);

    const handleCloseCompose = () => {
        setIsComposeOpen(false);
        if (searchParams.has('compose')) {
            const next = new URLSearchParams(searchParams);
            next.delete('compose');
            setSearchParams(next, { replace: true });
        }
    };

    const applyNavFilterState = (id: string) => {
        setActiveFilter(id);
        setActiveTagId(null);
        setSelectedType('All');
        setActiveSidebarItem({ kind: 'filter', id });
        setSearchTerm('');
    };

    const handleNavFilter = (id: string) => {
        applyNavFilterState(id);
        if (resolvedRouteThreadId) {
            navigate('/inbox');
        }
    };

    const getSidebarCount = useCallback((id: string) => Number(sidebarCounts[id] || 0), [sidebarCounts]);

    const expandAllSidebarSections = () => {
        setExpandedStatus(true);
        setExpandedMore(true);
        setExpandedMailboxes(true);
        setExpandedFolders(true);
        setExpandedTags(true);
    };

    const collapseAllSidebarSections = () => {
        setExpandedStatus(false);
        setExpandedMore(false);
        setExpandedMailboxes(false);
        setExpandedFolders(false);
        setExpandedTags(false);
    };

    const areSidebarSectionsExpanded = expandedStatus && expandedMore && expandedMailboxes && expandedFolders && expandedTags;

    return (
        <div className="relative flex h-full overflow-hidden bg-white rounded-xl shadow-sm border border-[var(--color-card-border)]">
            {/* ── Inbox Sidebar ── */}


            <div className="hidden md:flex w-60 xl:w-64 border-r border-[var(--color-card-border)] flex-col bg-[var(--color-background)]/30 shrink-0">
                <div className="px-3 pt-4 pb-2">
                    <div className="flex items-center justify-between gap-2">
                        <h2 className="text-sm font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>Inbox</h2>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={areSidebarSectionsExpanded ? collapseAllSidebarSections : expandAllSidebarSections}
                                className="inline-flex h-6 items-center justify-center rounded border border-[var(--color-card-border)] px-2 text-[11px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                title={areSidebarSectionsExpanded ? 'Collapse sections' : 'Expand sections'}
                                aria-label={areSidebarSectionsExpanded ? 'Collapse sections' : 'Expand sections'}
                            >
                                {areSidebarSectionsExpanded ? 'Collapse' : 'Expand'}
                            </button>
                        </div>
                    </div>
                </div>

                <nav className="flex-1 overflow-y-auto no-scrollbar px-2 space-y-0.5">
                    {/* Mailbox switcher */}
                    <div className="pb-3">
                        <button
                            className="w-full flex items-center justify-between px-3 mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]/60 hover:text-[var(--color-text-primary)] transition-colors"
                            onClick={() => setExpandedMailboxes(!expandedMailboxes)}
                            style={{ fontFamily: 'var(--font-ui)' }}
                        >
                            Mailbox
                            <ChevronDown className={clsx('w-3 h-3 transition-transform', expandedMailboxes ? '' : '-rotate-90')} />
                        </button>
                        {expandedMailboxes && (
                            <div className="space-y-0.5 px-3 pb-1.5 relative dropdown-container">
                                <button
                                    type="button"
                                    onClick={() => setOpenDropdown(openDropdown === 'mailbox-switcher' ? null : 'mailbox-switcher')}
                                    className="w-full rounded-xl border border-[var(--color-card-border)] bg-white px-3 py-2 text-left text-[12px] text-[var(--color-text-primary)] shadow-sm"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0 flex items-start gap-2">
                                            <ProviderLogo provider={activeMailbox?.provider} className="h-4 w-4 shrink-0 mt-0.5" />
                                            <div className="min-w-0">
                                                <div className="text-[12px] font-medium text-[var(--color-text-primary)] break-words">{activeMailbox?.name || activeMailbox?.email || 'Select mailbox'}</div>
                                                {activeMailbox?.email && <div className="mt-0.5 text-[11px] text-[var(--color-text-muted)] break-all">{activeMailbox.email}</div>}
                                            </div>
                                        </div>
                                        <ChevronDown className={clsx('w-3 h-3 shrink-0 text-[var(--color-text-muted)] transition-transform mt-0.5', openDropdown === 'mailbox-switcher' && 'rotate-180')} />
                                    </div>
                                </button>
                                {openDropdown === 'mailbox-switcher' && (
                                    <div className="absolute left-3 right-3 top-full mt-1 z-50 rounded-xl border border-[var(--color-card-border)] bg-white py-1 shadow-lg">
                                        {mailboxes.map((mailbox) => {
                                            const isActive = String(mailbox.id) === String(activeMailboxId);
                                            return (
                                                <button
                                                    type="button"
                                                    key={mailbox.id}
                                                    onClick={() => {
                                                        if (String(activeMailboxId) !== String(mailbox.id)) {
                                                            lastFetchedFoldersMailboxIdRef.current = null;
                                                        }
                                                        setActiveMailboxId(mailbox.id);
                                                        setOpenDropdown(null);
                                                    }}
                                                    className={clsx(
                                                        'w-full flex items-start justify-between gap-2 px-3 py-2 text-left transition-colors',
                                                        isActive
                                                            ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]'
                                                            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-background)]/60 hover:text-[var(--color-text-primary)]'
                                                    )}
                                                >
                                                    <div className="min-w-0 flex items-start gap-2">
                                                        <ProviderLogo provider={mailbox.provider} className="h-4 w-4 shrink-0 mt-0.5" />
                                                        <div className="min-w-0">
                                                            <div className="text-[12px] font-medium break-words">{mailbox.name || mailbox.email}</div>
                                                            {mailbox.email && <div className="mt-0.5 text-[11px] opacity-80 break-all">{mailbox.email}</div>}
                                                        </div>
                                                    </div>
                                                    {mailbox.unreadCount > 0 && (
                                                        <span className="ml-2 min-w-5 px-1.5 py-0.5 rounded-full text-[10px] leading-none border bg-white text-[var(--color-text-muted)] border-[var(--color-card-border)]/70">
                                                            {mailbox.unreadCount}
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Main */}
                    <div className="space-y-0.5">
                        {globalItems.map(item => {
                            const count = getSidebarCount(item.id);
                            return (
                                <button
                                    key={item.id}
                                    onMouseDown={() => applyNavFilterState(item.id)}
                                    onClick={() => handleNavFilter(item.id)}
                                    className={clsx(
                                        'w-full flex items-center justify-between px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors',
                                        activeSidebarItem.kind === 'filter' && activeSidebarItem.id === item.id
                                            ? 'bg-white text-[var(--color-primary)] shadow-sm'
                                            : 'text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-primary)]'
                                    )}
                                >
                                    <div className="flex items-center gap-2.5">
                                        <item.icon className="w-4 h-4" />
                                        {item.label}
                                    </div>
                                    {count > 0 && <span className="text-[10px] opacity-50">{count}</span>}
                                </button>
                            );
                        })}
                    </div>

                    {/* Status */}
                    <div className="pt-3">
                        <button
                            className="w-full flex items-center justify-between px-3 mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]/50 hover:text-[var(--color-text-primary)] transition-colors"
                            onClick={() => setExpandedStatus(!expandedStatus)}
                        >
                            Status
                            <ChevronDown className={clsx('w-3 h-3 transition-transform', expandedStatus ? '' : '-rotate-90')} />
                        </button>
                        {expandedStatus && (
                            <div className="px-3 pb-1.5 relative dropdown-container">
                                <button
                                    onClick={() => setOpenDropdown(openDropdown === 'sidebar-status' ? null : 'sidebar-status')}
                                    className="w-full text-[12px] border border-[var(--color-card-border)] rounded-lg px-2 py-1.5 bg-white text-[var(--color-text-primary)] flex items-center justify-between gap-2"
                                >
                                    <span className="truncate capitalize">{selectedStatus === 'All' ? 'All statuses' : selectedStatus.replace('_', ' ')}</span>
                                    <ChevronDown className={clsx('w-3 h-3 shrink-0 text-[var(--color-text-muted)] transition-transform', openDropdown === 'sidebar-status' && 'rotate-180')} />
                                </button>
                                {openDropdown === 'sidebar-status' && (
                                    <div className="absolute left-3 right-3 top-full mt-1 z-50 rounded-xl border border-[var(--color-card-border)] bg-white py-1 shadow-lg">
                                        {statusFilterOptions.map((status) => (
                                            <button
                                                key={status}
                                                onClick={() => {
                                                    setSelectedStatus(status);
                                                    setOpenDropdown(null);
                                                }}
                                                className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between"
                                            >
                                                <span className="capitalize">{status === 'All' ? 'All statuses' : status.replace('_', ' ')}</span>
                                                {selectedStatus === status && <Check className="w-3.5 h-3.5 text-[var(--color-primary)]" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* More */}
                    <div className="pt-3">
                        <button
                            className="w-full flex items-center justify-between px-3 mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]/50 hover:text-[var(--color-text-primary)] transition-colors"
                            onClick={() => setExpandedMore(!expandedMore)}
                        >
                            Quick Filters
                            <ChevronDown className={clsx("w-3 h-3 transition-transform", expandedMore ? "" : "-rotate-90")} />
                        </button>
                        {expandedMore && quickFilters.map(item => {
                            const count = getSidebarCount(item.id);
                            return (
                                <button
                                    key={item.id}
                                    onMouseDown={() => applyNavFilterState(item.id)}
                                    onClick={() => handleNavFilter(item.id)}
                                    className={clsx(
                                        'w-full flex items-center justify-between px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors',
                                        activeSidebarItem.kind === 'filter' && activeSidebarItem.id === item.id
                                            ? 'bg-white text-[var(--color-primary)] shadow-sm'
                                            : 'text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-primary)]'
                                    )}
                                >
                                    <div className="flex items-center gap-2.5">
                                        <item.icon className="w-4 h-4" />
                                        {item.label}
                                    </div>
                                    {count > 0 && <span className="text-[10px] opacity-50">{count}</span>}
                                </button>
                            );
                        })}
                    </div>

                    <div className="h-px bg-[var(--color-card-border)]/50 mx-3 my-2" />

                    {/* Folders */}
                    <div className="pb-2">
                        <button
                            className="w-full flex items-center justify-between px-3 mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]/60 hover:text-[var(--color-text-primary)] transition-colors"
                            onClick={() => setExpandedFolders(!expandedFolders)}
                            style={{ fontFamily: 'var(--font-ui)' }}
                        >
                            Folders
                            <ChevronDown className={clsx('w-3 h-3 transition-transform', expandedFolders ? '' : '-rotate-90')} />
                        </button>
                        {expandedFolders && (
                            <div className="space-y-0.5">
                                {navFolderItems.map(folder => {
                                    const Icon = folderIcons[folder.type];
                                    const isActive = activeSidebarItem.kind === 'folder' && activeSidebarItem.id === folder.id;
                                    return (
                                        <button
                                            key={folder.id}
                                            onClick={() => {
                                                setActiveFolderId(folder.id);
                                                setActiveTagId(null);
                                                setSelectedType('All');
                                                setActiveSidebarItem({ kind: 'folder', id: folder.id });
                                            }}
                                            className={clsx(
                                                'w-full flex items-center justify-between px-3 py-1.5 text-[13px] rounded-lg border transition-colors',
                                                isActive
                                                    ? 'bg-white border-[var(--color-card-border)] text-[var(--color-text-primary)] shadow-sm'
                                                    : 'bg-transparent border-transparent text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-primary)]'
                                            )}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <Icon className="w-4 h-4 shrink-0" />
                                                <span className="truncate" style={{ fontFamily: 'var(--font-body)' }}>{folder.name}</span>
                                            </div>
                                            {folder.unreadCount > 0 && (
                                                <span
                                                    className={clsx(
                                                        'ml-2 min-w-5 px-1.5 py-0.5 rounded-full text-[10px] leading-none border',
                                                        isActive
                                                            ? 'bg-[var(--color-background)] text-[var(--color-text-primary)] border-[var(--color-card-border)]'
                                                            : 'bg-white text-[var(--color-text-muted)] border-[var(--color-card-border)]/70'
                                                    )}
                                                    style={{ fontFamily: 'var(--font-ui)' }}
                                                >
                                                    {folder.unreadCount}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                                <button
                                    onClick={() => {
                                        setActiveTagId(null);
                                        setSelectedType('All');
                                        setActiveFilter('mailbox-starred');
                                        setActiveSidebarItem({ kind: 'filter', id: 'mailbox-starred' });
                                    }}
                                    className={clsx(
                                        'w-full flex items-center justify-between px-3 py-1.5 text-[13px] rounded-lg border transition-colors',
                                        activeSidebarItem.kind === 'filter' && activeSidebarItem.id === 'mailbox-starred'
                                            ? 'bg-white border-[var(--color-card-border)] text-[var(--color-text-primary)] shadow-sm'
                                            : 'bg-transparent border-transparent text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-primary)]'
                                    )}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <Star className="w-4 h-4 shrink-0" />
                                        <span className="truncate" style={{ fontFamily: 'var(--font-body)' }}>Starred</span>
                                    </div>
                                    {mailboxDerivedCounts.starred > 0 && (
                                        <span className="ml-2 min-w-5 px-1.5 py-0.5 rounded-full text-[10px] leading-none border bg-white text-[var(--color-text-muted)] border-[var(--color-card-border)]/70">
                                            {mailboxDerivedCounts.starred}
                                        </span>
                                    )}
                                </button>
                                <button
                                    onClick={() => {
                                        setActiveTagId(null);
                                        setSelectedType('All');
                                        setActiveFilter('mailbox-archive');
                                        setActiveSidebarItem({ kind: 'filter', id: 'mailbox-archive' });
                                    }}
                                    className={clsx(
                                        'w-full flex items-center justify-between px-3 py-1.5 text-[13px] rounded-lg border transition-colors',
                                        activeSidebarItem.kind === 'filter' && activeSidebarItem.id === 'mailbox-archive'
                                            ? 'bg-white border-[var(--color-card-border)] text-[var(--color-text-primary)] shadow-sm'
                                            : 'bg-transparent border-transparent text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-primary)]'
                                    )}
                                >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        <Archive className="w-4 h-4 shrink-0" />
                                        <span className="truncate" style={{ fontFamily: 'var(--font-body)' }}>Archive</span>
                                    </div>
                                    {mailboxDerivedCounts.archive > 0 && (
                                        <span className="ml-2 min-w-5 px-1.5 py-0.5 rounded-full text-[10px] leading-none border bg-white text-[var(--color-text-muted)] border-[var(--color-card-border)]/70">
                                            {mailboxDerivedCounts.archive}
                                        </span>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="pb-2">
                        <button
                            className="w-full flex items-center justify-between px-3 mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]/60 hover:text-[var(--color-text-primary)] transition-colors"
                            onClick={() => setExpandedTags(!expandedTags)}
                            style={{ fontFamily: 'var(--font-ui)' }}
                        >
                            Tags
                            <ChevronDown className={clsx('w-3 h-3 transition-transform', expandedTags ? '' : '-rotate-90')} />
                        </button>
                        {expandedTags && (
                            <div className="space-y-0.5">
                                {organizationTags.map((tagObj: any) => {
                                    const isActive = activeSidebarItem.kind === 'tag' && activeSidebarItem.id === tagObj.id;
                                    return (
                                        <button
                                            key={tagObj.id}
                                            onClick={() => {
                                                setActiveTagId(tagObj.id);
                                                setSelectedType(tagObj.name || 'All');
                                                setActiveSidebarItem({ kind: 'tag', id: tagObj.id });
                                            }}
                                            className={clsx(
                                                'w-full flex items-center justify-between px-3 py-1.5 text-[13px] rounded-lg border transition-colors',
                                                isActive
                                                    ? 'bg-white border-[var(--color-card-border)] text-[var(--color-text-primary)] shadow-sm'
                                                    : 'bg-transparent border-transparent text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-primary)]'
                                            )}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagObj.color || 'var(--color-primary)' }} />
                                                <span className="truncate">{tagObj.name}</span>
                                            </div>
                                            {Number(tagCounts[tagObj.id] || 0) > 0 && (
                                                <span className="ml-2 min-w-5 px-1.5 py-0.5 rounded-full text-[10px] leading-none border bg-white text-[var(--color-text-muted)] border-[var(--color-card-border)]/70">
                                                    {Number(tagCounts[tagObj.id] || 0)}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                                {personalTags.length > 0 && (
                                    <p className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]/70">Personal</p>
                                )}
                                {personalTags.map((tagObj: any) => {
                                    const isActive = activeSidebarItem.kind === 'tag' && activeSidebarItem.id === tagObj.id;
                                    return (
                                        <button
                                            key={tagObj.id}
                                            onClick={() => {
                                                setActiveTagId(tagObj.id);
                                                setSelectedType(tagObj.name || 'All');
                                                setActiveSidebarItem({ kind: 'tag', id: tagObj.id });
                                            }}
                                            className={clsx(
                                                'w-full flex items-center justify-between px-3 py-1.5 text-[13px] rounded-lg border transition-colors',
                                                isActive
                                                    ? 'bg-white border-[var(--color-card-border)] text-[var(--color-text-primary)] shadow-sm'
                                                    : 'bg-transparent border-transparent text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text-primary)]'
                                            )}
                                        >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagObj.color || 'var(--color-primary)' }} />
                                                <span className="truncate">{tagObj.name}</span>
                                            </div>
                                            {Number(tagCounts[tagObj.id] || 0) > 0 && (
                                                <span className="ml-2 min-w-5 px-1.5 py-0.5 rounded-full text-[10px] leading-none border bg-white text-[var(--color-text-muted)] border-[var(--color-card-border)]/70">
                                                    {Number(tagCounts[tagObj.id] || 0)}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                </nav>
                {/* Pagination Controls */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-[var(--color-background)] shrink-0">
                    <div className="flex-1 flex items-center justify-start">
                        <div className="inline-grid grid-cols-[28px_auto_28px] items-center gap-1">
                            <button
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={currentPage === 1}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                aria-label="Previous page"
                            >
                                <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <span className="px-0.5 text-center text-sm font-semibold text-[var(--color-text-primary)]">
                                {currentPage}/{Math.max(1, totalPages)}
                            </span>
                            <button
                                onClick={() => setCurrentPage(prev => Math.min(Math.max(1, totalPages), prev + 1))}
                                disabled={currentPage >= Math.max(1, totalPages)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                aria-label="Next page"
                            >
                                <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>

                    <div className="hidden xl:flex flex-1 items-center justify-end">
                        <button
                            type="button"
                            onClick={() => setIsSplitMode(prev => !prev)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--color-card-border)] bg-white text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
                            aria-label={splitPanelLabel}
                            title={splitPanelLabel}
                        >
                            <Columns2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>



            {/* ── Main Content ── */}
            {isThreadLoading && !isSplitMode ? (
                <div className="flex-1 flex overflow-hidden bg-white"><ThreadDetailSkeleton /></div>
            ) : isPageLoading ? (
                <div className="flex-1 flex overflow-hidden bg-white"><ThreadDetailSkeleton /></div>
            ) : hasAttachedMailbox === false ? (
                <div className="flex-1 flex items-center justify-center bg-[var(--color-background)]/20 px-6">
                    <div className="max-w-md text-center">
                        <InboxIcon className="w-10 h-10 opacity-20 mx-auto mb-3 text-[var(--color-text-muted)]" />
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">No mailbox attached</p>
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">Attach a mailbox to start viewing and replying to threads.</p>
                        <button
                            type="button"
                            onClick={() => navigate('/settings/organization?tab=mailboxes')}
                            className="mt-4 px-3.5 py-2 bg-white border border-[var(--color-card-border)] rounded-lg text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors shadow-sm"
                        >
                            Go to Mailboxes
                        </button>
                    </div>
                </div>
            ) : (isSplitMode || actualOpenThread) ? (
                /* Thread Detail View */
                <div className="flex-1 flex overflow-hidden">
                    {isSplitMode && (
                        <div className={`${(!isLg && !actualOpenThread) ? 'flex' : 'hidden xl:flex'} w-full xl:w-[25rem] xl:max-w-[34vw] shrink-0 flex-col border-r border-[var(--color-card-border)] bg-white text-[var(--color-text-primary)]`}>
                            {/* Search Row */}
                            <div className="px-4 py-3 border-b border-[var(--color-card-border)]">
                                <div className="relative">
                                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                                    <input
                                        type="text"
                                        placeholder="Search threads..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="w-full pl-8 pr-3 py-1.5 text-[13px] border border-[var(--color-card-border)] rounded-lg focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* Filters Row */}
                            <div className="px-3 py-2.5 border-b border-[var(--color-card-border)] flex items-center gap-2 flex-wrap">
                                {/* All Tags */}
                                <div className="relative dropdown-container">
                                    <button
                                        onClick={() => setOpenDropdown(openDropdown === 'split-tags' ? null : 'split-tags')}
                                        className={clsx(
                                            "relative appearance-none pl-7 pr-7 py-1 text-[11px] font-medium border border-[var(--color-card-border)] rounded-lg bg-white shadow-sm cursor-pointer transition-colors flex items-center h-[28px]",
                                            openDropdown === 'split-tags'
                                                ? "bg-[var(--color-background)] text-[var(--color-text-primary)]"
                                                : "hover:bg-[var(--color-background)] text-[var(--color-text-primary)]"
                                        )}
                                    >
                                        <Tag className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                                        <span className="truncate max-w-[80px]">{activeTagName ?? 'All Tags'}</span>
                                        <ChevronDown className={clsx("w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] transition-transform pointer-events-none", openDropdown === 'split-tags' && "rotate-180")} />
                                    </button>
                                    {openDropdown === 'split-tags' && (
                                        <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1 origin-top-left animate-in fade-in slide-in-from-top-2 duration-150">
                                            <button
                                                onClick={() => {
                                                    setActiveTagId(null);
                                                    setSelectedType('All');
                                                    if (activeFolderId) {
                                                        setActiveSidebarItem({ kind: 'folder', id: activeFolderId });
                                                    } else {
                                                        setActiveSidebarItem({ kind: 'filter', id: activeFilter });
                                                    }
                                                    setOpenDropdown(null);
                                                }}
                                                className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between font-medium text-[var(--color-text-primary)]"
                                            >
                                                All Tags
                                                {!activeTagId && <Check className="w-3.5 h-3.5 text-[var(--color-primary)]" />}
                                            </button>
                                            <div className="h-px bg-[var(--color-card-border)]/50 mx-2 my-1" />
                                            {apiTags.map((tagObj: any) => (
                                                <button
                                                    key={tagObj.id}
                                                    onClick={() => {
                                                        const nextTagId = activeTagId === tagObj.id ? null : tagObj.id;
                                                        setActiveTagId(nextTagId);
                                                        setSelectedType(nextTagId ? tagObj.name : 'All');
                                                        setActiveSidebarItem(
                                                            nextTagId
                                                                ? { kind: 'tag', id: nextTagId }
                                                                : (activeFolderId
                                                                    ? { kind: 'folder', id: activeFolderId }
                                                                    : { kind: 'filter', id: activeFilter })
                                                        );
                                                        setOpenDropdown(null);
                                                    }}
                                                    className="w-full text-left px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)] flex justify-between items-center"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tagObj.color || 'var(--color-primary)' }}></span>
                                                        {tagObj.name}
                                                    </div>
                                                    {activeTagId === tagObj.id && <Check className="w-3.5 h-3.5 text-[var(--color-primary)]" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Status */}
                                <div className="relative dropdown-container">
                                    <button
                                        onClick={() => setOpenDropdown(openDropdown === 'split-status' ? null : 'split-status')}
                                        className={clsx(
                                            'relative appearance-none pl-3 pr-7 py-1 text-[11px] font-medium border border-[var(--color-card-border)] rounded-lg bg-white shadow-sm cursor-pointer transition-colors flex items-center h-[28px]',
                                            openDropdown === 'split-status'
                                                ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]'
                                                : 'hover:bg-[var(--color-background)] text-[var(--color-text-primary)]'
                                        )}
                                    >
                                        <span className="truncate">Status: {selectedStatus.replace('_', ' ')}</span>
                                        <ChevronDown className={clsx('w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] transition-transform pointer-events-none', openDropdown === 'split-status' && 'rotate-180')} />
                                    </button>
                                    {openDropdown === 'split-status' && (
                                        <div className="absolute left-0 top-full mt-1 w-40 bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1 origin-top animate-in fade-in slide-in-from-top-2 duration-150">
                                            {statusFilterOptions.map(status => (
                                                <button
                                                    key={status}
                                                    onClick={() => {
                                                        setSelectedStatus(status);
                                                        setOpenDropdown(null);
                                                    }}
                                                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between"
                                                >
                                                    <span className="capitalize">{status.replace('_', ' ')}</span>
                                                    {selectedStatus === status && <Check className="w-3.5 h-3.5 text-[var(--color-primary)]" />}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="ml-auto">
                                    <button
                                        onClick={() => setIsComposeOpen(true)}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-[var(--color-cta-primary)] text-white text-[11px] font-medium rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors shadow-sm h-[28px]"
                                    >
                                        <Plus className="w-3 h-3" />
                                        Compose
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto no-scrollbar p-3 space-y-2.5">
                                {isThreadListLoading ? (
                                    <InboxThreadListSkeleton />
                                ) : (
                                    threads.map((thread) => {
                                        const isCurrentThread = actualOpenThread && String(thread.id).replace('t', '') === String(actualOpenThread.id).replace('t', '');
                                        return (
                                            <button
                                                type="button"
                                                key={thread.id}
                                                onClick={() => navigate(toThreadPath(thread.id))}
                                                className={clsx(
                                                    'w-full text-left rounded-xl border p-3 transition-colors',
                                                    isCurrentThread
                                                        ? 'border-[var(--color-primary)]/40 bg-[var(--color-background)]'
                                                        : 'border-[var(--color-card-border)] bg-white hover:border-[var(--color-primary)]/30 hover:bg-[var(--color-background)]/40'
                                                )}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-[12px] font-semibold text-[var(--color-text-primary)] truncate">{thread.from.split('@')[0]}</span>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                        <span
                                                            role="button"
                                                            tabIndex={0}
                                                            onClick={(event) => {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                                handleToggleStar(thread.id).catch(console.error);
                                                            }}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter' || event.key === ' ') {
                                                                    event.preventDefault();
                                                                    event.stopPropagation();
                                                                    handleToggleStar(thread.id).catch(console.error);
                                                                }
                                                            }}
                                                            className="p-1 rounded-md hover:bg-[var(--color-background)] text-[var(--color-text-muted)]"
                                                            title={thread.starred ? 'Unstar thread' : 'Star thread'}
                                                        >
                                                            <Star className={clsx('w-3.5 h-3.5', thread.starred && 'fill-yellow-400 text-yellow-500')} />
                                                        </span>
                                                        <span className="text-[10px] text-[var(--color-text-muted)]">
                                                            {new Date(thread.time || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="mt-1 text-[13px] font-medium text-[var(--color-text-primary)] truncate">{thread.subject}</div>
                                                <div className="mt-1 text-[11px] text-[var(--color-text-muted)] truncate">{thread.snippet}</div>
                                                <div className="mt-2 flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{statusMap[thread.status]?.label || thread.status}</span>
                                                        {Number(thread.noteCount || 0) > 0 && (
                                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-card-border)] text-[var(--color-text-muted)] bg-[var(--color-background)]/60">
                                                                {thread.noteCount} notes
                                                            </span>
                                                        )}
                                                    </div>
                                                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]/50" />
                                                </div>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    )}

                    {isThreadLoading ? (
                        <div className="flex-1 flex overflow-hidden bg-white"><ThreadDetailSkeleton /></div>
                    ) : actualOpenThread ? (
                        <>
                            {/* Main Chat Column */}
                            <div className="flex-1 flex flex-col min-w-0 border-r border-[var(--color-card-border)] bg-white">
                        {/* Meta bar */}
                        <div className="px-3 sm:px-5 py-2.5 border-b border-[var(--color-card-border)] bg-white flex flex-col gap-2 shrink-0">
                            {/* Row 1: back arrow + title + status */}
                            <div className="flex items-center gap-2 min-w-0">
                                {(!isSplitMode || !isLg) && (
                                    <button
                                        onClick={() => navigate('/inbox')}
                                        className="p-1.5 -ml-1 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)] transition-colors shrink-0"
                                        title="Back to Inbox"
                                    >
                                        <ArrowLeft className="w-4 h-4" />
                                    </button>
                                )}
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-[15px] font-bold truncate text-[var(--color-text-primary)]">
                                        {actualOpenThread.subject || 'Urgent Shipping Availability'}
                                    </h2>
                                    <p className="text-[11px] truncate mt-0.5 text-[var(--color-text-muted)]">
                                        From {actualOpenThread.from} to support@sermuno.com
                                    </p>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                        {actualOpenThread.priority && (
                                            <span className={clsx(
                                                'px-1.5 py-0.5 rounded-md text-[10px] border',
                                                actualOpenThread.priority === 'high'
                                                    ? 'border-red-200 text-red-700 bg-red-50'
                                                    : actualOpenThread.priority === 'normal'
                                                        ? 'border-amber-200 text-amber-700 bg-amber-50'
                                                        : 'border-[var(--color-card-border)] text-[var(--color-text-muted)] bg-[var(--color-background)]/50'
                                            )}>
                                                Priority: {String(actualOpenThread.priority).toUpperCase()}
                                            </span>
                                        )}
                                        {actualOpenThread.assignedTeamName && (
                                            <span className="px-1.5 py-0.5 rounded-md text-[10px] border border-[var(--color-card-border)] text-[var(--color-text-muted)] bg-[var(--color-background)]/50">
                                                Team: {actualOpenThread.assignedTeamName}
                                            </span>
                                        )}
                                        {actualOpenThread.slaBreached && (
                                            <span className="px-1.5 py-0.5 rounded-md text-[10px] border border-red-200 text-red-700 bg-red-50">
                                                SLA Breached
                                            </span>
                                        )}
                                        {!actualOpenThread.slaBreached && actualOpenThread.firstResponseDueAt && (
                                            <span className="px-1.5 py-0.5 rounded-md text-[10px] border border-sky-200 text-sky-700 bg-sky-50">
                                                First Response Due: {new Date(actualOpenThread.firstResponseDueAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        )}
                                        {!actualOpenThread.slaBreached && actualOpenThread.resolutionDueAt && (
                                            <span className="px-1.5 py-0.5 rounded-md text-[10px] border border-amber-200 text-amber-700 bg-amber-50">
                                                SLA Due: {new Date(actualOpenThread.resolutionDueAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        )}
                                        {Number(actualOpenThread.noteCount || 0) > 0 && (
                                            <span className="px-1.5 py-0.5 rounded-md text-[10px] border border-[var(--color-card-border)] text-[var(--color-text-muted)] bg-[var(--color-background)]/50">
                                                Notes: {Number(actualOpenThread.noteCount || 0)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="relative dropdown-container">
                                        <button
                                            onClick={() => setOpenDropdown(openDropdown === 'status' ? null : 'status')}
                                            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium border border-[var(--color-card-border)] rounded-lg hover:bg-[var(--color-background)] transition-colors text-[var(--color-text-primary)] shadow-sm bg-white"
                                        >
                                            <Check className="w-3.5 h-3.5" />
                                            Mark as...
                                            <ChevronDown className={clsx("w-3 h-3 ml-0.5 opacity-50 transition-transform", openDropdown === 'status' && "rotate-180")} />
                                        </button>

                                        {openDropdown === 'status' && (
                                            <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1 origin-top-left animate-in fade-in slide-in-from-top-2 duration-150">
                                                {['new', 'in_progress', 'waiting', 'done', 'archived'].map(status => (
                                                    <button
                                                        key={status}
                                                        onClick={() => handleStatusChange(actualOpenThread.id, status).catch(console.error)}
                                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between"
                                                    >
                                                        <span className="capitalize">{status.replace('_', ' ')}</span>
                                                        {actualOpenThread.status === status && <Check className="w-3 h-3 text-[var(--color-primary)]" />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="relative dropdown-container">
                                        <button
                                            onClick={() => setOpenDropdown(openDropdown === 'snooze' ? null : 'snooze')}
                                            className="flex items-center justify-center p-1.5 border border-[var(--color-card-border)] rounded-lg hover:bg-[var(--color-background)] transition-colors text-[var(--color-text-muted)] shadow-sm bg-white"
                                            title="Snooze"
                                        >
                                            <Clock className="w-4 h-4" />
                                        </button>

                                        {openDropdown === 'snooze' && (
                                            <div
                                                className={clsx(
                                                    "absolute top-full mt-1 bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1 origin-top-left animate-in fade-in slide-in-from-top-2 duration-150 sm:left-0 left-1/2 sm:transform-none -translate-x-1/2",
                                                    showCustomSnoozeDatePicker ? "w-[min(18rem,calc(100vw-2rem))]" : "w-56"
                                                )}
                                            >
                                                {[
                                                    { label: 'Later today', value: 'later today' },
                                                    { label: 'Tomorrow', value: 'tomorrow' },
                                                    { label: 'Next week', value: 'next week' },
                                                    { label: 'Pick date...', value: 'custom date' },
                                                ].map(preset => (
                                                    <button
                                                        key={preset.value}
                                                        onClick={() => {
                                                            if (preset.value === 'custom date') {
                                                                setShowCustomSnoozeDatePicker(true);
                                                                return;
                                                            }
                                                            setShowCustomSnoozeDatePicker(false);
                                                            const targetDate = new Date();
                                                            if (preset.value === 'later today') {
                                                                targetDate.setHours(targetDate.getHours() + 4);
                                                            } else if (preset.value === 'tomorrow') {
                                                                targetDate.setDate(targetDate.getDate() + 1);
                                                                targetDate.setHours(9, 0, 0, 0);
                                                            } else if (preset.value === 'next week') {
                                                                targetDate.setDate(targetDate.getDate() + 7);
                                                                targetDate.setHours(9, 0, 0, 0);
                                                            }
                                                            handleSnooze(actualOpenThread.id, targetDate).catch(console.error);
                                                        }}
                                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between text-[var(--color-text-primary)]"
                                                    >
                                                        {preset.label}
                                                    </button>
                                                ))}
                                                {showCustomSnoozeDatePicker && (
                                                    <div className="px-2 pb-2 pt-1 w-full">
                                                        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/60 p-2 max-w-full overflow-hidden">
                                                            <SaasCalendarPicker
                                                                value={customSnoozeDate}
                                                                onChange={setCustomSnoozeDate}
                                                                minDate={new Date()}
                                                            />
                                                        </div>
                                                        <div className="mt-2 flex items-center justify-end gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => setShowCustomSnoozeDatePicker(false)}
                                                                className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-[var(--color-card-border)] text-[var(--color-text-primary)] hover:bg-white"
                                                            >
                                                                Cancel
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={!customSnoozeDate}
                                                                onClick={() => {
                                                                    if (!customSnoozeDate) return;
                                                                    handleSnooze(actualOpenThread.id, customSnoozeDate).catch(console.error);
                                                                    setCustomSnoozeDate(null);
                                                                    setShowCustomSnoozeDatePicker(false);
                                                                }}
                                                                className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-[var(--color-cta-primary)] text-white hover:bg-[var(--color-cta-secondary)] disabled:opacity-60"
                                                            >
                                                                Apply
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="h-px bg-[var(--color-card-border)] my-1"></div>
                                                <button
                                                    onClick={() => handleSnooze(actualOpenThread.id, null).catch(console.error)}
                                                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-orange-50 text-orange-600 transition-colors flex items-center justify-between"
                                                >
                                                    Remove snooze
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="relative dropdown-container">
                                        <button
                                            onClick={() => setOpenDropdown(openDropdown === 'more' ? null : 'more')}
                                            title="Thread actions"
                                            aria-label="Thread actions"
                                            data-testid="thread-actions-menu"
                                            className={clsx(
                                        "p-1.5 border border-[var(--color-card-border)] rounded-lg hover:bg-[var(--color-background)] transition-colors text-[var(--color-text-muted)] shadow-sm bg-white",
                                        openDropdown === 'more' && "bg-[var(--color-background)] text-[var(--color-text-primary)]"
                                    )}
                                            >
                                                <MoreHorizontal className="w-4 h-4" />
                                            </button>
                                            {openDropdown === 'more' && actualOpenThread && (
                                                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1">
                                                    <button
                                                        onClick={() => handleToggleStar(actualOpenThread.id).catch(console.error)}
                                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between"
                                                    >
                                                        <span>{actualOpenThread.starred ? 'Remove star' : 'Star thread'}</span>
                                                        <Star className={clsx('w-3.5 h-3.5', actualOpenThread.starred && 'fill-yellow-400 text-yellow-500')} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleSetThreadReadState(actualOpenThread.id, actualOpenThread.unreadCount > 0).catch(console.error)}
                                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors"
                                                    >
                                                        {actualOpenThread.unreadCount > 0 ? 'Mark as read' : 'Mark as unread'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleToggleArchive(actualOpenThread.id, actualOpenThread.status === 'archived').catch(console.error)}
                                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors"
                                                    >
                                                        {actualOpenThread.status === 'archived' ? 'Unarchive thread' : 'Archive thread'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                </div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6">
                            {localMessages.map(msg => {
                                const isOutbound = msg.direction === 'OUTBOUND';
                                const isInternalNote = msg.type === 'internal-note';
                                const isInbound = msg.direction === 'INBOUND';
                                const isRead = msg.isRead !== false;
                                const messageAttachments = Array.isArray(msg.attachments) ? msg.attachments : [];
                                const noteAvatarUrl = resolveAvatarUrl(isInternalNote ? (msg.user?.avatarUrl || user?.avatarUrl) : undefined);
                                return (
                                    <div key={msg.id} className={clsx('flex flex-col max-w-[85%]', isOutbound || isInternalNote ? 'ml-auto items-end' : 'mr-auto items-start')}>
                                        <div className={clsx('flex items-center gap-2 mb-1.5 px-1', isOutbound || isInternalNote ? 'flex-row-reverse' : '')}>
                                            <div className="w-6 h-6 rounded-full flex items-center justify-center border shrink-0" style={{ backgroundColor: isInternalNote ? '#fffbec' : 'var(--color-background)', borderColor: isInternalNote ? '#fae8b7' : 'var(--color-card-border)' }}>
                                                {isInternalNote && noteAvatarUrl ? (
                                                    <img src={noteAvatarUrl} alt={msg.user?.fullName || user?.fullName || 'Note author'} className="w-full h-full rounded-full object-cover" />
                                                ) : (
                                                    <User className="w-3 h-3 text-[var(--color-primary)]" />
                                                )}
                                            </div>
                                            <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
                                                {isInternalNote ? 'Internal Note' : (isOutbound ? 'Me' : msg.fromEmail.split('@')[0])}
                                            </span>
                                            <span className="text-[11px] text-[var(--color-text-muted)]">
                                                {new Date(msg.createdAt).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                            {!isInternalNote && actualOpenThread && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleStar(String(actualOpenThread.id)).catch(console.error)}
                                                    className="p-1 rounded-md border border-[var(--color-card-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
                                                    title={actualOpenThread.starred ? 'Unstar thread' : 'Star thread'}
                                                >
                                                    <Star className={clsx('w-3 h-3', actualOpenThread.starred && 'fill-yellow-400 text-yellow-500')} />
                                                </button>
                                            )}
                                            {!isInternalNote && isInbound && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleToggleMessageReadState(String(msg.id), isRead).catch(console.error)}
                                                    className="px-1.5 py-0.5 text-[10px] rounded border border-[var(--color-card-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
                                                >
                                                    {isRead ? 'Mark unread' : 'Mark read'}
                                                </button>
                                            )}
                                        </div>
                                        <div className="relative flex items-start gap-2" style={{ flexDirection: isInternalNote || isOutbound ? 'row-reverse' : 'row' }}>
                                            <div className={clsx(
                                                'relative rounded-2xl p-4 text-[13px] leading-relaxed shadow-sm',
                                                isInternalNote
                                                    ? 'bg-[#fffbec] border border-[#fae8b7] text-[var(--color-text-primary)] rounded-tr-sm pr-10'
                                                    : isOutbound
                                                    ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 text-[var(--color-text-primary)] rounded-tr-sm'
                                                    : 'bg-white border border-[var(--color-card-border)] text-[var(--color-text-primary)] rounded-tl-sm'
                                            )}>
                                                {isInternalNote && (
                                                    <div className="absolute top-1.5 right-1.5 dropdown-container">
                                                        <button
                                                            onClick={() => setOpenDropdown(openDropdown === `note-menu-${msg.id}` ? null : `note-menu-${msg.id}`)}
                                                            className="p-1 rounded hover:bg-[#fae8b7] transition-colors"
                                                        >
                                                            <MoreHorizontal className="w-4 h-4 text-[var(--color-text-muted)]" />
                                                        </button>
                                                        {openDropdown === `note-menu-${msg.id}` && (
                                                            <div className="absolute right-0 bottom-full mb-1 w-32 bg-white border border-[var(--color-card-border)] rounded-lg shadow-lg z-50 py-1">
                                                                <button
                                                                    onClick={() => {
                                                                        handleEditNote(msg.id, msg.bodyText);
                                                                        setOpenDropdown(null);
                                                                    }}
                                                                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors"
                                                                >
                                                                    Edit
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        handleDeleteNote(msg.id);
                                                                        setOpenDropdown(null);
                                                                    }}
                                                                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-red-50 text-red-600 transition-colors"
                                                                >
                                                                    Delete
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                                <div className="prose prose-sm max-w-none break-words" dangerouslySetInnerHTML={{ __html: normalizeMessageBody(msg.bodyHtml, msg.bodyText) }} />
                                                {isInternalNote && Array.isArray(msg.mentionedUsers) && msg.mentionedUsers.length > 0 && (
                                                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[#fae8b7] pt-2 text-[11px] text-[var(--color-text-muted)]">
                                                        <span className="font-semibold text-[var(--color-text-primary)]">Mentions:</span>
                                                        {msg.mentionedUsers.map((mentionedUser: MentionedUser) => (
                                                            <span
                                                                key={mentionedUser.id}
                                                                className="inline-flex items-center rounded-full border border-[#fae8b7] bg-white/80 px-2 py-0.5"
                                                            >
                                                                @{mentionedUser.mentionKey} {mentionedUser.fullName}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {messageAttachments.length > 0 && (
                                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                                        {messageAttachments.map((attachment: any, index: number) => (
                                                            <button
                                                                key={String(attachment?.id || `${msg.id}-${index}`)}
                                                                type="button"
                                                                onClick={() => handleDownloadAttachment(String(msg.id), attachment)}
                                                                className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-md border border-[var(--color-card-border)] bg-white hover:bg-[var(--color-background)] text-[var(--color-text-muted)]"
                                                            >
                                                                <Paperclip className="w-3 h-3" />
                                                                <span className="max-w-[180px] truncate">{attachment?.filename || `Attachment ${index + 1}`}</span>
                                                                {formatSize(attachment?.sizeBytes) && <span className="opacity-70">({formatSize(attachment?.sizeBytes)})</span>}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                            {localMessages.length === 0 && (
                                <div className="text-center text-[var(--color-text-muted)] py-8">
                                    <p className="text-sm">No messages loaded for this thread preview.</p>
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        {/* Reply editor */}
                        <div className="px-4 pb-4 shrink-0 bg-[var(--color-background)]/30">
                        {/* Collapsed bar */}
                        {!isReplyExpanded ? (
                            <div
                                className="flex items-center gap-3 h-11 px-4 rounded-xl border border-[var(--color-card-border)] bg-white shadow-sm cursor-text"
                                onClick={() => setIsReplyExpanded(true)}
                            >
                                {resolveAvatarUrl(user?.avatarUrl) ? (
                                    <img src={resolveAvatarUrl(user?.avatarUrl)} alt="avatar" className="w-7 h-7 rounded-full shrink-0 object-cover" />
                                ) : (
                                    <div className="w-7 h-7 rounded-full bg-amber-400 flex items-center justify-center text-white text-[11px] font-bold shrink-0">
                                        {user?.fullName ? user.fullName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() : 'ME'}
                                    </div>
                                )}
                                <span className="text-[13px] text-[var(--color-text-muted)]">Reply...</span>
                            </div>
                        ) : (
                        <div className="rounded-xl border border-[var(--color-card-border)] bg-white shadow-sm overflow-hidden">
                            {/* Tab bar + icons */}
                            <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-4 pt-1">
                                <div className="flex items-center">
                                    <button
                                        onClick={() => {
                                            setReplyEditorTab('reply');
                                        }}
                                        className={clsx(
                                            'no-global-hover flex items-center gap-1 px-3 pb-2 pt-1 text-[13px] font-semibold border-b-2 transition-colors',
                                            replyEditorTab === 'reply'
                                                ? 'text-[var(--color-text-primary)] border-[var(--color-primary)]'
                                                : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text-primary)]'
                                        )}
                                    >
                                        <Reply className="w-3.5 h-3.5" />
                                        Reply
                                    </button>
                                    <button
                                        onClick={() => setReplyEditorTab('note')}
                                        className={clsx(
                                            'no-global-hover px-3 pb-2 pt-1 text-[13px] font-semibold border-b-2 transition-colors',
                                            replyEditorTab === 'note'
                                                ? 'text-[var(--color-text-primary)] border-[var(--color-primary)]'
                                                : 'text-[var(--color-text-muted)] border-transparent hover:text-[var(--color-text-primary)]'
                                        )}
                                    >
                                        Note
                                    </button>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        title="Plain text"
                                        className="no-global-hover p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
                                    >
                                        <Type className="w-4 h-4" />
                                    </button>
                                    {replyEditorTab === 'reply' && (
                                        <button
                                            title="Templates"
                                            onClick={() => setShowTemplateRow(p => !p)}
                                            className={clsx(
                                                'no-global-hover p-1.5 rounded-md transition-colors',
                                                showTemplateRow
                                                    ? 'text-[var(--color-primary)] bg-[var(--color-primary)]/10'
                                                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)]'
                                            )}
                                        >
                                            <FileText className="w-4 h-4" />
                                        </button>
                                    )}
                                    <button
                                        title="Attachment"
                                        className="no-global-hover p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
                                    >
                                        <Paperclip className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>

                            {replyEditorTab === 'reply' && (
                                <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-card-border)] bg-[var(--color-background)]/20">
                                    <span className="text-[11px] font-medium text-[var(--color-text-muted)] shrink-0 flex items-center gap-1">
                                        <FileSignature className="w-3.5 h-3.5" />
                                        Signature
                                    </span>
                                    <select
                                        value={selectedSignatureId}
                                        onChange={(event) => setSelectedSignatureId(event.target.value)}
                                        className="flex-1 min-w-0 text-[12px] border border-[var(--color-card-border)] rounded-md px-2 py-1 bg-white text-[var(--color-text-primary)]"
                                    >
                                        <option value="">No signature</option>
                                        {availableSignatures.map((signature) => (
                                            <option key={signature.id} value={signature.id}>{signature.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Template row */}
                            {showTemplateRow && replyEditorTab === 'reply' && (
                                <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-card-border)] bg-[var(--color-background)]/40">
                                    <span className="text-[12px] text-[var(--color-text-muted)] shrink-0">Template:</span>
                                    <select
                                        value={selectedTemplateId || ''}
                                        onChange={e => {
                                            const id = e.target.value;
                                            setSelectedTemplateId(id || null);
                                            const tpl = replyTemplates.find(t => t.id === id);
                                            if (tpl) setReplyHtml(tpl.bodyHtml);
                                        }}
                                        className="flex-1 text-[12px] font-medium text-[var(--color-primary)] bg-transparent border-none outline-none cursor-pointer"
                                    >
                                        <option value="">Select a template...</option>
                                        {replyTemplates.map(t => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Editor area */}
                            {replyEditorTab === 'reply' ? (
                                <div className="reply-quill-wrapper">
                                    {replyError && <div className="text-red-500 text-[11px] px-4 pt-2 font-medium">{replyError}</div>}
                                    <ReactQuill
                                        value={replyHtml}
                                        onChange={v => { setReplyHtml(v); if (v !== '<p><br></p>') setReplyError(''); }}
                                        placeholder="Type your reply..."
                                        modules={{
                                            toolbar: [
                                                ['bold', 'italic'],
                                                [{ align: [] }],
                                                [{ color: [] }, { background: [] }],
                                                ['link', 'image'],
                                            ],
                                        }}
                                        formats={['bold', 'italic', 'align', 'color', 'background', 'link', 'image']}
                                        className="reply-editor"
                                    />
                                    {/* Send footer */}
                                    <div className="relative flex items-center justify-between gap-2 px-4 py-2 border-t border-[var(--color-card-border)]">
                                        <div className="flex items-center gap-2">
                                            <div className="relative dropdown-container">
                                                <button
                                                    type="button"
                                                    onClick={() => setOpenDropdown(openDropdown === 'reply-after-send' ? null : 'reply-after-send')}
                                                    className="no-global-hover inline-flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-card-border)] bg-white text-[13px] font-medium rounded-lg hover:bg-[var(--color-background)] transition-colors"
                                                >
                                                    {replyAfterSendOptions.find((option) => option.value === replyScheduledState)?.label || 'Status'}
                                                    <ChevronDown className={clsx('w-3 h-3 opacity-60 transition-transform', openDropdown === 'reply-after-send' && 'rotate-180')} />
                                                </button>
                                                {openDropdown === 'reply-after-send' && (
                                                    <div className="absolute left-0 bottom-full mb-2 w-40 rounded-xl border border-[var(--color-card-border)] bg-white py-1 shadow-lg z-40">
                                                        {replyAfterSendOptions.map((option) => (
                                                            <button
                                                                key={option.value}
                                                                type="button"
                                                                onClick={() => {
                                                                    setReplyScheduledState(option.value);
                                                                    setOpenDropdown(null);
                                                                }}
                                                                className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between"
                                                            >
                                                                <span>{option.label}</span>
                                                                {replyScheduledState === option.value && <Check className="w-3.5 h-3.5 text-[var(--color-primary)]" />}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => setIsReplyScheduleOpen((prev) => !prev)}
                                                disabled={isReplying || !actualOpenThread}
                                                className="no-global-hover px-3 py-1.5 border border-[var(--color-card-border)] bg-white text-[13px] font-medium rounded-lg hover:bg-[var(--color-background)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Schedule
                                            </button>
                                        </div>
                                        {isReplyScheduleOpen && (
                                            <div className="absolute bottom-full right-4 z-40 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-card-border)] bg-white p-3 shadow-lg">
                                                <label className="mb-2 block text-xs font-medium text-[var(--color-text-primary)]">
                                                    Schedule reply for
                                                </label>
                                                <SaasCalendarPicker
                                                    value={replyScheduledAt}
                                                    onChange={setReplyScheduledAt}
                                                    includeTime
                                                    minDate={new Date()}
                                                />
                                                <label className="mb-1 mt-3 block text-xs font-medium text-[var(--color-text-primary)]">
                                                    Repeat
                                                </label>
                                                <select
                                                    value={replyRecurrencePreset}
                                                    onChange={(event) => setReplyRecurrencePreset(event.target.value as RecurrencePreset)}
                                                    className="block w-full rounded-md border border-[var(--color-input-border)] bg-white px-2.5 py-2 text-xs text-[var(--color-text-primary)]"
                                                >
                                                    <option value="none">Does not repeat</option>
                                                    <option value="daily">Daily</option>
                                                    <option value="weekdays">Weekdays</option>
                                                    <option value="weekly">Weekly</option>
                                                    <option value="monthly">Monthly</option>
                                                </select>
                                                <label className="mb-1 mt-3 block text-xs font-medium text-[var(--color-text-primary)]">
                                                    State after send
                                                </label>
                                                <select
                                                    value={replyScheduledState}
                                                    onChange={(event) => setReplyScheduledState(event.target.value as ScheduledStatePreset)}
                                                    className="block w-full rounded-md border border-[var(--color-input-border)] bg-white px-2.5 py-2 text-xs text-[var(--color-text-primary)]"
                                                >
                                                    {replyAfterSendOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>{option.label}</option>
                                                    ))}
                                                </select>
                                                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Timezone: {detectedTimezone}</p>
                                                <div className="mt-3 flex justify-end gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsReplyScheduleOpen(false)}
                                                        className="px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={handleScheduleReply}
                                                        disabled={
                                                            !replyScheduledAt
                                                            || isReplying
                                                            || replyHtml === ''
                                                            || replyHtml === '<p><br></p>'
                                                        }
                                                        className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--color-cta-primary)] rounded-md hover:bg-[var(--color-cta-secondary)] disabled:opacity-60"
                                                    >
                                                        Schedule Send
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <button
                                            onClick={() => handleReply()}
                                            disabled={
                                                replyHtml === ''
                                                || replyHtml === '<p><br></p>'
                                                || !actualOpenThread
                                                || isReplying
                                            }
                                            className="no-global-hover px-5 py-1.5 bg-[var(--color-cta-primary)] text-white text-[13px] font-semibold rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isReplying && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                            Send
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="note-quill-wrapper">
                                    <ReactQuill
                                        value={noteHtml}
                                        onChange={setNoteHtml}
                                        placeholder="Write an internal note..."
                                        modules={{
                                            toolbar: [
                                                ['bold', 'italic'],
                                                [{ align: [] }],
                                                [{ color: [] }, { background: [] }],
                                            ],
                                        }}
                                        formats={['bold', 'italic', 'align', 'color', 'background']}
                                        className="note-editor"
                                    />
                                    {/* Save note footer */}
                                    <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--color-card-border)]">
                                        <div className="flex items-center gap-2 flex-1">
                                            {editingNoteId && (
                                                <button
                                                    onClick={() => {
                                                        setEditingNoteId(null);
                                                        setNoteHtml('');
                                                    }}
                                                    className="no-global-hover px-3 py-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors underline"
                                                >
                                                    Cancel
                                                </button>
                                            )}
                                        </div>
                                        <button
                                            onClick={editingNoteId ? handleUpdateNote : handleSaveNote}
                                            disabled={noteHtml === '' || noteHtml === '<p><br></p>' || isSavingNote}
                                            className="no-global-hover shrink-0 px-5 py-1.5 bg-amber-500 text-white text-[13px] font-semibold rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {isSavingNote && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                            {editingNoteId ? 'Update Note' : 'Save Note'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        )}
                        </div>
                    </div>

                    {/* Right Side: Thread Details Box */}
                    <div className="w-80 shrink-0 overflow-y-auto hidden 2xl:block bg-[var(--color-background)]/20">
                        <div className="p-5 flex flex-col gap-6">

                            {/* Customer Section */}
                            <div className="bg-white border text-[13px] border-[var(--color-card-border)] rounded-xl p-4 shadow-sm">
                                <div className="flex items-center justify-between mb-3 text-[var(--color-text-muted)]">
                                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-primary)]">Customer</h3>
                                    <StatusBadge label={statusMap[actualOpenThread.status]?.label || actualOpenThread.status} variant={statusMap[actualOpenThread.status]?.variant || 'neutral'} />
                                </div>
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-10 h-10 rounded-full bg-[var(--color-background)] border border-[var(--color-card-border)] flex items-center justify-center text-sm font-bold text-[var(--color-primary)]">
                                        {actualOpenThread.from.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="font-semibold text-[var(--color-text-primary)] truncate">{actualOpenThread.from.split('@')[0]}</div>
                                        <div className="text-[11px] text-[var(--color-text-muted)] truncate">{actualOpenThread.from}</div>
                                    </div>
                                </div>
                                <div className="pt-3 border-t border-[var(--color-card-border)]/50 space-y-2">
                                    <div className="flex justify-between text-[12px]">
                                        <span className="text-[var(--color-text-muted)]">Timezone</span>
                                        <span className="font-medium text-[var(--color-text-primary)]">PST (Local)</span>
                                    </div>
                                    <div className="flex justify-between text-[12px]">
                                        <span className="text-[var(--color-text-muted)]">Joined</span>
                                        <span className="font-medium text-[var(--color-text-primary)]">Jan 2025</span>
                                    </div>
                                    <div className="flex justify-between text-[12px]">
                                        <span className="text-[var(--color-text-muted)]">Total Threads</span>
                                        <span className="font-medium text-[var(--color-text-primary)]">3</span>
                                    </div>
                                </div>
                            </div>

                            <hr className="border-[var(--color-card-border)]" />

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1">Contact activity</h3>
                                <div className="bg-white border border-[var(--color-card-border)] rounded-xl p-3 text-[12px] space-y-1 text-[var(--color-text-primary)] shadow-sm">
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Messages in thread</span><span>{localMessages.length}</span></div>
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Internal notes</span><span>{Number(actualOpenThread.noteCount || 0)}</span></div>
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Last activity</span><span>{new Date(actualOpenThread.time || Date.now()).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span></div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1">Company info</h3>
                                <div className="bg-white border border-[var(--color-card-border)] rounded-xl p-3 text-[12px] space-y-1 text-[var(--color-text-primary)] shadow-sm">
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Company</span><span className="truncate ml-2">{actualOpenThread.companyName || 'No company linked'}</span></div>
                                    <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Contact</span><span className="truncate ml-2">{actualOpenThread.contactName || actualOpenThread.from}</span></div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1">Thread participants</h3>
                                <div className="bg-white border border-[var(--color-card-border)] rounded-xl p-3 text-[12px] space-y-1 text-[var(--color-text-primary)] shadow-sm">
                                    {threadParticipants.length > 0 ? threadParticipants.map((participant) => (
                                        <div key={participant} className="truncate">{participant}</div>
                                    )) : <div className="text-[var(--color-text-muted)]">No participants found</div>}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1">Related threads</h3>
                                <div className="bg-white border border-[var(--color-card-border)] rounded-xl p-3 text-[12px] space-y-2 text-[var(--color-text-primary)] shadow-sm">
                                    {relatedThreads.length > 0 ? relatedThreads.map((thread) => (
                                        <button
                                            key={thread.id}
                                            type="button"
                                            onClick={() => navigate(toThreadPath(thread.id))}
                                            className="block w-full text-left truncate text-[var(--color-primary)] hover:underline"
                                        >
                                            {thread.subject}
                                        </button>
                                    )) : <div className="text-[var(--color-text-muted)]">No related threads</div>}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1">Thread history</h3>
                                <div className="bg-white border border-[var(--color-card-border)] rounded-xl p-3 text-[12px] space-y-1 text-[var(--color-text-primary)] shadow-sm">
                                    {activityLog.slice(0, 5).map((entry) => (
                                        <div key={entry.id} className="flex justify-between gap-2">
                                            <span className="truncate">{entry.text}</span>
                                            <span className="text-[var(--color-text-muted)] shrink-0">{entry.time}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Thread Info Section */}
                            <div className="space-y-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] px-1">Thread Details</h3>

                                <div className="space-y-3 px-1">
                                    <div className="relative dropdown-container">
                                        <label className="text-[11px] font-medium text-[var(--color-text-muted)] block mb-1">Assignee</label>
                                        <div
                                            onClick={() => setOpenDropdown(openDropdown === 'assignee' ? null : 'assignee')}
                                            className="flex items-center justify-between p-2 bg-white border border-[var(--color-card-border)] rounded-lg cursor-pointer hover:bg-[var(--color-background)] transition-colors shadow-sm"
                                        >
                                            <div className="flex items-center gap-2">
                                                <div className="w-5 h-5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-[10px] font-bold">
                                                    {actualOpenThread.assignedTo ? actualOpenThread.assignedTo.charAt(0) : '?'}
                                                </div>
                                                <span className="text-[13px] font-medium text-[var(--color-text-primary)]">
                                                    {actualOpenThread.assignedTo || 'Unassigned'}
                                                </span>
                                            </div>
                                            <ChevronDown className={clsx("w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform", openDropdown === 'assignee' && "rotate-180")} />
                                        </div>

                                        {openDropdown === 'assignee' && (
                                            <div className="absolute left-0 top-full mt-1 w-full bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-2 duration-150">
                                                <button
                                                    onClick={() => handleAssign(actualOpenThread.id, null).catch(console.error)}
                                                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center gap-2"
                                                >
                                                    <div className="w-5 h-5 rounded-full bg-[var(--color-background)] flex items-center justify-center text-[10px]">?</div>
                                                    <span className="text-[var(--color-text-muted)] italic">Unassigned</span>
                                                </button>
                                                {assigneeOptions.map(option => (
                                                    <button
                                                        key={`${option.type}:${option.id}`}
                                                        onClick={() => handleAssign(actualOpenThread.id, option).catch(console.error)}
                                                        className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center gap-2"
                                                    >
                                                        <div className="w-5 h-5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-[10px] font-bold">
                                                            {option.label.charAt(0)}
                                                        </div>
                                                        <span className={clsx(actualOpenThread.assignedTo === option.label ? 'font-semibold' : '')}>{option.label}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="relative dropdown-container">
                                        <label className="text-[11px] font-medium text-[var(--color-text-muted)] block mb-1">Tags</label>
                                        <div className="flex flex-wrap gap-1.5 p-2 bg-white border border-[var(--color-card-border)] rounded-lg min-h-[40px] items-center shadow-sm">
                                            {actualOpenThread.tags.map((tagName: string) => {
                                                const tagObj = apiTags.find(t => t.name === tagName);
                                                return (
                                                    <span key={tagName} className="px-2 py-0.5 bg-[var(--color-background)] text-[var(--color-text-primary)] rounded-md text-[11px] border border-[var(--color-card-border)] font-medium flex items-center gap-1.5 group">
                                                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tagObj?.color || 'gray' }}></span>
                                                        {tagName}
                                                        <button onClick={() => handleRemoveTag(tagName)} className="opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity">
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </span>
                                                );
                                            })}
                                            <button
                                                onClick={() => setOpenDropdown(openDropdown === 'tags' ? null : 'tags')}
                                                className="px-2 py-0.5 text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-primary)] border border-transparent hover:border-[var(--color-card-border)] rounded-md transition-colors border-dashed"
                                            >
                                                + Add Tag
                                            </button>
                                        </div>

                                        {openDropdown === 'tags' && (
                                            <div className="absolute left-0 top-full mt-1 w-full bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-2 duration-150">
                                                {apiTags.map(tagObj => (
                                                    <button
                                                        key={tagObj.id}
                                                        onClick={() => handleAddTag(tagObj.name)}
                                                        disabled={actualOpenThread.tags.includes(tagObj.name)}
                                                        className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-background)] flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tagObj.color }}></span>
                                                            {tagObj.name}
                                                        </div>
                                                        {actualOpenThread.tags.includes(tagObj.name) && <Check className="w-3 h-3 text-[var(--color-primary)]" />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    <div className="text-[11px] text-[var(--color-text-muted)] pt-2 space-y-1">
                                        <div className="flex justify-between">
                                            <span>Created</span>
                                            <span className="text-[var(--color-text-primary)]">{new Date(actualOpenThread.time || Date.now()).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span>Channel</span>
                                            <span className="text-[var(--color-text-primary)] capitalize">Email</span>
                                        </div>
                                    </div>
                                </div>
                            </div>



                        </div>
                    </div>
                        </>
                    ) : (
                        <div className={`flex-1 items-center justify-center bg-[var(--color-background)]/20 ${isLg ? 'flex' : 'hidden'}`}>
                            <div className="text-center">
                                <InboxIcon className="w-10 h-10 opacity-20 mx-auto mb-3 text-[var(--color-text-muted)]" />
                                <p className="text-sm font-medium text-[var(--color-text-primary)]">Select a thread to view details</p>
                            </div>
                        </div>
                    )}
                </div>
            ) : resolvedRouteThreadId && !actualOpenThread ? (
                <div className="flex-1 flex flex-col items-center justify-center bg-[var(--color-background)]/20">
                    <AlertCircle className="w-12 h-12 text-[var(--color-text-muted)] opacity-30 mb-4 mx-auto" />
                    <h3 className="text-base font-semibold text-[var(--color-text-primary)] mb-1 text-center">Thread not found</h3>
                    <p className="text-sm text-[var(--color-text-muted)] mb-6 text-center">The thread you're looking for doesn't exist or has been deleted.</p>
                    <button
                        onClick={() => navigate('/inbox')}
                        className="px-4 py-2 bg-white border border-[var(--color-card-border)] rounded-lg text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors shadow-sm"
                    >
                        Return to Inbox
                    </button>
                </div>
            ) : (
                /* Thread List (Table Style) */
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Mobile filter strip - visible only on small screens */}
                    <div className="md:hidden overflow-x-auto no-scrollbar border-b border-[var(--color-card-border)] bg-[var(--color-background)]/40 shrink-0">
                        <div className="flex items-center gap-1 px-2 py-2 min-w-max">
                            {allFilterItems.map(item => {
                                const count = getSidebarCount(item.id);
                                return (
                                    <button
                                        key={item.id}
                                        onMouseDown={() => applyNavFilterState(item.id)}
                                        onClick={() => handleNavFilter(item.id)}
                                        className={clsx(
                                            'flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg whitespace-nowrap transition-colors',
                                            activeSidebarItem.kind === 'filter' && activeSidebarItem.id === item.id
                                                ? 'bg-white text-[var(--color-primary)] shadow-sm border border-[var(--color-card-border)]'
                                                : 'text-[var(--color-text-muted)] hover:bg-white/60'
                                        )}
                                    >
                                        <item.icon className="w-3.5 h-3.5" />
                                        {item.label}
                                        {count > 0 && <span className="text-[10px] opacity-50 ml-0.5">({count})</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    {/* Filter bar */}
                    <div className="px-4 py-2 border-b border-[var(--color-card-border)] flex flex-wrap items-center justify-between gap-2 shrink-0 bg-white">
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                    className="pl-8 pr-3 py-1.5 text-[13px] border border-[var(--color-card-border)] rounded-lg focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none w-32 sm:w-48"
                                />
                            </div>

                            <div className="relative dropdown-container hidden md:block">
                                <button
                                    onClick={() => setOpenDropdown(openDropdown === 'filterTags' ? null : 'filterTags')}
                                    className={clsx(
                                        "appearance-none pl-8 pr-8 py-1.5 text-[12px] font-medium border border-[var(--color-card-border)] rounded-lg bg-white shadow-sm cursor-pointer transition-colors w-full text-left flex items-center h-[34px]",
                                        openDropdown === 'filterTags'
                                            ? "bg-[var(--color-background)] text-[var(--color-text-primary)]"
                                            : "hover:bg-[var(--color-background)] text-[var(--color-text-primary)]"
                                    )}
                                >
                                    <Tag className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                                    <span className="truncate">{activeTagName ?? 'All Tags'}</span>
                                    <ChevronDown className={clsx("w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] transition-transform pointer-events-none", openDropdown === 'filterTags' && "rotate-180")} />
                                </button>

                                {openDropdown === 'filterTags' && (
                                    <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1 origin-top-left animate-in fade-in slide-in-from-top-2 duration-150">
                                        <button
                                            onClick={() => {
                                                setActiveTagId(null);
                                                setSelectedType('All');
                                                if (activeFolderId) {
                                                    setActiveSidebarItem({ kind: 'folder', id: activeFolderId });
                                                } else {
                                                    setActiveSidebarItem({ kind: 'filter', id: activeFilter });
                                                }
                                                setOpenDropdown(null);
                                            }}
                                            className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between font-medium text-[var(--color-text-primary)]"
                                        >
                                            All Tags
                                            {!activeTagId && <Check className="w-3.5 h-3.5 text-[var(--color-primary)]" />}
                                        </button>
                                        <div className="h-px bg-[var(--color-card-border)]/50 mx-2 my-1" />
                                        {apiTags.map((tagObj: any) => (
                                            <button
                                                key={tagObj.id}
                                                onClick={() => {
                                                    const nextTagId = activeTagId === tagObj.id ? null : tagObj.id;
                                                    setActiveTagId(nextTagId);
                                                    setSelectedType(nextTagId ? tagObj.name : 'All');
                                                    setActiveSidebarItem(
                                                        nextTagId
                                                            ? { kind: 'tag', id: nextTagId }
                                                            : (activeFolderId
                                                                ? { kind: 'folder', id: activeFolderId }
                                                                : { kind: 'filter', id: activeFilter })
                                                    );
                                                    setOpenDropdown(null);
                                                }}
                                                className="w-full text-left px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)] flex justify-between items-center"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: tagObj.color || 'var(--color-primary)' }}></span>
                                                    {tagObj.name}
                                                </div>
                                                {activeTagId === tagObj.id && <Check className="w-3.5 h-3.5 text-[var(--color-primary)]" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="relative dropdown-container hidden md:block">
                                <button
                                    onClick={() => setOpenDropdown(openDropdown === 'list-status' ? null : 'list-status')}
                                    className={clsx(
                                        'appearance-none pl-3 pr-8 py-1.5 text-[12px] font-medium border border-[var(--color-card-border)] rounded-lg bg-white shadow-sm cursor-pointer transition-colors w-full text-left flex items-center h-[34px]',
                                        openDropdown === 'list-status'
                                            ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]'
                                            : 'hover:bg-[var(--color-background)] text-[var(--color-text-primary)]'
                                    )}
                                >
                                    <span className="truncate">Status: {selectedStatus.replace('_', ' ')}</span>
                                    <ChevronDown className={clsx('w-3 h-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] transition-transform pointer-events-none', openDropdown === 'list-status' && 'rotate-180')} />
                                </button>
                                {openDropdown === 'list-status' && (
                                    <div className="absolute left-0 top-full mt-1 w-40 bg-white border border-[var(--color-card-border)] rounded-xl shadow-lg z-50 py-1 origin-top animate-in fade-in slide-in-from-top-2 duration-150">
                                        {statusFilterOptions.map(status => (
                                            <button
                                                key={status}
                                                onClick={() => {
                                                    setSelectedStatus(status);
                                                    setOpenDropdown(null);
                                                }}
                                                className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--color-background)] transition-colors flex items-center justify-between"
                                            >
                                                <span className="capitalize">{status.replace('_', ' ')}</span>
                                                {selectedStatus === status && <Check className="w-3.5 h-3.5 text-[var(--color-primary)]" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                        </div>

                        <div className="flex items-center gap-1.5 min-w-max">
                            <button
                                onClick={() => setIsComposeOpen(true)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-cta-primary)] text-white text-[13px] font-medium rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors shadow-sm ml-2"
                            >
                                <Plus className="w-4 h-4" />
                                Compose
                            </button>
                        </div>

                    </div>

                    {/* ── Mobile: Gmail / Outlook-style thread list ── */}
                    <div className="md:hidden flex-1 overflow-y-auto divide-y divide-[var(--color-card-border)]/40 bg-white">
                        {threads.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-[var(--color-text-muted)]">
                                <InboxIcon className="w-10 h-10 opacity-20 mb-3" />
                                <p className="text-sm font-medium">No threads found</p>
                            </div>
                        ) : threads.map(thread => {
                            const rowTags = thread.tags || [];
                            return (
                                <div
                                    key={thread.id}
                                    onClick={() => navigate(toThreadPath(thread.id))}
                                    className={clsx(
                                        'flex items-start gap-3 px-4 py-3.5 active:bg-[var(--color-background)] transition-colors cursor-pointer',
                                        thread.unreadCount > 0 ? 'bg-white' : 'bg-[var(--color-background)]/20'
                                    )}
                                >
                                {/* Avatar */}
                                <div className={clsx(
                                    'w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 mt-0.5',
                                    thread.unreadCount > 0
                                        ? 'bg-[var(--color-primary)] text-white'
                                        : 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                                )}>
                                    {thread.from.charAt(0).toUpperCase()}
                                </div>
                                {/* Thread info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between gap-2 mb-0.5">
                                        <span className={clsx('text-[14px] truncate', thread.unreadCount > 0 ? 'font-bold text-[var(--color-text-primary)]' : 'font-medium text-[var(--color-text-muted)]')}>
                                            {thread.from.split('@')[0]}
                                        </span>
                                        <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">
                                            {new Date(thread.time || Date.now()).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                                        </span>
                                    </div>
                                    <div className={clsx('text-[13px] truncate mb-0.5', thread.unreadCount > 0 ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-primary)]')}>
                                        {thread.subject}
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[12px] text-[var(--color-text-muted)] truncate flex-1">{thread.snippet}</span>
                                        <StatusBadge label={statusMap[thread.status]?.label || thread.status} variant={statusMap[thread.status]?.variant || 'neutral'} />
                                    </div>
                                    {rowTags.length > 0 && (
                                        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                            {rowTags.slice(0, 2).map((tag: string) => (
                                                <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-[var(--color-background)] text-[var(--color-text-muted)] rounded-full border border-[var(--color-card-border)]">{tag}</span>
                                            ))}
                                            {rowTags.length > 2 && <span className="text-[10px] text-[var(--color-text-muted)]">+{rowTags.length - 2}</span>}
                                        </div>
                                    )}
                                    {Number(thread.noteCount || 0) > 0 && (
                                        <div className="mt-1">
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-card-border)] text-[var(--color-text-muted)] bg-[var(--color-background)]/60">
                                                {thread.noteCount} notes
                                            </span>
                                        </div>
                                    )}
                                </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* ── Desktop: table view ── */}
                    <div className="hidden md:block flex-1 overflow-auto no-scrollbar">
                        <table className="w-full text-sm min-w-[560px]">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="border-b border-[var(--color-card-border)] text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                    <th className="text-left px-4 py-2.5 w-48">Customer</th>
                                    <th className="text-left px-2 py-2.5">Subject</th>
                                    <th className="text-left px-2 py-2.5 w-32">Status</th>
                                    <th className="text-left px-2 py-2.5 w-32">Assigned To</th>
                                    <th className="text-left px-2 py-2.5 pr-4 w-48">Tags</th>
                                </tr>
                            </thead>
                            <tbody>
                                {threads.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="text-center py-12 text-[var(--color-text-muted)]">
                                            <InboxIcon className="w-10 h-10 opacity-20 mx-auto mb-2" />
                                            <p className="text-sm font-medium">No threads found</p>
                                        </td>
                                    </tr>
                                ) : threads.map(thread => {
                                    const rowTags = thread.tags || [];
                                    return (
                                        <tr
                                            key={thread.id}
                                            onClick={() => navigate(toThreadPath(thread.id))}
                                            className="border-b border-[var(--color-card-border)]/50 hover:bg-[var(--color-background)]/40 transition-colors cursor-pointer group"
                                        >
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center gap-2">
                                                <div className="w-6 h-6 rounded-full bg-[var(--color-background)] border border-[var(--color-card-border)] flex items-center justify-center text-[10px] font-bold text-[var(--color-primary)]">
                                                    {thread.from.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{thread.from.split('@')[0]}</span>
                                            </div>
                                        </td>
                                        <td className="px-2 py-2.5">
                                            <div className="text-[13px] text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors truncate max-w-xs">{thread.subject}</div>
                                            <div className="text-[10px] text-[var(--color-text-muted)]/60 truncate max-w-xs">{thread.snippet}</div>
                                            {Number(thread.noteCount || 0) > 0 && (
                                                <span className="inline-flex mt-1 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--color-card-border)] text-[var(--color-text-muted)] bg-[var(--color-background)]/60">
                                                    {thread.noteCount} notes
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-2 py-2.5">
                                            <StatusBadge label={statusMap[thread.status]?.label || thread.status} variant={statusMap[thread.status]?.variant || 'neutral'} />
                                        </td>
                                        <td className="px-2 py-2.5 text-[13px] text-[var(--color-text-muted)]">
                                            {thread.assignedTo || <div className="w-5 h-0.5 bg-[var(--color-text-muted)]/40 rounded"></div>}
                                        </td>
                                        <td className="px-2 py-2.5 pr-4">
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {rowTags.slice(0, 2).map((tag: string) => (
                                                    <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-[var(--color-background)] text-[var(--color-text-muted)] rounded-full border border-[var(--color-card-border)]">{tag}</span>
                                                ))}
                                                {rowTags.length > 2 && <span className="text-[10px] text-[var(--color-text-muted)]">+{rowTags.length - 2}</span>}
                                            </div>
                                        </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )
            }
            <ComposeDrawer
                isOpen={isComposeOpen}
                onClose={handleCloseCompose}
                defaultMailboxId={String(actualOpenThread?.mailboxId || activeMailboxId || '') || undefined}
            />
        </div >
    );
};

/* Filter chip sub-component */
const FilterChip: React.FC<{ label: string; icon: React.FC<{ className?: string }> }> = ({ label, icon: Icon }) => (
    <button className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium border border-[var(--color-card-border)] rounded-lg bg-white hover:bg-[var(--color-background)] transition-colors text-[var(--color-text-muted)]">
        <Icon className="w-3.5 h-3.5" />
        {label}
        <ChevronDown className="w-3 h-3 opacity-50" />
    </button>
);

export default InboxPage;



