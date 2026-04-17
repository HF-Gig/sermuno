import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import {
    Inbox,
    AlertTriangle,
    ShieldAlert,
    MailOpen,
    User,
    MessageSquare,
    CheckCircle2,
    TrendingUp,
    AlertCircle,
    ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { DashboardSkeleton } from '../../components/skeletons/DashboardSkeleton';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { normalizeRole } from '../../lib/rbac';

interface ThreadSummary {
    id: string;
    subject: string;
    status: string;
    priority: string;
    slaBreached: boolean;
    firstResponseDueAt: string | null;
    resolutionDueAt: string | null;
    assignedUser: { id: string; fullName: string; email: string } | null;
    contact: { id: string; email: string; name: string | null } | null;
    messages: { id: string; fromEmail: string; isRead: boolean; createdAt: string }[];
    createdAt: string;
}

interface ThreadsResponse {
    threads: ThreadSummary[];
    pagination: { total: number };
}

interface OverviewData {
    totalOpenThreads?: number;
    averageResponseTimeMinutes?: number;
    slaCompliance?: number;
}

interface VolumePoint {
    day: string;
    threads: number;
    messages: number;
}

interface BusyHourPoint {
    hour: number;
    count: number;
}

interface AuditLog {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    userId: string | null;
    createdAt: string;
}

interface AuditLogsResponse {
    total: number;
    page: number;
    limit: number;
    logs: AuditLog[];
}

interface MetricCard {
    label: string;
    value: string;
    badge: string;
    badgeType: 'success' | 'danger' | 'neutral';
    sublabel: string;
    linkLabel: string;
    linkTo: string;
    icon: React.ElementType;
}

const statusColors: Record<string, string> = {
    OPEN: 'bg-green-100 text-green-700',
    NEW: 'bg-blue-100 text-blue-700',
    PENDING: 'bg-amber-100 text-amber-700',
    CLOSED: 'bg-gray-100 text-gray-500',
    SNOOZED: 'bg-indigo-100 text-indigo-700',
    TRASH: 'bg-red-100 text-red-600',
};

const priorityDotColors: Record<string, string> = {
    URGENT: 'bg-red-500',
    HIGH: 'bg-red-500',
    NORMAL: 'bg-yellow-500',
    LOW: 'bg-gray-300',
};

const badgeStyles: Record<'success' | 'danger' | 'neutral', string> = {
    success: 'text-[var(--color-primary)]',
    danger: 'text-red-500',
    neutral: 'text-[var(--color-text-muted)]',
};

const periodTabs = ['Day', 'Week', 'Month'] as const;
type Period = (typeof periodTabs)[number];
type DashboardTranslate = TFunction<'translation', undefined>;

const dayKey = (date: Date): string => {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const formatDayLabel = (raw: string) => {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString(undefined, { weekday: 'short' });
};

const toPastTense = (token: string) => {
    const lower = token.toLowerCase();
    if (lower.endsWith('ed')) return lower;
    const map: Record<string, string> = {
        add: 'added',
        assign: 'assigned',
        create: 'created',
        update: 'updated',
        delete: 'deleted',
        close: 'closed',
        open: 'opened',
        reply: 'replied',
        mention: 'mentioned',
        archive: 'archived',
        restore: 'restored',
    };
    return map[lower] || lower;
};

const titleCase = (text: string) => {
    return text
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
};

const humanizeAuditAction = (action: string) => {
    const clean = String(action || '').trim();
    if (!clean) return 'Activity recorded';

    const dotParts = clean.split('.').filter(Boolean);
    if (dotParts.length >= 2) {
        const left = dotParts[0].replace(/[_-]+/g, ' ');
        const right = toPastTense(dotParts.slice(1).join(' '));
        return titleCase(`${left} ${right}`);
    }

    const tokenized = clean.replace(/[._-]+/g, ' ').toLowerCase().split(' ').filter(Boolean);
    if (tokenized.length === 0) return 'Activity recorded';
    const last = tokenized[tokenized.length - 1];
    tokenized[tokenized.length - 1] = toPastTense(last);
    return titleCase(tokenized.join(' '));
};

const slaLabel = (thread: ThreadSummary, t: DashboardTranslate): { text: string; warning: boolean } => {
    if (thread.slaBreached) return { text: t('dashboard_sla_breached', 'Breached'), warning: true };
    const due = thread.firstResponseDueAt ?? thread.resolutionDueAt;
    if (!due) return { text: t('dashboard_sla_none', 'No SLA'), warning: false };
    const diff = new Date(due).getTime() - Date.now();
    if (diff <= 0) return { text: t('dashboard_sla_overdue', 'Overdue'), warning: true };
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return { text: t('dashboard_sla_due_minutes', 'in {{count}}m').replace('{{count}}', String(mins)), warning: true };
    const hours = Math.floor(mins / 60);
    if (hours < 24) return { text: t('dashboard_sla_due_hours', 'in {{count}}h').replace('{{count}}', String(hours)), warning: hours <= 2 };
    return { text: t('dashboard_sla_due_days', 'in {{count}}d').replace('{{count}}', String(Math.floor(hours / 24))), warning: false };
};

const UserDashboard: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();
    const role = normalizeRole(user?.role);
    const showRecentActivity = role === 'ADMIN' || role === 'MANAGER';
    const languageLocale = i18n.language?.startsWith('nl') ? 'nl-NL' : 'en-US';

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [myOpenCount, setMyOpenCount] = useState(0);
    const [atRiskCount, setAtRiskCount] = useState(0);
    const [breachCount, setBreachCount] = useState(0);

    const [attentionThreads, setAttentionThreads] = useState<ThreadSummary[]>([]);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [volumeData, setVolumeData] = useState<VolumePoint[]>([]);
    const [busyHoursData, setBusyHoursData] = useState<BusyHourPoint[]>([]);
    const [period, setPeriod] = useState<Period>('Week');
    const chartContainerRef = useRef<HTMLDivElement | null>(null);
    const [chartSize, setChartSize] = useState({ width: 0, height: 0 });

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const [allOpenRes, myOpenRes, overviewRes, volumeRes, busyRes, auditRes] = await Promise.all([
                api.get<ThreadsResponse>('/threads?status=OPEN&limit=200&page=1'),
                user?.id
                    ? api.get<ThreadsResponse>(`/threads?status=OPEN&assignedUserId=${encodeURIComponent(user.id)}&limit=1&page=1`)
                    : Promise.resolve(null),
                api.get<OverviewData>('/analytics/overview'),
                api.get<VolumePoint[]>('/analytics/volume'),
                api.get<BusyHourPoint[]>('/analytics/busy-hours'),
                showRecentActivity
                    ? api.get<AuditLogsResponse>('/audit-logs?page=1&limit=10').catch(() => null)
                    : Promise.resolve(null),
            ]);

            const allOpen = Array.isArray(allOpenRes.data?.threads) ? allOpenRes.data.threads : [];
            const myOpenThreads = allOpen
                .filter((thread) => thread.assignedUser?.id === user?.id)
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

            setMyOpenCount(myOpenRes?.data?.pagination?.total ?? myOpenThreads.length);

            const now = Date.now();
            const atRiskThreads = allOpen.filter((thread) => {
                const due = thread.firstResponseDueAt ?? thread.resolutionDueAt;
                if (!due || thread.slaBreached) return false;
                const diff = new Date(due).getTime() - now;
                return diff > 0 && diff <= 4 * 60 * 60 * 1000;
            });

            const atRiskSet = new Set(atRiskThreads.map((t) => t.id));
            setAtRiskCount(atRiskThreads.length);

            const breaches = allOpen.filter((t) => t.slaBreached);
            setBreachCount(breaches.length);

            const sortedMyOpenThreads = [...myOpenThreads].sort((a, b) => {
                const aScore = a.slaBreached ? 3 : atRiskSet.has(a.id) ? 2 : 1;
                const bScore = b.slaBreached ? 3 : atRiskSet.has(b.id) ? 2 : 1;
                if (aScore !== bScore) return bScore - aScore;
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            });
            setAttentionThreads(sortedMyOpenThreads.slice(0, 5));

            setOverview(overviewRes.data ?? null);

            if (showRecentActivity) {
                const fetchedLogs = Array.isArray(auditRes?.data?.logs) ? auditRes?.data?.logs : [];
                setAuditLogs(fetchedLogs);
            } else {
                setAuditLogs([]);
            }

            const rawVolume = Array.isArray(volumeRes.data) ? volumeRes.data : [];
            setVolumeData(
                rawVolume.map((row: any) => ({
                    day: String(row.day || row.bucket || row.label || ''),
                    threads: Number(row.threads ?? row.messages ?? 0) || 0,
                    messages: Number(row.messages ?? 0) || 0,
                }))
            );

            const rawBusy = Array.isArray(busyRes.data) ? busyRes.data : [];
            setBusyHoursData(
                Array.from({ length: 24 }, (_, hour) => ({
                    hour,
                    count: rawBusy.reduce((sum: number, row: any) => {
                        if (!Array.isArray(row?.hours)) return sum;
                        const match = row.hours.find((entry: any) => Number(entry.hour) === hour);
                        return sum + Number(match?.count || 0);
                    }, 0),
                }))
            );
        } catch (err: unknown) {
            const message =
                err &&
                typeof err === 'object' &&
                'response' in err &&
                (err as { response?: { data?: { message?: string } } }).response?.data?.message;
            setError(typeof message === 'string' ? message : 'Failed to load dashboard data.');
            setAuditLogs([]);
        } finally {
            setLoading(false);
        }
    }, [user?.id, showRecentActivity]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        const node = chartContainerRef.current;
        if (!node) return;

        const syncContainerState = () => {
            const { width, height } = node.getBoundingClientRect();
            setChartSize({
                width: Math.max(0, Math.floor(width)),
                height: Math.max(0, Math.floor(height)),
            });
        };

        syncContainerState();

        const observer = new ResizeObserver(() => {
            syncContainerState();
        });
        observer.observe(node);

        return () => {
            observer.disconnect();
        };
    }, [loading]);

    const metricCards = useMemo<MetricCard[]>(() => {
        return [
            {
                label: t('stat_my_open_threads', 'My Open Threads'),
                value: String(myOpenCount),
                badge: '',
                badgeType: 'neutral',
                sublabel: '',
                linkLabel: t('stat_link_view_inbox', 'View inbox'),
                linkTo: '/inbox/my-threads',
                icon: Inbox,
            },
            {
                label: t('stat_slas_at_risk', 'SLAs At Risk'),
                value: String(atRiskCount),
                badge: atRiskCount > 0 ? t('dashboard_next_60m', 'in next 60m') : '',
                badgeType: atRiskCount > 0 ? 'danger' : 'neutral',
                sublabel: t('stat_slas_at_risk', 'SLAs At Risk'),
                linkLabel: t('stat_link_view_slas', 'View SLAs'),
                linkTo: '/sla',
                icon: AlertTriangle,
            },
            {
                label: t('dashboard_breaches', 'Breaches'),
                value: String(breachCount),
                badge: breachCount > 0 ? t('dashboard_open_now', 'open now') : '',
                badgeType: breachCount > 0 ? 'danger' : 'neutral',
                sublabel: t('dashboard_sla_breaches', 'SLA Breaches'),
                linkLabel: t('dashboard_investigate', 'Investigate'),
                linkTo: '/inbox/waiting',
                icon: ShieldAlert,
            },
            {
                label: t('dashboard_open_threads', 'Open Threads'),
                value: String(overview?.totalOpenThreads ?? 0),
                badge: '',
                badgeType: 'neutral',
                sublabel: '',
                linkLabel: t('stat_link_view_inbox', 'View inbox'),
                linkTo: '/inbox',
                icon: MailOpen,
            },
        ];
    }, [t, myOpenCount, atRiskCount, breachCount, overview?.totalOpenThreads]);

    const periodData = useMemo(() => {
        const sorted = [...volumeData].sort((a, b) => new Date(a.day).getTime() - new Date(b.day).getTime());
        const volumeByDay = new Map<string, number>();
        sorted.forEach((point) => {
            const date = new Date(point.day);
            if (!Number.isNaN(date.getTime())) {
                volumeByDay.set(dayKey(date), point.threads);
            }
        });

        if (period === 'Day') {
            const byHour = new Map<number, number>();
            busyHoursData.forEach((point) => byHour.set(point.hour, point.count));
            return Array.from({ length: 24 }, (_, hour) => ({
                name: `${String(hour).padStart(2, '0')}:00`,
                volume: byHour.get(hour) ?? 0,
            }));
        }
        if (period === 'Week') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return Array.from({ length: 7 }, (_, offset) => {
                const d = new Date(today);
                d.setDate(today.getDate() - (6 - offset));
                const key = dayKey(d);
                return {
                    name: d.toLocaleDateString(languageLocale, { weekday: 'short' }),
                    volume: volumeByDay.get(key) ?? 0,
                };
            });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const buckets = [0, 0, 0, 0];
        Array.from({ length: 28 }, (_, index) => {
            const d = new Date(today);
            d.setDate(today.getDate() - (27 - index));
            const bucket = Math.min(3, Math.floor(index / 7));
            buckets[bucket] += volumeByDay.get(dayKey(d)) ?? 0;
        });
        return buckets.map((value, index) => ({ name: `${t('dashboard_period_week', 'Week')} ${index + 1}`, volume: value }));
    }, [t, volumeData, busyHoursData, period, languageLocale]);

    const chartMax = useMemo(() => {
        const top = Math.max(0, ...periodData.map((x) => x.volume));
        return Math.max(top + 1, 8);
    }, [periodData]);

    const dynamicBarSize = useMemo(() => {
        const points = Math.max(periodData.length, 1);
        const availableWidth = Math.max(chartSize.width - 32, 0);
        const rawSize = availableWidth > 0 ? Math.floor(availableWidth / (points * 1.7)) : 0;

        if (period === 'Day') {
            return Math.max(4, Math.min(8, rawSize || 8));
        }

        return Math.max(10, Math.min(28, rawSize || 24));
    }, [chartSize.width, periodData.length, period]);

    return (
        <div className="flex w-full flex-col gap-3 min-[787px]:h-full">
            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            )}

            {loading ? (
                <DashboardSkeleton />
            ) : (
                <>
                    <div className="grid grid-cols-1 min-[426px]:grid-cols-2 min-[787px]:grid-cols-4 gap-4 shrink-0">
                        {metricCards.map((card) => {
                            const Icon = card.icon;
                            return (
                                <div
                                    key={card.label}
                                    className="bg-white px-5 py-4 rounded-xl border border-[var(--color-card-border)] shadow-[var(--shadow-sm)]"
                                >
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <div className="p-1.5 rounded-lg bg-[var(--color-background)]">
                                            <Icon className="w-4 h-4 text-[var(--color-primary)]" />
                                        </div>
                                        <span className="text-[13px] font-medium text-[var(--color-text-primary)]">{card.label}</span>
                                    </div>
                                    <div className="flex items-baseline gap-1.5 mb-0.5">
                                        <span className="text-2xl lg:text-3xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
                                            {card.value}
                                        </span>
                                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${badgeStyles[card.badgeType]}`}>
                                            {card.badge}
                                        </span>
                                    </div>
                                    {card.sublabel && <div className="text-[10px] text-[var(--color-text-muted)]/70">{card.sublabel}</div>}
                                    <Link to={card.linkTo} className="inline-flex items-center gap-0.5 text-[10px] font-medium text-[var(--color-primary)] mt-0.5 hover:underline">
                                        {card.linkLabel}
                                        <ChevronRight className="w-3 h-3" />
                                    </Link>
                                </div>
                            );
                        })}
                    </div>

                    <div className={`grid grid-cols-1 gap-4 min-[1536px]:gap-3 min-[787px]:flex-1 min-[787px]:min-h-0 max-[1279px]:hidden ${showRecentActivity
                        ? 'min-[787px]:grid-cols-[minmax(0,1fr)_360px] min-[1440px]:grid-cols-[minmax(0,1fr)_390px]'
                        : 'min-[787px]:grid-cols-1'
                        }`}>
                        <div className="order-1 max-[1535px]:hidden">
                            <div className="bg-white rounded-xl border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] overflow-hidden">
                                <div className="px-5 py-3 border-b border-[var(--color-card-border)] flex items-center justify-between">
                                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
                                        {t('dashboard_opened_threads_title', 'My Opened Threads')}
                                    </h3>
                                    <Link to="/inbox" className="text-[11px] font-medium text-[var(--color-primary)] hover:underline">{t('dashboard_view_all', 'View All')}</Link>
                                </div>

                                <div className="hidden min-[787px]:block h-[210px] min-[1920px]:h-[308px]">
                                    <table className="w-full text-sm table-fixed min-w-[560px]">
                                        <thead>
                                            <tr className="border-b border-[var(--color-card-border)] text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                                                <th className="text-left pl-5 pr-2 py-2">{t('dashboard_col_subject', 'Subject')}</th>
                                                <th className="text-left px-2 py-2">{t('dashboard_col_customer', 'Customer')}</th>
                                                <th className="text-left px-2 py-2">{t('dashboard_col_status', 'Status')}</th>
                                                <th className="text-left px-2 py-2">{t('dashboard_col_priority', 'Priority')}</th>
                                                <th className="text-left px-2 py-2">{t('dashboard_col_sla', 'SLA')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {attentionThreads.length === 0 ? (
                                                <tr>
                                                    <td colSpan={5} className="text-center align-middle h-[162px] min-[1920px]:h-[260px] text-xs text-[var(--color-text-muted)]">{t('dashboard_no_opened_threads', 'No opened threads')}</td>
                                                </tr>
                                            ) : (
                                                attentionThreads.map((thread) => {
                                                    const sla = slaLabel(thread, t);
                                                    return (
                                                        <tr key={thread.id} className="border-b border-[var(--color-card-border)]/50 hover:bg-[var(--color-background)]/40 transition-colors">
                                                            <td className="pl-5 pr-2 py-2.5">
                                                                <Link to={`/inbox/thread/${thread.id}`} className="font-medium text-[var(--color-text-primary)] hover:text-[var(--color-primary)] transition-colors text-[13px] line-clamp-1">
                                                                    {thread.subject || '(no subject)'}
                                                                </Link>
                                                                <div className="text-[10px] text-[var(--color-text-muted)]/60">#{thread.id.slice(0, 6)}</div>
                                                            </td>
                                                            <td className="px-2 py-2.5">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="w-6 h-6 rounded-full bg-[var(--color-background)] border border-[var(--color-card-border)] flex items-center justify-center text-[10px] font-bold text-[var(--color-primary)]">
                                                                        {(thread.contact?.name || thread.contact?.email || thread.messages?.[0]?.fromEmail || 'C').charAt(0).toUpperCase()}
                                                                    </div>
                                                                    <span className="text-[13px] truncate">{thread.contact?.name || thread.contact?.email || thread.messages?.[0]?.fromEmail || 'Unknown'}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-2 py-2.5">
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[String(thread.status || '').toUpperCase()] || 'bg-gray-100 text-gray-500'}`}>
                                                                    {thread.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-2 py-2.5">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className={`w-1.5 h-1.5 rounded-full ${priorityDotColors[String(thread.priority || '').toUpperCase()] || 'bg-gray-300'}`} />
                                                                    <span className="text-[13px]">{thread.priority}</span>
                                                                </div>
                                                            </td>
                                                            <td className="px-2 py-2.5">
                                                                <span className={`text-[12px] flex items-center gap-1 ${sla.warning ? 'text-red-500 font-medium' : 'text-[var(--color-text-muted)]'}`}>
                                                                    {sla.warning && <AlertTriangle className="w-3 h-3" />}
                                                                    {sla.text}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="divide-y divide-[var(--color-card-border)]/50 min-[787px]:hidden h-[308px] overflow-y-auto">
                                    {attentionThreads.length === 0 ? (
                                        <div className="py-10 text-center text-xs text-[var(--color-text-muted)]">No threads to do</div>
                                    ) : attentionThreads.map((thread) => {
                                        const sla = slaLabel(thread, t);
                                        return (
                                            <div key={thread.id} className="px-4 py-3 flex items-start gap-3">
                                                <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[11px] font-bold text-[var(--color-primary)] shrink-0 mt-0.5">
                                                    {(thread.contact?.name || thread.contact?.email || 'C').charAt(0).toUpperCase()}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start justify-between gap-2 mb-1">
                                                        <span className="text-[13px] font-semibold text-[var(--color-text-primary)] leading-snug flex-1 line-clamp-1">{thread.subject || '(no subject)'}</span>
                                                        <span className={`text-[11px] shrink-0 ${sla.warning ? 'text-red-500 font-semibold' : 'text-[var(--color-text-muted)]'}`}>{sla.text}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="text-[11px] text-[var(--color-text-muted)]">{thread.contact?.name || thread.contact?.email || 'Unknown'}</span>
                                                        <span className="text-[var(--color-text-muted)]/30">·</span>
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[String(thread.status || '').toUpperCase()] || 'bg-gray-100 text-gray-500'}`}>{thread.status}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {showRecentActivity && (
                            <div className="order-2 min-[787px]:col-start-2 min-[1536px]:row-span-2 min-[787px]:flex min-[787px]:min-h-0 min-[787px]:flex-col">
                                <div className="bg-white rounded-xl border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] px-4 py-3 h-full flex flex-col">
                                    <div className="flex items-center justify-between mb-3 shrink-0">
                                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
                                            {t('dashboard_recent_activity', 'Recent Activity')}
                                        </h3>
                                    </div>
                                    <div className="space-y-3 flex-1 min-h-0 overflow-y-auto">
                                        {auditLogs.length === 0 ? (
                                            <p className="text-xs text-[var(--color-text-muted)] py-4">{t('dashboard_no_recent_activity', 'No recent activity')}</p>
                                        ) : auditLogs.map((item, idx) => {
                                            const type = item.action?.toLowerCase();
                                            const Icon = type.includes('mention') ? User : type.includes('reply') ? MessageSquare : CheckCircle2;
                                            return (
                                                <div key={item.id} className="flex gap-2.5 relative">
                                                    {idx !== auditLogs.length - 1 && (
                                                        <div className="absolute left-[9px] top-5 -bottom-3 w-px bg-[var(--color-card-border)]" />
                                                    )}
                                                    <div className="relative z-10 w-[18px] h-[18px] rounded-full bg-[var(--color-background)] border-2 border-white shadow-sm flex items-center justify-center mt-0.5 shrink-0">
                                                        <Icon className="w-3 h-3 text-[var(--color-primary)]" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[13px] text-[var(--color-text-primary)] leading-snug">
                                                            {humanizeAuditAction(item.action)} in {titleCase(item.entityType || 'item')}
                                                        </p>
                                                        <span className="text-[10px] text-[var(--color-text-muted)]/60 mt-0.5 block">{formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className={`min-h-[220px] max-[425px]:min-h-[190px] min-[787px]:flex-1 min-[787px]:min-h-0 ${showRecentActivity
                            ? 'order-1 min-[787px]:col-start-1 min-[1536px]:order-3 min-[1536px]:row-start-2'
                            : 'order-2'
                            }`}>
                            <div className="bg-white rounded-xl border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] px-4 py-3 h-full flex flex-col overflow-hidden">
                                <div className="flex items-center justify-between mb-2 shrink-0">
                                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5" style={{ fontFamily: 'var(--font-headline)' }}>
                                        <TrendingUp className="w-4 h-4 text-[var(--color-accent)]" />
                                        {t('dashboard_sla_performance', 'SLA & Performance')}
                                    </h3>
                                    <div className="flex bg-[var(--color-background)] rounded-lg p-0.5">
                                        {periodTabs.map((tab) => (
                                            <button
                                                key={tab}
                                                onClick={() => setPeriod(tab)}
                                                className={`px-2.5 py-0.5 text-[10px] font-medium rounded-md transition-all duration-200 ${period === tab
                                                    ? 'bg-white text-[var(--color-text-primary)] shadow-sm'
                                                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                                                    }`}
                                            >
                                                {tab === 'Day'
                                                    ? t('dashboard_period_day', 'Day')
                                                    : tab === 'Week'
                                                        ? t('dashboard_period_week', 'Week')
                                                        : t('dashboard_period_month', 'Month')}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex items-center gap-6 mb-2 shrink-0">
                                    <div>
                                        <span className="text-xl font-bold text-[var(--color-primary)] tabular-nums" style={{ fontFamily: 'var(--font-headline)' }}>
                                            {overview?.totalOpenThreads ?? 0}
                                        </span>
                                        <span className="text-xs text-[var(--color-text-muted)] ml-1.5">{t('dashboard_open_threads', 'Open Threads')}</span>
                                    </div>
                                    <div>
                                        <span className="text-xl font-bold text-red-500 tabular-nums" style={{ fontFamily: 'var(--font-headline)' }}>
                                            {Math.round(overview?.averageResponseTimeMinutes ?? 0)}m
                                        </span>
                                        <span className="text-xs text-[var(--color-text-muted)] ml-1.5">{t('dashboard_avg_response', 'Avg Response')}</span>
                                    </div>
                                    <div>
                                        <span className="text-xl font-bold text-[var(--color-text-primary)] tabular-nums" style={{ fontFamily: 'var(--font-headline)' }}>
                                            {Math.round(overview?.slaCompliance ?? 0)}%
                                        </span>
                                        <span className="text-xs text-[var(--color-text-muted)] ml-1.5">{t('dashboard_sla_compliance', 'SLA Compliance')}</span>
                                    </div>
                                </div>

                                <div ref={chartContainerRef} className="flex-1 min-h-[180px] min-w-0 overflow-hidden">
                                    {periodData.length === 0 ? (
                                        <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)]">No chart data</div>
                                    ) : chartSize.width < 16 || chartSize.height < 16 ? (
                                        <div className="h-full flex items-center justify-center text-xs text-[var(--color-text-muted)]">Preparing chart...</div>
                                    ) : (
                                        <BarChart width={chartSize.width} height={chartSize.height} data={periodData} margin={{ top: 8, right: 8, left: 8, bottom: 20 }}>
                                                <CartesianGrid vertical={false} stroke="var(--color-card-border)" strokeDasharray="0" />
                                                <XAxis
                                                    dataKey="name"
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{ fontSize: 10, fill: '#8EB69B' }}
                                                    dy={4}
                                                    height={20}
                                                    interval={0}
                                                    tickFormatter={(value: string) => {
                                                        if (period !== 'Day') return value;
                                                        const hour = Number(String(value).slice(0, 2));
                                                        return hour % 2 === 1 ? value : '';
                                                    }}
                                                />
                                                <YAxis hide domain={[0, chartMax]} />
                                                <Tooltip
                                                    cursor={false}
                                                    contentStyle={{
                                                        borderRadius: 8,
                                                        border: '1px solid var(--color-card-border)',
                                                        boxShadow: 'var(--shadow-sm)',
                                                        fontSize: 12,
                                                    }}
                                                />
                                                <Bar
                                                    dataKey="volume"
                                                    fill="#235347"
                                                    radius={[2, 2, 0, 0]}
                                                    barSize={dynamicBarSize}
                                                    maxBarSize={period === 'Day' ? 8 : 28}
                                                    opacity={0.75}
                                                    isAnimationActive={false}
                                                />
                                            </BarChart>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default UserDashboard;


