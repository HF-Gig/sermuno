import React, { useState, useEffect, useRef } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Mail, CalendarPlus, Bell, MessageCircle, Ticket, AlertTriangle, UserRound, Calendar } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { useTranslation } from 'react-i18next';
import api, { resolveAvatarUrl } from '../../lib/api';
import { ORGANIZATION_UPDATED_EVENT } from '../../lib/organizationEvents';

const resolveOrganizationLogoUrl = (logoUrl?: string | null) => {
    if (!logoUrl) return undefined;
    const normalized = String(logoUrl).trim();
    if (!normalized) return undefined;
    if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('data:') || normalized.startsWith('/')) {
        return resolveAvatarUrl(normalized);
    }
    return resolveAvatarUrl(`/uploads/organizations/logo/${normalized}`);
};

type NotifVisual = {
    subtitle: string;
    icon: React.FC<{ className?: string }>;
};

const notifVisualsByType: Record<string, NotifVisual> = {
    message_received: { subtitle: 'New inbound message received', icon: MessageCircle },
    thread_assigned: { subtitle: 'A thread was assigned', icon: Ticket },
    sla_breach: { subtitle: 'SLA threshold has been breached', icon: AlertTriangle },
    mailbox_sync_failed: { subtitle: 'Mailbox sync failed', icon: AlertTriangle },
    mention: { subtitle: 'You were mentioned', icon: UserRound },
    calendar_event: { subtitle: 'Calendar update', icon: Calendar },
};

const toRelativeTime = (isoDate?: string) => {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return '';

    const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString();
};

const resolveNotificationTarget = (type?: string, resourceId?: string | null) => {
    const normalizedType = String(type || '').toLowerCase();
    const normalizedResourceId = resourceId ? String(resourceId) : '';

    if (!normalizedResourceId) {
        if (normalizedType.startsWith('calendar')) return '/calendar';
        if (normalizedType.startsWith('message') || normalizedType.startsWith('thread')) return '/inbox';
        return '/notifications';
    }

    if (normalizedType.startsWith('calendar')) {
        return `/calendar?eventId=${encodeURIComponent(normalizedResourceId)}`;
    }

    if (normalizedType.startsWith('message')) {
        return `/inbox?t${encodeURIComponent(normalizedResourceId)}`;
    }

    if (normalizedType.startsWith('thread') || normalizedType.startsWith('sla')) {
        return `/inbox/t${encodeURIComponent(normalizedResourceId)}`;
    }

    return '/notifications';
};

