import React, { useMemo, useState } from 'react';
import { Bell, CheckCheck, RefreshCcw, Search } from 'lucide-react';
import EmptyState from '../../../components/ui/EmptyState';
import { InlineSkeleton } from '../../../components/ui/Skeleton';
import { useNotifications } from '../../../context/NotificationContext';
import { useAdaptiveRows } from '../../../hooks/useAdaptiveCount';

type NotificationTab = 'all' | 'unread';

const formatTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
};

const NotificationsPage: React.FC = () => {
    const { notifications, unreadCount, loading, error, markAllAsRead, markAsRead, refresh } = useNotifications();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<NotificationTab>('all');
    const loadingRows = useAdaptiveRows({
        rowHeight: 82,
        minRows: 4,
        maxRows: 10,
        viewportOffset: 320,
    });

    const filtered = useMemo(() => {
        return notifications.filter((notification) => {
            if (activeTab === 'unread' && notification.readAt) return false;

            if (!searchQuery.trim()) return true;
            const query = searchQuery.toLowerCase();
            return (
                String(notification.title || '').toLowerCase().includes(query)
                || String(notification.message || '').toLowerCase().includes(query)
                || String(notification.type || '').toLowerCase().includes(query)
            );
        });
    }, [notifications, searchQuery, activeTab]);

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="space-y-1.5">
                <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-4xl" style={{ fontFamily: 'var(--font-ui)' }}>
                    Notifications
                </h1>
                <p className="text-sm text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                    Synced from backend notification APIs.
                </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <label className="relative block grow">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]/70" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search notifications"
                        className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-9 py-2.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]/70"
                        style={{ fontFamily: 'var(--font-body)' }}
                    />
                </label>

                <button
                    type="button"
                    onClick={refresh}
                    className="inline-flex items-center justify-center rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
                >
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Refresh
                </button>

                <button
                    type="button"
                    onClick={markAllAsRead}
                    disabled={unreadCount === 0}
                    className="inline-flex items-center justify-center rounded-lg border border-[var(--color-secondary)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <CheckCheck className="mr-2 h-4 w-4" />
                    Mark all as read
                </button>
            </div>

            <div className="flex items-center gap-5 border-b border-[var(--color-card-border)]/40 pb-2">
                {([
                    ['all', loading ? 'All (...)' : `All (${notifications.length})`],
                    ['unread', loading ? 'Unread (...)' : `Unread (${unreadCount})`],
                ] as const).map(([tab, label]) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`border-b-2 pb-1.5 text-sm transition-colors ${activeTab === tab
                            ? 'border-[var(--color-secondary)] font-medium text-[var(--color-text-primary)]'
                            : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {error ? (
                <p className="text-sm text-red-600">{error}</p>
            ) : !loading && filtered.length === 0 ? (
                <EmptyState icon={Bell} title="No notifications" description="You're all caught up." />
            ) : (
                <div className="space-y-2.5">
                    {(loading ? Array.from({ length: loadingRows }, (_, index) => ({ id: `loading-${index}`, title: '', message: '', createdAt: '', readAt: null })) : filtered).map((notification) => (
                        <button
                            key={notification.id}
                            type="button"
                            onClick={() => !loading && markAsRead(notification.id)}
                            className={`flex w-full items-start gap-4 rounded-xl border bg-white px-4 py-4 text-left shadow-[0_1px_1px_rgba(5,31,32,0.08)] transition-colors hover:bg-[var(--color-background)]/25 ${notification.readAt
                                ? 'border-[var(--color-card-border)]'
                                : 'border-[var(--color-secondary)]'
                            }`}
                        >
                            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-background)]">
                                <Bell className="h-4 w-4 text-[var(--color-primary)]" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-[var(--color-text-primary)]">
                                    {loading ? <InlineSkeleton className="h-4 w-40" /> : notification.title}
                                </span>
                                {(loading || notification.message) && (
                                    <span className="mt-0.5 block text-sm text-[var(--color-text-primary)]">
                                        {loading ? <InlineSkeleton className="h-4 w-64" /> : notification.message}
                                    </span>
                                )}
                                <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                                    {loading ? <InlineSkeleton className="h-3 w-24" /> : formatTime(notification.createdAt)}
                                </span>
                            </span>
                            {!loading && !notification.readAt && (
                                <span className="mt-1 rounded-full bg-[var(--color-secondary)] px-2 py-0.5 text-xs font-medium text-white">
                                    New
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default NotificationsPage;
