import type { User } from '../../context/AuthContext';

export interface PendingAuthSession {
    tempToken?: string;
    tokens?: { accessToken: string; refreshToken: string };
    user?: User;
    reason: 'login' | 'signup';
    redirectTo?: string;
}

const STORAGE_KEY = 'sermuno_pending_auth';

export function setPendingAuthSession(session: PendingAuthSession) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getPendingAuthSession(): PendingAuthSession | null {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    try {
        return JSON.parse(raw) as PendingAuthSession;
    } catch (error) {
        console.error('Failed to parse pending auth session:', error);
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
    }
}

export function clearPendingAuthSession() {
    sessionStorage.removeItem(STORAGE_KEY);
}
