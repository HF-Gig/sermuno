import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useWebSocket } from './WebSocketContext';
import { playDesktopNotificationSound } from '../lib/pushNotifications';
import { resolveNotificationTarget } from '../lib/notificationRouting';

type NotificationChannels = {
    in_app?: boolean;
    email?: boolean;
    push?: boolean;
    desktop?: boolean;
};

export type Notification = {
    id: string;
    type: string;
    title: string;
    message?: string | null;
    resourceId?: string | null;
    showDesktop?: boolean;
    readAt?: string | null;
    createdAt: string;
    channels?: NotificationChannels;
    data?: {
        channels?: NotificationChannels;
        [key: string]: unknown;
    };
};

type IncomingNotification = Notification & {
    notificationId?: string;
};

type NotificationContextType = {
    notifications: Notification[];
    unreadCount: number;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    markAllAsRead: () => Promise<void>;
    markAsRead: (id: string) => Promise<void>;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const sortByCreatedDesc = (items: Notification[]) => [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { socket } = useWebSocket();
    const navigate = useNavigate();
    const desktopNotificationSeenRef = useRef<Map<string, number>>(new Map());
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [desktopEnabledByType, setDesktopEnabledByType] = useState<Record<string, boolean>>({});
    const [quietHours, setQuietHours] = useState<{ enabled: boolean; start?: string | null; end?: string | null; timezone?: string | null; channels?: string[] }>({ enabled: false, channels: [] });

    const refresh = useCallback(async () => {
        const accessToken = localStorage.getItem('accessToken');
        if (!accessToken) {
            setNotifications([]);
            setDesktopEnabledByType({});
            setQuietHours({ enabled: false, channels: [] });
            setError(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            const [notificationsResponse, settingsResponse] = await Promise.all([
                api.get('/notifications', { params: { page: 1, limit: 100 } }),
                api.get('/notifications/settings').catch(() => ({ data: { preferences: {}, quietHours: { enabled: false, channels: [] } } })),
            ]);
            const items = Array.isArray(notificationsResponse.data?.items)
                ? notificationsResponse.data.items
                : Array.isArray(notificationsResponse.data)
                    ? notificationsResponse.data
                    : [];
            const preferences = settingsResponse.data?.preferences || {};
            setNotifications(sortByCreatedDesc(items));
            setDesktopEnabledByType(Object.fromEntries(Object.entries(preferences).map(([type, pref]: [string, any]) => [type, Boolean(pref?.channels?.desktop)])));
            setQuietHours(settingsResponse.data?.quietHours || { enabled: false, channels: [] });
        } catch (err: any) {
            const message = err?.response?.data?.message || 'Failed to load notifications.';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        if (!socket) return;

        const handleIncoming = (notification: Notification) => {
            setNotifications((prev) => sortByCreatedDesc([notification, ...prev.filter((item) => item.id !== notification.id)]));

            const desktopAllowed = shouldShowDesktopChannel(notification, desktopEnabledByType);
            if (desktopAllowed && canShowDesktopNotification(quietHours)) {
                maybeShowDesktopNotification(notification, navigate, desktopNotificationSeenRef.current);
            }
        };

        socket.on('notification:new', handleIncoming);
        socket.on('notification', handleIncoming);

        return () => {
            socket.off('notification:new', handleIncoming);
            socket.off('notification', handleIncoming);
        };
    }, [desktopEnabledByType, quietHours, socket]);

    useEffect(() => {
        if (!('serviceWorker' in navigator)) {
            return;
        }

        const handleServiceWorkerMessage = (event: MessageEvent) => {
            if (event.data?.type !== 'sermuno:push-notification') {
                return;
            }

            const payload = normalizeIncomingNotification(event.data.payload);
            if (!payload) {
                return;
            }

            setNotifications((prev) => sortByCreatedDesc([payload, ...prev.filter((item) => item.id !== payload.id)]));
            const desktopAllowed = shouldShowDesktopChannel(payload, desktopEnabledByType);
            if (desktopAllowed && canShowDesktopNotification(quietHours)) {
                maybeShowDesktopNotification(payload, navigate, desktopNotificationSeenRef.current);
            }
        };

        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
        return () => {
            navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
        };
    }, [desktopEnabledByType, navigate, quietHours]);

    const markAllAsRead = useCallback(async () => {
        try {
            await api.post('/notifications/read-all');
            setNotifications((prev) => prev.map((notification) => ({
                ...notification,
                readAt: notification.readAt || new Date().toISOString(),
            })));
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to mark notifications as read.');
        }
    }, []);

    const markAsRead = useCallback(async (id: string) => {
        try {
            const response = await api.patch(`/notifications/${id}/read`);
            const updated = response.data;
            setNotifications((prev) => prev.map((notification) => (
                notification.id === id ? { ...notification, readAt: updated?.readAt || new Date().toISOString() } : notification
            )));
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to mark notification as read.');
        }
    }, []);

    const unreadCount = useMemo(
        () => notifications.filter((notification) => !notification.readAt).length,
        [notifications],
    );

    return (
        <NotificationContext.Provider value={{
            notifications,
            unreadCount,
            loading,
            error,
            refresh,
            markAllAsRead,
            markAsRead,
        }}>
            {children}
        </NotificationContext.Provider>
    );
};

const canShowDesktopNotification = (quietHours: { enabled?: boolean; start?: string | null; end?: string | null; timezone?: string | null; channels?: string[] }) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
        return false;
    }
    if (!quietHours.enabled || !quietHours.start || !quietHours.end) {
        return true;
    }
    const scopedChannels = Array.isArray(quietHours.channels) ? quietHours.channels : [];
    if (scopedChannels.length > 0 && !scopedChannels.includes('desktop')) {
        return true;
    }
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: quietHours.timezone || 'UTC',
    });
    const start = quietHours.start;
    const end = quietHours.end;
    if (start <= end) {
        return !(timeStr >= start && timeStr < end);
    }
    return !(timeStr >= start || timeStr < end);
};

