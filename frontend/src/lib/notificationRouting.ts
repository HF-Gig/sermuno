type NotificationRouteInput = {
    type?: string | null;
    resourceId?: string | null;
    data?: {
        threadId?: unknown;
        eventId?: unknown;
        url?: unknown;
        [key: string]: unknown;
    };
};

const normalizeThreadId = (threadId: string): string => {
    const base = String(threadId || '');
    if (base.startsWith('thread-')) return base;
    return base.replace(/^t/, '');
};

const readString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : '');

const toThreadRouteCode = (threadId: string): string => {
    const base = normalizeThreadId(threadId);
    if (!base) return '0';
    let hash = 0;
    for (let i = 0; i < base.length; i += 1) {
        hash = (hash * 31 + base.charCodeAt(i)) % 1000000;
    }
    return String(hash).padStart(6, '0');
};

const resolveFromValues = (type?: string | null, resourceId?: string | null, data?: NotificationRouteInput['data']) => {
    const normalizedType = String(type || '').toLowerCase();
    const dataUrl = readString(data?.url);
    const threadId = normalizeThreadId(readString(data?.threadId) || String(resourceId || ''));
    const eventId = readString(data?.eventId) || readString(resourceId);

    if (dataUrl.startsWith('/')) {
        return dataUrl;
    }

    if (normalizedType.startsWith('calendar')) {
        if (eventId) {
            return `/calendar?eventId=${encodeURIComponent(eventId)}`;
        }
        return '/calendar';
    }

    if (threadId && (normalizedType.startsWith('message') || normalizedType.startsWith('thread') || normalizedType.startsWith('sla') || readString(data?.threadId))) {
        return `/inbox/thread/${toThreadRouteCode(threadId)}?tid=${encodeURIComponent(threadId)}`;
    }

    if (!threadId) {
        if (normalizedType.startsWith('message') || normalizedType.startsWith('thread') || normalizedType.startsWith('sla')) return '/inbox';
        return '/notifications';
    }

    return '/notifications';
};

export const resolveNotificationTarget = (
    notificationOrType?: NotificationRouteInput | string | null,
    resourceId?: string | null,
) => {
    if (notificationOrType && typeof notificationOrType === 'object') {
        return resolveFromValues(
            notificationOrType.type,
            notificationOrType.resourceId,
            notificationOrType.data,
        );
    }

    return resolveFromValues(notificationOrType, resourceId, undefined);
};
