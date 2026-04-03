self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

const normalizeThreadId = (threadId) => {
    const base = String(threadId || '');
    if (base.startsWith('thread-')) return base;
    return base.replace(/^t/, '');
};

const readString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '');

const resolveTargetUrl = (payload) => {
    const type = String(payload?.type || '').toLowerCase();
    const threadId = normalizeThreadId(readString(payload?.data?.threadId) || readString(payload?.resourceId));
    const eventId = readString(payload?.data?.eventId) || readString(payload?.resourceId);
    const origin = self.location.origin;

    if (typeof payload?.data?.url === 'string' && payload.data.url.startsWith('/')) {
        return `${origin}${payload.data.url}`;
    }

    if (type.startsWith('calendar')) {
        if (eventId) {
            return `${origin}/calendar?eventId=${encodeURIComponent(eventId)}`;
        }
        return `${origin}/calendar`;
    }

    if (threadId && (type.startsWith('message') || type.startsWith('thread') || type.startsWith('sla') || readString(payload?.data?.threadId))) {
            let hash = 0;
            for (let i = 0; i < threadId.length; i += 1) {
                hash = (hash * 31 + threadId.charCodeAt(i)) % 1000000;
            }
            const routeCode = String(hash).padStart(6, '0');
            return `${origin}/inbox/thread/${routeCode}?tid=${encodeURIComponent(threadId)}`;
    }

    if (payload && typeof payload.url === 'string' && payload.url.trim()) {
        return payload.url;
    }

    if (type.startsWith('message') || type.startsWith('thread') || type.startsWith('sla')) return `${origin}/inbox`;
    return `${origin}/notifications`;
};

self.addEventListener('push', (event) => {
    const payload = event.data ? event.data.json() : {};
    event.waitUntil((async () => {
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const visibleClient = windowClients.find((client) => client.visibilityState === 'visible');

        if (visibleClient) {
            visibleClient.postMessage({ type: 'sermuno:push-notification', payload });
            return;
        }

        if (payload.showDesktop === false) {
            return;
        }

        await self.registration.showNotification(payload.title || 'Sermuno', {
            body: payload.message || '',
            tag: payload.notificationId || 'sermuno-notification',
            silent: !payload.soundEnabled,
            data: {
                url: resolveTargetUrl(payload),
            },
        });
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification.data?.url || self.location.origin;

    event.waitUntil((async () => {
        const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
            if ('focus' in client) {
                await client.focus();
                if ('navigate' in client) {
                    await client.navigate(targetUrl);
                }
                return;
            }
        }

        if (self.clients.openWindow) {
            await self.clients.openWindow(targetUrl);
        }
    })());
});
