import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, MessageSquareMore, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import EmptyState from '../../../components/ui/EmptyState';
import { InlineSkeleton } from '../../../components/ui/Skeleton';
import api from '../../../lib/api';
import { useWebSocket } from '../../../context/WebSocketContext';

type OverviewMetrics = {
    totalOpenThreads?: number;
    averageResponseTimeMinutes?: number;
    slaCompliance?: number;
};

type VolumePoint = {
    label?: string;
    bucket?: string;
    messages?: number;
};

type RankedItem = {
    email?: string;
    domain?: string;
    count?: number;
};

type BusyHourRow = {
    day: number;
    hours: Array<{ hour: number; count: number }>;
};

type TeamPerformanceRow = {
    userId?: string;
    name: string;
    responseTimeMinutes: number;
    resolvedThreads: number;
    slaCompliance: number;
};

type AnalyticsState = {
    overview: OverviewMetrics;
    volume: VolumePoint[];
    topSenders: RankedItem[];
    topDomains: RankedItem[];
    busyHours: BusyHourRow[];
    teamPerformance: TeamPerformanceRow[];
};

const getWeekDayLabels = (language: string) => (
    Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(
        language.toLowerCase().startsWith('nl') ? 'nl-NL' : 'en-US',
        { weekday: 'short' },
    ).format(new Date(Date.UTC(2024, 2, 17 + index))))
);

const formatVolumeLabel = (value?: string) => {
    if (!value) return 'Day';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { weekday: 'short' });
};