const getNotificationChannels = (notification: Notification): NotificationChannels => {
    if (notification.channels && typeof notification.channels === 'object') {
        return notification.channels;
    }
    if (notification.data?.channels && typeof notification.data.channels === 'object') {
        return notification.data.channels;
    }
    return {};
};

const normalizeIncomingNotification = (payload: unknown): Notification | null => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const raw = payload as IncomingNotification;
    const id = typeof raw.id === 'string' && raw.id.trim()
        ? raw.id
        : typeof raw.notificationId === 'string' && raw.notificationId.trim()
            ? raw.notificationId
            : '';

    if (!id) {
        return null;
    }

    return {
        ...raw,
        id,
        createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim()
            ? raw.createdAt
            : new Date().toISOString(),
    };
};

const shouldShowDesktopChannel = (
    notification: Notification,
    desktopEnabledByType: Record<string, boolean>,
) => {
    if (typeof notification.showDesktop === 'boolean') {
        return notification.showDesktop;
    }
    const channels = getNotificationChannels(notification);
    if (typeof channels.desktop === 'boolean') {
        return channels.desktop;
    }
    return Boolean(desktopEnabledByType[notification.type]);
};

const maybeShowDesktopNotification = (
    notification: Notification,
    navigate: ReturnType<typeof useNavigate>,
    recentlySeen: Map<string, number>,
) => {
    const now = Date.now();
    const lastSeenAt = recentlySeen.get(notification.id) ?? 0;
    if (lastSeenAt && now - lastSeenAt < 5000) {
        return;
    }

    recentlySeen.set(notification.id, now);
    for (const [id, seenAt] of recentlySeen.entries()) {
        if (now - seenAt > 30000) {
            recentlySeen.delete(id);
        }
    }

    try {
        const targetUrl = new URL(resolveNotificationTarget(notification), window.location.origin).toString();

        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistration().then((registration) => {
                if (!registration) {
                    const fallback = new Notification(notification.title, {
                        body: notification.message || '',
                        tag: notification.id,
                        silent: true,
                    });
                    playDesktopNotificationSound();
                    fallback.onclick = () => {
                        window.focus();
                        navigate(resolveNotificationTarget(notification));
                    };
                    return;
                }

                registration.showNotification(notification.title, {
                    body: notification.message || '',
                    tag: notification.id,
                    silent: true,
                    data: { url: targetUrl },
                });
                playDesktopNotificationSound();
            }).catch(() => {
                const fallback = new Notification(notification.title, {
                    body: notification.message || '',
                    tag: notification.id,
                    silent: true,
                });
                playDesktopNotificationSound();
                fallback.onclick = () => {
                    window.focus();
                    navigate(resolveNotificationTarget(notification));
                };
            });
            return;
        }

        const desktopNotification = new Notification(notification.title, {
            body: notification.message || '',
            tag: notification.id,
            silent: true,
            data: { url: targetUrl },
        });
        playDesktopNotificationSound();
        desktopNotification.onclick = () => {
            window.focus();
            navigate(resolveNotificationTarget(notification));
        };
    } catch {
        // noop
    }
};

export const useNotifications = () => {
    const context = useContext(NotificationContext);
    if (context === undefined) {
        throw new Error('useNotifications must be used within a NotificationProvider');
    }
    return context;
};
