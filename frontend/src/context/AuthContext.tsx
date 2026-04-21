import React, { createContext, useState, useEffect, useContext, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import i18n from '../i18n';
import api from '../lib/api';
import { auth } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { connectSocket, disconnectSocket } from '../lib/socket';

export interface User {
    id: string;
    email: string;
    fullName: string;
    role: string;
    organizationId: string | null;
    locale: string;
    permissions: string[];
    mfaEnabled: boolean;
    provider: string;
    method: string;
    avatarUrl?: string;
    needsSetup?: boolean;
}

interface AuthContextType {
    user: User | null;
    loading: boolean;
    login: (tokens: { accessToken: string; refreshToken: string }, user: User) => void;
    logout: () => Promise<void>;
    updateUser: (user: User) => void;
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const normalizeLanguage = (locale?: string) =>
    String(locale || '').toLowerCase().startsWith('nl') ? 'nl' : 'en';
const applyAppLanguage = (locale?: string) => {
    const nextLang = normalizeLanguage(locale);
    i18n.changeLanguage(nextLang);
    if (typeof document !== 'undefined') {
        document.documentElement.lang = nextLang;
    }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [firebaseResolved, setFirebaseResolved] = useState<boolean>(false);
    const navigate = useNavigate();

    const clearSession = useCallback((redirectTo: string = '/login') => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        applyAppLanguage('en');
        disconnectSocket();
        setUser(null);
        navigate(redirectTo);
    }, [navigate]);

    const logout = useCallback(async () => {
        try {
            if (localStorage.getItem('accessToken')) {
                await api.post('/auth/logout', {});
            }
        } catch (error) {
            const status =
                error &&
                typeof error === 'object' &&
                'response' in error &&
                (error as { response?: { status?: number } }).response?.status;
            if (typeof status !== 'number' || status >= 500) {
                console.error('Logout request failed:', error);
            }
        }
        clearSession('/login');
    }, [clearSession]);

    const login = useCallback((tokens: { accessToken: string; refreshToken: string }, userData: User) => {
        localStorage.setItem('accessToken', tokens.accessToken);
        localStorage.setItem('refreshToken', tokens.refreshToken);
        localStorage.setItem('user', JSON.stringify(userData));
        connectSocket(tokens.accessToken);

        applyAppLanguage(userData?.locale);
        setUser(userData);
    }, []);

    const updateUser = useCallback((userData: User) => {
        setUser(userData);
        localStorage.setItem('user', JSON.stringify(userData));
        if (userData.locale) {
            applyAppLanguage(userData.locale);
        }
    }, []);

    const refreshProfile = useCallback(async () => {
        try {
            const response = await api.get('/auth/me');
            updateUser(response.data);
        } catch (error) {
            const status =
                error &&
                typeof error === 'object' &&
                'response' in error &&
                (error as { response?: { status?: number } }).response?.status;
            if (status === 401 || status === 404) {
                clearSession('/login');
                return;
            }
            console.error("Failed to refresh profile:", error);
        }
    }, [clearSession, updateUser]);

    useEffect(() => {
        const initAuth = async () => {
            const token = localStorage.getItem('accessToken');
            const savedUser = localStorage.getItem('user');

            if (token) {
                let hydratedFromCache = false;

                try {
                    if (savedUser) {
                        const cachedUser = JSON.parse(savedUser);
                        setUser(cachedUser);
                        connectSocket(token);
                        hydratedFromCache = true;
                        if (cachedUser.locale) {
                            applyAppLanguage(cachedUser.locale);
                        }
                        setLoading(false);
                    }

                    const response = await api.get('/auth/me');
                    updateUser(response.data);
                } catch (error) {
                    const status =
                        error &&
                        typeof error === 'object' &&
                        'response' in error &&
                        (error as { response?: { status?: number } }).response?.status;
                    if (status !== 401 && status !== 404) {
                        console.error("Auth initialization failed:", error);
                    }
                    clearSession('/login');
                } finally {
                    if (!hydratedFromCache) {
                        setLoading(false);
                    }
                }
            } else {
                applyAppLanguage('en');
                // No local token. We wait for Firebase to resolve before setting loading = false.
            }
        };

        initAuth();
    }, [clearSession, updateUser]);

    useEffect(() => {
        if (!auth) {
            setFirebaseResolved(true);
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            const hasLocalToken = Boolean(localStorage.getItem('accessToken'));

            if (firebaseUser && !hasLocalToken) {
                console.log('[AuthContext] Session mismatch detected. Healing session via Firebase...');
                try {
                    const idToken = await firebaseUser.getIdToken();
                    const response = await api.post('/auth/firebase', { token: idToken, intent: 'login' });
                    const { accessToken, refreshToken, user: userData } = response.data;
                    
                    if (accessToken && refreshToken && userData) {
                        login({ accessToken, refreshToken }, userData);
                        console.log('[AuthContext] Session healed successfully.');
                    }
                } catch (error) {
                    console.error('[AuthContext] Failed to heal session:', error);
                }
            }
            
            setFirebaseResolved(true);
        });

        return () => unsubscribe();
    }, [login]);

    // Final combined loading state
    useEffect(() => {
        const hasLocalToken = Boolean(localStorage.getItem('accessToken'));
        if (hasLocalToken) {
            // If we have a local token, we don't block for Firebase
            setLoading(false);
        } else if (firebaseResolved) {
            // If we don't have a local token, we wait until Firebase has at least checked
            setLoading(false);
        }
    }, [firebaseResolved]);

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, updateUser, refreshProfile }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