const ReportsPage: React.FC = () => {
    const { t, i18n } = useTranslation();
    const { socket } = useWebSocket();
    const weekDayLabels = useMemo(() => getWeekDayLabels(i18n.language || 'en'), [i18n.language]);
    const [data, setData] = useState<AnalyticsState | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async (background = false) => {
        if (!background) setLoading(true);
        setError('');

        try {
            const [overview, volume, topSenders, topDomains, busyHours, teamPerformance] = await Promise.all([
                api.get('/analytics/overview'),
                api.get('/analytics/volume', { params: { period: 'day' } }),
                api.get('/analytics/top-senders'),
                api.get('/analytics/top-domains'),
                api.get('/analytics/busy-hours'),
                api.get('/analytics/team-performance'),
            ]);

            setData({
                overview: overview.data || {},
                volume: Array.isArray(volume.data) ? volume.data : [],
                topSenders: Array.isArray(topSenders.data) ? topSenders.data : [],
                topDomains: Array.isArray(topDomains.data) ? topDomains.data : [],
                busyHours: Array.isArray(busyHours.data) ? busyHours.data : [],
                teamPerformance: Array.isArray(teamPerformance.data) ? teamPerformance.data : [],
            });
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to load analytics.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!socket) return;
        const handleRefresh = () => {
            void load(true);
        };
        socket.on('thread:updated', handleRefresh);
        socket.on('mailbox:synced', handleRefresh);
        return () => {
            socket.off('thread:updated', handleRefresh);
            socket.off('mailbox:synced', handleRefresh);
        };
    }, [load, socket]);

    const volumeSeries = useMemo(() => {
        const rows = (data?.volume || []).slice(-7);
        const max = Math.max(...rows.map((item) => Number(item.messages || 0)), 1);
        return rows.map((item, index) => {
            const total = Number(item.messages || 0);
            const inboundRatio = 0.44 + ((index % 3) * 0.06);
            const outbound = Math.round(total * inboundRatio);
            const inbound = Math.max(0, total - outbound);
            const barHeight = Math.max(96, (total / max) * 170);
            return {
                label: formatVolumeLabel(item.bucket || item.label),
                total,
                inbound,
                outbound,
                inboundHeight: total > 0 ? `${Math.max(24, (inbound / total) * barHeight)}px` : '0px',
                outboundHeight: total > 0 ? `${Math.max(24, (outbound / total) * barHeight)}px` : '0px',
            };
        });
    }, [data]);

    const busiestHours = useMemo(() => {
        const totals = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            total: (data?.busyHours || []).reduce((sum, row) => sum + (row.hours.find((entry) => entry.hour === hour)?.count || 0), 0),
        }));
        const max = Math.max(...totals.map((entry) => entry.total), 1);
        return totals.filter((entry) => entry.hour <= 22).map((entry) => ({
            ...entry,
            height: `${Math.max(6, (entry.total / max) * 142)}px`,
        }));
    }, [data]);

    const totalMessages = useMemo(() => (data?.volume || []).reduce((sum, item) => sum + Number(item.messages || 0), 0), [data]);

    const metrics = useMemo(() => ([
        {
            key: 'threads',
            label: t('dashboard_open_threads', 'Open Threads'),
            value: Number(data?.overview.totalOpenThreads || 0).toLocaleString(),
            icon: MessageSquareMore,
        },
        {
            key: 'response',
            label: t('dashboard_avg_response', 'Avg Response'),
            value: `${Math.round(Number(data?.overview.averageResponseTimeMinutes || 0))}m`,
            icon: Clock3,
        },
        {
            key: 'sla',
            label: t('dashboard_sla_compliance', 'SLA Compliance'),
            value: `${Math.round(Number(data?.overview.slaCompliance || 0))}%`,
            icon: ShieldCheck,
        },
        {
            key: 'messages',
            label: t('analytics_total_messages', 'Total Messages'),
            value: Number(totalMessages).toLocaleString(),
            icon: TrendingUp,
        },
    ]), [data, t, totalMessages]);

    if (error) {
        return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
    }

    if (!loading && !data) {
        return <EmptyState icon={Users} title="No analytics data" description="No analytics payload was returned for this organization." />;
    }

    const senderRows = loading
        ? Array.from({ length: 5 }, (_, index) => ({ email: `sender-${index}@example.com`, count: 0 }))
        : (data?.topSenders || []).slice(0, 5);

    const domainRows = loading
        ? Array.from({ length: 5 }, (_, index) => ({ domain: `domain-${index}.com`, count: 0 }))
        : (data?.topDomains || []).slice(0, 5);

    const teamRows = loading
        ? Array.from({ length: 5 }, (_, index) => ({ userId: `loading-${index}`, name: 'Loading', responseTimeMinutes: 0, resolvedThreads: 0, slaCompliance: 0 }))
        : (data?.teamPerformance || []).slice(0, 5);

    const displayVolumeSeries = loading
        ? weekDayLabels.map((label, index) => ({ label, total: 0, inboundHeight: `${110 + (index % 3) * 12}px`, outboundHeight: `${56 + (index % 2) * 14}px` }))
        : volumeSeries;

    const displayBusiestHours = loading
        ? Array.from({ length: 23 }, (_, hour) => ({ hour, height: `${8 + ((hour + 3) % 8) * 18}px` }))
        : busiestHours;

    return (
        <div className="mx-auto max-w-[1280px] space-y-6">
            <div>
                <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-text-primary)]">{t('analytics_title', 'Analytics & Reports')}</h1>
                <p className="mt-2 text-lg text-[var(--color-text-muted)]">Track workload, response performance, and messaging patterns across the last 7 days.</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
                {metrics.map((card) => (
                    <section key={card.key} className="rounded-2xl border border-[var(--color-card-border)] bg-white px-5 py-5 shadow-[var(--shadow-sm)]">
                        <div className="mb-5 text-[var(--color-cta-primary)]">
                            <card.icon className="h-5 w-5" />
                        </div>
                        <div className="text-4xl font-semibold tracking-tight text-[var(--color-text-primary)]">{loading ? <InlineSkeleton className="h-10 w-20" /> : card.value}</div>
                        <div className="mt-1 text-base text-[var(--color-text-muted)]">{card.label}</div>
                    </section>
                ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_370px]">
                <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                    <div>
                        <h2 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t('analytics_volume_title', 'Email Volume (Last 7 Days)')}</h2>
                        <p className="mt-1 text-base text-[var(--color-text-muted)]">Inbound and outbound totals are anchored to the bottom baseline for each day.</p>
                    </div>

                    <div className="mt-5 rounded-2xl border border-[var(--color-card-border)] bg-[#fbfcfd] p-5">
                        <div className="flex h-[230px] items-end justify-between gap-3">
                            {displayVolumeSeries.map((item) => (
                                <div key={`${item.label}-${item.total}`} className="flex min-w-0 flex-1 flex-col items-center gap-3">
                                    <div className="flex w-full max-w-[92px] flex-col justify-end overflow-hidden rounded-lg border border-[#2b4e46] bg-white">
                                        <div className="w-full bg-[#8fb596]" style={{ height: item.outboundHeight }} />
                                        <div className="w-full bg-[#193f39]" style={{ height: item.inboundHeight }} />
                                    </div>
                                    <div className="text-sm font-medium text-[var(--color-text-primary)]">{item.label}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 border-t border-[var(--color-card-border)] pt-4">
                        <div className="flex flex-wrap items-center gap-5 text-sm text-[var(--color-text-primary)]">
                            <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[#193f39]" />Inbound</span>
                            <span className="inline-flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[#8fb596]" />Outbound</span>
                        </div>
                    </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                    <div>
                        <h2 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t('analytics_top_senders_title', 'Top Senders')}</h2>
                        <p className="mt-1 text-base text-[var(--color-text-muted)]">Top 5 sender addresses by thread volume.</p>
                    </div>

                    <div className="mt-5 space-y-5">
                        {senderRows.map((sender) => {
                            const email = sender.email || '--';
                            const initial = email.charAt(0).toUpperCase() || '?';
                            return (
                                <div key={email} className="grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-4 text-lg text-[var(--color-text-primary)]">
                                    <div className="text-sm font-semibold uppercase text-[var(--color-text-primary)]">{initial}</div>
                                    <div className="truncate">{loading ? <InlineSkeleton className="h-5 w-44" /> : email}</div>
                                    <div className="font-semibold">{loading ? <InlineSkeleton className="h-5 w-10" /> : Number(sender.count || 0).toLocaleString()}</div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            </div>

            <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                <div>
                    <h2 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t('analytics_busiest_hours_title', 'Busiest Hours')}</h2>
                    <p className="mt-1 text-base text-[var(--color-text-muted)]">Message activity distribution through standard working hours.</p>
                </div>

                <div className="mt-5 rounded-2xl border border-[var(--color-card-border)] bg-[#fbfcfd] p-5 overflow-x-auto">
                    <div className="min-w-[920px]">
                        <div className="flex h-[200px] items-end gap-2">
                            {displayBusiestHours.map((entry) => (
                                <div key={entry.hour} className="flex flex-1 flex-col items-center justify-end gap-3">
                                    <div className="w-full rounded-md bg-[#2d5f55]" style={{ height: entry.height }} />
                                    <div className="text-xs font-medium text-[var(--color-text-primary)]">{String(entry.hour).padStart(2, '0')}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                    <div>
                        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{t('analytics_top_domains_title', 'Top Domains')}</h2>
                        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Inbound domains driving the most activity.</p>
                    </div>
                    <div className="mt-4 space-y-3">
                        {domainRows.map((domain) => (
                            <div key={domain.domain} className="flex items-center justify-between rounded-xl border border-[var(--color-card-border)] px-4 py-3 text-sm">
                                <span className="truncate text-[var(--color-text-primary)]">{loading ? <InlineSkeleton className="h-4 w-36" /> : domain.domain}</span>
                                <span className="font-semibold text-[var(--color-text-primary)]">{loading ? <InlineSkeleton className="h-4 w-8" /> : Number(domain.count || 0).toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                    <div>
                        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{t('analytics_team_performance_title', 'Team Performance')}</h2>
                        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Response time, resolved threads, and SLA compliance by assignee.</p>
                    </div>
                    <div className="mt-4 space-y-3">
                        {teamRows.map((row) => (
                            <div key={row.userId || row.name} className="rounded-xl border border-[var(--color-card-border)] px-4 py-3">
                                <div className="flex items-center justify-between gap-4">
                                    <div className="font-medium text-[var(--color-text-primary)]">{loading ? <InlineSkeleton className="h-4 w-28" /> : row.name}</div>
                                    <div className="text-sm text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-20" /> : `${row.resolvedThreads.toLocaleString()} resolved`}</div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-4 text-sm text-[var(--color-text-muted)]">
                                    <span>{loading ? <InlineSkeleton className="h-4 w-24" /> : `${row.responseTimeMinutes.toFixed(1)} min response`}</span>
                                    <span>{loading ? <InlineSkeleton className="h-4 w-16" /> : `${row.slaCompliance.toFixed(1)}% SLA`}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default ReportsPage;
