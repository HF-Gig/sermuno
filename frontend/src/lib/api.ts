import axios from 'axios';
import { connectSocket } from './socket';

type RetryableRequestConfig = {
    _retry?: boolean;
    url?: string;
    headers?: Record<string, string>;
};

let refreshPromise: Promise<{ accessToken: string; refreshToken: string }> | null = null;

const AUTH_BYPASS_PATHS = [
    '/auth/login',
    '/auth/register',
    '/auth/refresh',
    '/auth/mfa/verify-login',
    '/auth/firebase',
    '/auth/oauth-login',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/accept-invite',
];

const isAuthBypassPath = (url?: string) => {
    if (!url) return false;
    return AUTH_BYPASS_PATHS.some((path) => url.includes(path));
};

const emitApiError = (status: number | undefined, message: string) => {
    window.dispatchEvent(new CustomEvent('sermuno:api-error', {
        detail: { status, message }
    }));
};

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
    headers: {
        'Content-Type': 'application/json',
    },
});

const refreshAuthTokens = async (): Promise<{ accessToken: string; refreshToken: string }> => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
        throw new Error('No refresh token');
    }

    const response = await axios.post(`${api.defaults.baseURL}/auth/refresh`, {
        refreshToken,
    });

    const accessToken = response.data?.accessToken || response.data?.access_token;
    const newRefreshToken = response.data?.refreshToken || response.data?.refresh_token;

    if (!accessToken || !newRefreshToken) {
        throw new Error('Invalid refresh response');
    }

    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', newRefreshToken);
    api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
    connectSocket(accessToken);

    return { accessToken, refreshToken: newRefreshToken };
};

api.interceptors.request.use(
    (config) => {
        const accessToken = localStorage.getItem('accessToken');
        if (accessToken) {
            config.headers.Authorization = `Bearer ${accessToken}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = (error.config ?? {}) as RetryableRequestConfig;
        const originalUrl = originalRequest.url;

        if (error.response?.status === 401 && !originalRequest._retry && !isAuthBypassPath(originalUrl)) {
            originalRequest._retry = true;

            try {
                if (!refreshPromise) {
                    refreshPromise = refreshAuthTokens().finally(() => {
                        refreshPromise = null;
                    });
                }

                const tokens = await refreshPromise;

                originalRequest.headers = originalRequest.headers ?? {};
                originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
                return api(originalRequest);
            } catch (refreshError) {
                // If refresh fails, logout
                localStorage.removeItem('accessToken');
                localStorage.removeItem('refreshToken');
                localStorage.removeItem('user');
                emitApiError(401, 'Your session expired. Please sign in again.');
                if (window.location.pathname !== '/login') {
                    window.location.href = '/login';
                }
                return Promise.reject(refreshError);
            }
        }

        if (error.response?.status === 403) {
            error.userMessage = 'You do not have permission to perform this action.';
            emitApiError(403, error.userMessage);
        } else if (error.response?.status === 429) {
            error.userMessage = 'Too many requests. Please wait a moment and try again.';
            emitApiError(429, error.userMessage);
        } else if (error.response?.status >= 500) {
            error.userMessage = 'Something went wrong on the server. Please try again.';
            emitApiError(error.response?.status, error.userMessage);
        }

        return Promise.reject(error);
    }
);

export default api;

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * Resolves an avatar/image URL from the backend.
 * - Relative paths (e.g. /uploads/...) are prefixed with the API base URL.
 * - Absolute URLs (http/https) and data URIs are returned as-is.
 */
export function resolveAvatarUrl(url: string | undefined | null): string | undefined {
    if (!url) return undefined;
    const normalized = String(url).trim();
    if (!normalized) return undefined;

    if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('data:')) {
        return normalized;
    }

    const path = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return `${API_BASE}${path}`;
}
