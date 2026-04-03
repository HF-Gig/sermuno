import api from './api';

const PUSH_REGISTRATION_KEY = 'sermunoPushRegistrationKey';
const DESKTOP_SOUND_KEY = 'sermunoDesktopSoundEnabled';
const SERVICE_WORKER_PATH = '/sermuno-push-sw.js';

type PushConfig = {
    enabled: boolean;
    provider: 'web_push';
    publicKey: string | null;
};

const detectBrowserName = () => {
    const ua = navigator.userAgent;
    if (ua.includes('Edg/')) return 'Edge';
    if (ua.includes('Chrome/')) return 'Chrome';
    if (ua.includes('Firefox/')) return 'Firefox';
    if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
    return 'Unknown';
};

const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
};

export const isBrowserPushSupported = () => typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;

export const getStoredDesktopSoundEnabled = () => localStorage.getItem(DESKTOP_SOUND_KEY) === 'true';

export const fetchPushConfig = async (): Promise<PushConfig> => {
    const response = await api.get('/notifications/push/config');
    return response.data;
};

export const getCurrentPushSubscription = async () => {
    if (!isBrowserPushSupported()) return null;
    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    return registration.pushManager.getSubscription();
};

export const ensureDesktopPermission = async () => {
    if (!isBrowserPushSupported()) {
        return 'unsupported' as const;
    }
    if (Notification.permission === 'granted') {
        return 'granted' as const;
    }
    return Notification.requestPermission();
};

export const registerCurrentBrowserPush = async (soundEnabled: boolean) => {
    if (!isBrowserPushSupported()) {
        throw new Error('Browser push is not supported in this browser.');
    }

    const config = await fetchPushConfig();
    if (!config.enabled || !config.publicKey) {
        throw new Error('Push notifications are not enabled on this server.');
    }

    const permission = await ensureDesktopPermission();
    if (permission !== 'granted') {
        throw new Error('Desktop notification permission was not granted.');
    }

    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });

    const payload = subscription.toJSON();
    const response = await api.post('/notifications/push/register', {
        provider: 'web_push',
        endpoint: payload.endpoint,
        subscription: payload,
        browserName: detectBrowserName(),
        deviceName: navigator.platform || 'browser',
        userAgent: navigator.userAgent,
        metadata: {
            language: navigator.language,
        },
        soundEnabled,
    });

    localStorage.setItem(PUSH_REGISTRATION_KEY, response.data?.registrationKey || `web_push:${payload.endpoint}`);
    localStorage.setItem(DESKTOP_SOUND_KEY, soundEnabled ? 'true' : 'false');

    return {
        permission,
        registration: response.data,
        endpoint: payload.endpoint,
    };
};

export const revokeCurrentBrowserPush = async () => {
    const subscription = await getCurrentPushSubscription();
    const registrationKey = localStorage.getItem(PUSH_REGISTRATION_KEY);

    await api.post('/notifications/push/revoke', {
        registrationKey: registrationKey || undefined,
        endpoint: subscription?.endpoint,
        subscription: subscription?.toJSON(),
    });

    if (subscription) {
        await subscription.unsubscribe().catch(() => undefined);
    }

    localStorage.removeItem(PUSH_REGISTRATION_KEY);
};

export const playDesktopNotificationSound = () => {
    if (!getStoredDesktopSoundEnabled()) {
        return;
    }

    try {
        const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) return;
        const context = new AudioContextCtor();
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.value = 0.0001;

        oscillator.connect(gain);
        gain.connect(context.destination);

        const now = context.currentTime;
        gain.gain.exponentialRampToValueAtTime(0.04, now + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        oscillator.start(now);
        oscillator.stop(now + 0.2);
        oscillator.onended = () => {
            context.close().catch(() => undefined);
        };
    } catch {
        // noop
    }
};
