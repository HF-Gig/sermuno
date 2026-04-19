import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock3, MessageSquareMore, ShieldCheck, TrendingUp, Users } from 'lucide-react';
import EmptyState from '../../../components/ui/EmptyState';
import { InlineSkeleton } from '../../../components/ui/Skeleton';
import api from '../../../lib/api';
import { useWebSocket } from '../../../context/WebSocketContext';
import { useAdaptiveRows } from '../../../hooks/useAdaptiveCount';

type OverviewMetrics = {
    totalOpenThreads?: number;
    averageResponseTimeMinutes?: number;
    slaCompliance?: number;
};

type VolumePoint = {
    label?: string;
    bucket?: string;
    messages?: number;
    inbound?: number;
    outbound?: number;
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
    const [animateCharts, setAnimateCharts] = useState(false);
    const [activeVolumeTooltip, setActiveVolumeTooltip] = useState<number | null>(null);
    const [activeHourTooltip, setActiveHourTooltip] = useState<number | null>(null);
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
        const paddedRows = Array.from({ length: 7 }, (_, index) => rows[index] || null);
        const max = Math.max(
            ...rows.map((item) => {
                const inbound = Number(item.inbound || 0);
                const outbound = Number(item.outbound || 0);
                const total = inbound + outbound;
                return total > 0 ? total : Number(item.messages || 0);
            }),
            1,
        );
        return paddedRows.map((item, index) => {
            const inboundValue = Number(item?.inbound || 0);
            const outboundValue = Number(item?.outbound || 0);
            const total = inboundValue + outboundValue > 0 ? inboundValue + outboundValue : Number(item?.messages || 0);
            return {
                label: item ? formatVolumeLabel(item.bucket || item.label) : weekDayLabels[index],
                inbound: inboundValue,
                outbound: outboundValue,
                total,
                fillRatio: total / max,
                inboundRatio: total > 0 ? inboundValue / total : 0,
                outboundRatio: total > 0 ? outboundValue / total : 0,
            };
        });
    }, [data, weekDayLabels]);

    const busiestHours = useMemo(() => {
        const totals = Array.from({ length: 24 }, (_, hour) => ({
            hour,
            total: (data?.busyHours || []).reduce((sum, row) => sum + (row.hours.find((entry) => entry.hour === hour)?.count || 0), 0),
        }));
        const max = Math.max(...totals.map((entry) => entry.total), 1);
        return totals.map((entry) => ({
            ...entry,
            ratio: entry.total / max,
        }));
    }, [data]);

    useEffect(() => {
        if (loading || !data) {
            setAnimateCharts(false);
            return;
        }
        const timer = window.setTimeout(() => setAnimateCharts(true), 40);
        return () => window.clearTimeout(timer);
    }, [loading, data]);

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

    const leaderboardRows = useAdaptiveRows({
        rowHeight: 46,
        minRows: 4,
        maxRows: 8,
        viewportOffset: 420,
    });
    const senderRows = loading
        ? Array.from({ length: leaderboardRows }, (_, index) => ({ email: `sender-${index}@example.com`, count: 0 }))
        : (data?.topSenders || []).slice(0, 5);

    const domainRows = loading
        ? Array.from({ length: leaderboardRows }, (_, index) => ({ domain: `domain-${index}.com`, count: 0 }))
        : (data?.topDomains || []).slice(0, 5);

    const teamRows = loading
        ? Array.from({ length: leaderboardRows }, (_, index) => ({ userId: `loading-${index}`, name: 'Loading', responseTimeMinutes: 0, resolvedThreads: 0, slaCompliance: 0 }))
        : (data?.teamPerformance || []).slice(0, 5);

    const displayVolumeSeries = loading
        ? weekDayLabels.map((label) => ({ label, inbound: 0, outbound: 0, total: 0, fillRatio: 0, inboundRatio: 0, outboundRatio: 0 }))
        : volumeSeries;

    const displayBusiestHours = loading
        ? Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, ratio: 0 }))
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

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_420px]">
                <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                    <div>
                        <h2 className="text-2xl font-semibold text-[var(--color-text-primary)]">{t('analytics_volume_title', 'Email Volume (Last 7 Days)')}</h2>
                        <p className="mt-1 text-base text-[var(--color-text-muted)]">Inbound and outbound totals are anchored to the bottom baseline for each day.</p>
                    </div>

                    <div className="mt-5 rounded-2xl border border-[var(--color-card-border)] bg-[#fbfcfd] p-5">
                        <div className="flex h-[230px] items-end justify-between gap-3">
                            {displayVolumeSeries.map((item, index) => (
                                <div key={`${item.label}-${item.total}`} className="relative flex min-w-0 flex-1 flex-col items-center gap-3">
                                    {activeVolumeTooltip === index && (
                                        <div className="pointer-events-none absolute -top-16 z-10 min-w-[140px] rounded-md border border-[#2b4e46] bg-white px-3 py-2 text-xs text-[#143f37] shadow-md">
                                            <div className="font-semibold">{item.label}</div>
                                            <div>Inbound: {Number(item.inbound || 0).toLocaleString()}</div>
                                            <div>Outbound: {Number(item.outbound || 0).toLocaleString()}</div>
                                            <div>Total: {Number(item.total || 0).toLocaleString()}</div>
                                        </div>
                                    )}
                                    <div
                                        className="relative h-[170px] w-full max-w-[92px] overflow-hidden rounded-lg border border-[#2b4e46] bg-white"
                                        onMouseEnter={() => setActiveVolumeTooltip(index)}
                                        onMouseLeave={() => setActiveVolumeTooltip((current) => (current === index ? null : current))}
                                        onFocus={() => setActiveVolumeTooltip(index)}
                                        onBlur={() => setActiveVolumeTooltip((current) => (current === index ? null : current))}
                                        onClick={() => setActiveVolumeTooltip((current) => (current === index ? null : index))}
                                        tabIndex={0}
                                        role="button"
                                        aria-label={`${item.label}: inbound ${item.inbound}, outbound ${item.outbound}, total ${item.total}`}
                                    >
                                        <div
                                            className="absolute inset-x-0 bottom-0 transition-[height] duration-700 ease-out"
                                            style={{ height: `${Math.max(0, Math.min(1, animateCharts ? item.fillRatio : 0)) * 100}%` }}
                                        >
                                            <div className="flex h-full flex-col justify-end">
                                                <div className="w-full bg-[#8fb596]" style={{ height: `${Math.max(0, item.outboundRatio) * 100}%` }} />
                                                <div className="w-full bg-[#193f39]" style={{ height: `${Math.max(0, item.inboundRatio) * 100}%` }} />
                                            </div>
                                        </div>
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
                            return (
                                <div key={email} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 text-lg text-[var(--color-text-primary)]">
                                    <div className="min-w-0 break-all pr-2 text-[15px] leading-6">{loading ? <InlineSkeleton className="h-5 w-44" /> : email}</div>
                                    <div className="justify-self-end whitespace-nowrap font-semibold">{loading ? <InlineSkeleton className="h-5 w-10" /> : Number(sender.count || 0).toLocaleString()}</div>
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
                            {displayBusiestHours.map((entry, index) => (
                                <div key={entry.hour} className="relative flex flex-1 flex-col items-center justify-end gap-3">
                                    {activeHourTooltip === index && (
                                        <div className="pointer-events-none absolute -top-12 z-10 rounded-md border border-[#2d5f55] bg-white px-3 py-2 text-xs text-[#1f4f47] shadow-md">
                                            <div className="font-semibold">{String(entry.hour).padStart(2, '0')}:00</div>
                                            <div>{Number(entry.total || 0).toLocaleString()} messages</div>
                                        </div>
                                    )}
                                    <div
                                        className="w-full rounded-md bg-[#2d5f55] transition-[height] duration-700 ease-out"
                                        style={{ height: `${Math.max(0, Math.min(1, animateCharts ? entry.ratio : 0)) * 142}px` }}
                                        onMouseEnter={() => setActiveHourTooltip(index)}
                                        onMouseLeave={() => setActiveHourTooltip((current) => (current === index ? null : current))}
                                        onFocus={() => setActiveHourTooltip(index)}
                                        onBlur={() => setActiveHourTooltip((current) => (current === index ? null : current))}
                                        onClick={() => setActiveHourTooltip((current) => (current === index ? null : index))}
                                        tabIndex={0}
                                        role="button"
                                        aria-label={`${String(entry.hour).padStart(2, '0')}:00 ${Number(entry.total || 0).toLocaleString()} messages`}
                                    />
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