const TopHeader: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const isInbox = location.pathname.startsWith('/inbox');
    const isCalendar = location.pathname.startsWith('/calendar');
    const isSettings = location.pathname === '/settings' || (location.pathname.startsWith('/settings/') && !location.pathname.includes('/profile'));
    const { notifications, unreadCount, markAllAsRead, markAsRead, loading, error } = useNotifications();
    const unreadLabel = unreadCount > 99 ? '99+' : unreadCount;
    const [isNotifOpen, setIsNotifOpen] = useState(false);
    const [orgData, setOrgData] = useState<any>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isSettings) {
            setOrgData(null);
            return;
        }

        let isMounted = true;
        const loadOrganization = async () => {
            try {
                const response = await api.get('/organizations/me');
                if (isMounted) {
                    setOrgData(response.data);
                }
            } catch (error) {
                console.error('Failed to load organization header data:', error);
            }
        };

        loadOrganization();

        const handleOrganizationUpdate = (event: Event) => {
            const detail = (event as CustomEvent).detail;
            if (detail && isMounted) {
                setOrgData((prev: any) => ({ ...prev, ...detail }));
            } else {
                loadOrganization();
            }
        };

        window.addEventListener(ORGANIZATION_UPDATED_EVENT, handleOrganizationUpdate as EventListener);
        return () => {
            isMounted = false;
            window.removeEventListener(ORGANIZATION_UPDATED_EVENT, handleOrganizationUpdate as EventListener);
        };
    }, [isSettings]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsNotifOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleNotificationClick = async (notification: any) => {
        if (!notification?.readAt) {
            await markAsRead(notification.id);
        }
        setIsNotifOpen(false);
        navigate(resolveNotificationTarget(notification?.type, notification?.resourceId));
    };

    return (
        <header className="h-[var(--header-height)] bg-[var(--color-header-bg)] border-b border-[var(--color-card-border)] flex items-center justify-between px-6 shrink-0">
            {/* Left: Organization Settings (only on settings page) */}
            {isSettings && orgData && (
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] overflow-hidden shadow-sm">
                        {orgData.logoUrl ? (
                            <img src={resolveOrganizationLogoUrl(orgData.logoUrl)} alt={orgData.name} className="h-full w-full object-cover" />
                        ) : (
                            <div className="h-full w-full flex items-center justify-center bg-[var(--color-accent)]/30 text-sm font-bold text-[var(--color-primary)]">
                                {(orgData.name?.charAt(0) || 'S').toUpperCase()}
                            </div>
                        )}
                    </div>
                    <h1 className="text-lg font-bold text-[var(--color-text-primary)]">
                        Organization Settings
                    </h1>
                </div>
            )}
            {!isSettings && <div />}

            {/* Right: Action buttons — hidden on inbox */}
            <div className="flex items-center gap-2">
                {!isInbox && (
                    <>
                        <button
                            onClick={() => navigate('/inbox?compose=1')}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-text-primary)] border border-[var(--color-card-border)] bg-white hover:bg-[var(--color-background)] transition-colors"
                        >
                            <Mail className="w-4 h-4" />
                            {t('top_compose', 'Compose')}
                        </button>
                        {!isCalendar && (
                            <button
                                onClick={() => navigate('/calendar')}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-[var(--color-text-primary)] border border-[var(--color-card-border)] bg-white hover:bg-[var(--color-background)] transition-colors"
                            >
                                <CalendarPlus className="w-4 h-4" />
                                {t('top_add_event', 'Add Event')}
                            </button>
                        )}
                    </>
                )}
                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setIsNotifOpen(!isNotifOpen)}
                        className={`relative p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-background)] hover:text-[var(--color-text-primary)] transition-colors border border-[var(--color-card-border)] bg-white ${isNotifOpen ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]' : ''}`}
                    >
                        <Bell className="w-4 h-4" />
                        {unreadCount > 0 && (
                            <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                                {unreadLabel}
                            </span>
                        )}
                    </button>

                    {isNotifOpen && (
                        <div className="absolute right-0 top-full z-50 mt-2 w-[420px] max-w-[calc(100vw-1rem)] origin-top-right overflow-hidden rounded-lg border border-[var(--color-secondary)] bg-white shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
                            <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-5 py-4">
                                <span className="text-lg font-medium text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-ui)' }}>
                                    {t('notifications_title', 'Notifications')}
                                </span>
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllAsRead}
                                        className="text-sm font-medium text-[var(--color-secondary)] hover:text-[var(--color-primary)]"
                                        style={{ fontFamily: 'var(--font-ui)' }}
                                    >
                                        {t('notifications_mark_all_read', 'Mark all as read')}
                                    </button>
                                )}
                            </div>

                            <div className="max-h-[520px] overflow-y-auto">
                                {loading ? (
                                    <div className="p-5 text-center text-sm text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                                        Loading notifications...
                                    </div>
                                ) : error ? (
                                    <div className="p-5 text-center text-sm text-red-600" style={{ fontFamily: 'var(--font-body)' }}>
                                        {error}
                                    </div>
                                ) : notifications.length === 0 ? (
                                    <div className="p-5 text-center text-sm text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                                        {t('notifications_empty', 'No notifications yet')}
                                    </div>
                                ) : (
                                    notifications.map(notif => {
                                        const visual = notifVisualsByType[String(notif.type || '').toLowerCase()];
                                        const Icon = visual?.icon || Bell;
                                        const subtitle = notif.message || visual?.subtitle || 'New activity update';
                                        return (
                                            <div
                                                key={notif.id}
                                                onClick={() => handleNotificationClick(notif)}
                                                className="flex cursor-pointer items-start gap-3 border-b border-[var(--color-card-border)]/80 px-5 py-4 transition-colors hover:bg-[var(--color-background)]/20"
                                            >
                                                <div className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-primary)]">
                                                    <Icon className="h-5 w-5" />
                                                </div>

                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[15px] font-medium leading-snug text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-ui)' }}>
                                                        {notif.title}
                                                    </div>
                                                    <div className="mt-1 truncate text-[14px] font-normal text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                                                        {subtitle}
                                                    </div>
                                                </div>

                                                <div className="shrink-0 text-right">
                                                    <div className="text-[14px] font-normal text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                                                        {toRelativeTime(notif.createdAt)}
                                                    </div>
                                                    {!notif.readAt && (
                                                        <span className="ml-auto mt-1 block h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>

                            <div className="px-5 py-4 text-center">
                                <Link
                                    to="/notifications"
                                    onClick={() => setIsNotifOpen(false)}
                                    className="text-[15px] font-medium text-[var(--color-secondary)] hover:text-[var(--color-primary)]"
                                    style={{ fontFamily: 'var(--font-ui)' }}
                                >
                                    {t('notifications_view_all', 'View all notifications')}
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </header>
    );
};

export default TopHeader;
