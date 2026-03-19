/// <reference types="vite/client" />
import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, AtSign, KeyRound, ArrowRight } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from './AuthLayout';
import { GoogleIcon, MicrosoftIcon } from './components/utils';
import { AUTH_COLORS, AUTH_FONTS } from './theme';
import api from '../../lib/api';
import { auth, googleProvider, microsoftProvider, isFirebaseConfigured } from '../../lib/firebase';
import { getRedirectResult, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { setPendingAuthSession } from './authCodeSession';

interface LoginInputs {
    email?: string;
    password?: string;
}

const OAUTH_PENDING_PROVIDER_KEY = 'sermuno_oauth_pending_provider';

export default function Login() {
    const { t } = useTranslation();
    const { register, handleSubmit } = useForm<LoginInputs>();
    const navigate = useNavigate();
    const { login } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const completeFirebaseAuth = async (token: string, method: 'google' | 'microsoft') => {
        const payload = { token, idToken: token, method, intent: 'login' as const };
        let response;
        try {
            response = await api.post('/auth/oauth-login', payload);
        } catch (primaryError: any) {
            // Compatibility fallback for older backend route name.
            if (!primaryError?.response) {
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
            response = await api.post('/auth/firebase', payload);
        }
        if ((response.data?.requiresMfa || response.data?.mfaRequired || response.data?.requireMfa) && response.data?.tempToken) {
            setPendingAuthSession({
                reason: 'login',
                tempToken: response.data.tempToken,
                redirectTo: '/dashboard'
            });
            navigate('/auth-code');
            return;
        }

        const accessToken = response.data?.accessToken || response.data?.access_token;
        const refreshToken = response.data?.refreshToken || response.data?.refresh_token;
        const user = response.data?.user;

        if (!accessToken || !refreshToken || !user) {
            throw new Error('Invalid auth response');
        }

        login({ accessToken, refreshToken }, user);
        sessionStorage.removeItem(OAUTH_PENDING_PROVIDER_KEY);
        navigate('/dashboard');
    };

    useEffect(() => {
        const processRedirectAuth = async () => {
            if (!isFirebaseConfigured || !auth) {
                return;
            }

            try {
                const result = await getRedirectResult(auth);
                const pendingProvider = sessionStorage.getItem(OAUTH_PENDING_PROVIDER_KEY);
                const redirectUser = result?.user ?? (pendingProvider ? auth.currentUser : null);
                if (!redirectUser) {
                    return;
                }

                setIsLoading(true);
                setError(null);
                const token = await redirectUser.getIdToken();
                const providerId = String(result?.providerId || pendingProvider || '').toLowerCase();
                const method: 'google' | 'microsoft' = providerId.includes('microsoft') ? 'microsoft' : 'google';
                await completeFirebaseAuth(token, method);
            } catch (err: any) {
                console.error('Redirect OAuth login failed:', err);
                setError(err?.response?.data?.message || t('auth_oauth_complete_login_failed', 'Failed to complete OAuth sign in. Please try again.'));
                sessionStorage.removeItem(OAUTH_PENDING_PROVIDER_KEY);
            } finally {
                setIsLoading(false);
            }
        };

        processRedirectAuth();
    }, []);

    const handleOAuthLogin = async (provider: 'google' | 'microsoft') => {
        setIsLoading(true);
        setError(null);

        try {
            if (!isFirebaseConfigured || !auth) {
                throw new Error(t('auth_oauth_signin_unavailable', 'OAuth login is not configured in this environment. Use email and password sign-in.'));
            }
            const selectedProvider = provider === 'google' ? googleProvider : microsoftProvider;
            if (!selectedProvider) {
                throw new Error(t('auth_oauth_provider_unavailable', 'The selected OAuth provider is unavailable.'));
            }

            if (provider === 'microsoft') {
                sessionStorage.setItem(OAUTH_PENDING_PROVIDER_KEY, provider);
                await signInWithRedirect(auth, selectedProvider);
                return;
            }

            let result;
            try {
                result = await signInWithPopup(auth, selectedProvider);
            } catch (popupError: any) {
                const code = String(popupError?.code || '');
                if (
                    provider === 'microsoft' ||
                    code.includes('popup-blocked') ||
                    code.includes('operation-not-supported') ||
                    code.includes('cancelled-popup-request')
                ) {
                    sessionStorage.setItem(OAUTH_PENDING_PROVIDER_KEY, provider);
                    await signInWithRedirect(auth, selectedProvider);
                    return;
                }
                throw popupError;
            }

            const token = await result.user.getIdToken();
            await completeFirebaseAuth(token, provider);
        } catch (err: any) {
            console.error(`${provider} OAuth login failed:`, err);
            const networkMessage =
                err?.message === 'Network Error'
                    ? t('auth_backend_unreachable', 'Cannot reach the backend service. Please ensure the backend is running and try again.')
                    : null;
            setError(
                networkMessage ||
                err?.response?.data?.message ||
                t('auth_oauth_login_failed', 'Failed to sign in with {{provider}}. Please try again.', { provider })
            );
        } finally {
            setIsLoading(false);
        }
    };

    const onLoginSubmit = async (data: LoginInputs) => {
        setIsLoading(true);
        setError(null);

        try {
            const email = data.email?.trim().toLowerCase() || '';
            const password = data.password || '';

            if (!email || !password) {
                setError(t('auth_missing_credentials', 'Please enter your email and password.'));
                setIsLoading(false);
                return;
            }

            const response = await api.post('/auth/login', { email, password });
            if ((response.data?.requiresMfa || response.data?.mfaRequired || response.data?.requireMfa) && response.data?.tempToken) {
                setPendingAuthSession({
                    reason: 'login',
                    tempToken: response.data.tempToken,
                    redirectTo: '/dashboard'
                });
                navigate('/auth-code');
                return;
            }

            const accessToken = response.data?.accessToken || response.data?.access_token;
            const refreshToken = response.data?.refreshToken || response.data?.refresh_token;
            const user = response.data?.user;

            if (!accessToken || !refreshToken || !user) {
                throw new Error('Invalid auth response');
            }

            login({ accessToken, refreshToken }, user);
            navigate('/dashboard');
        } catch (err: any) {
            console.error('Login failed:', err);
            setError(err.response?.data?.message || t('auth_incorrect_creds', 'Incorrect email or password.'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthLayout>
            <div className="mx-auto w-full max-w-[420px]">
                <div className="flex flex-col gap-5">

                    {/* Heading */}
                    <div className="text-center">
                        <h1
                            className="text-[32px] font-semibold tracking-tight md:text-[36px]"
                            style={{ fontFamily: AUTH_FONTS.sans, color: AUTH_COLORS.textMain }}
                        >
                            {t('auth_login_join_now', 'Sign In or Join Now!')}
                        </h1>
                    </div>

                    {/* OAuth */}
                    <div className="flex flex-col gap-3">
                        <button
                            type="button"
                            onClick={() => handleOAuthLogin('google')}
                            className="auth-button-oauth"
                            disabled={isLoading || !isFirebaseConfigured}
                        >
                            <GoogleIcon className="size-5" />
                            {t('auth_sign_in_with_google', 'Sign in with Google')}
                        </button>

                        <button
                            type="button"
                            onClick={() => handleOAuthLogin('microsoft')}
                            className="auth-button-oauth"
                            disabled={isLoading || !isFirebaseConfigured}
                        >
                            <MicrosoftIcon className="size-5" />
                            {t('auth_sign_in_with_microsoft', 'Sign in with Microsoft')}
                        </button>
                    </div>

                    {!isFirebaseConfigured && (
                        <p className="text-center text-xs text-[#6B7280]" style={{ fontFamily: AUTH_FONTS.sans }}>
                            {t('auth_oauth_signin_unavailable', 'OAuth login is not configured in this environment. Use email and password sign-in.')}
                        </p>
                    )}

                    {/* Divider */}
                    <div className="auth-separator">
                        <div className="auth-separator-line" />
                        <span className="auth-separator-text">{t('auth_divider_or', 'OR')}</span>
                        <div className="auth-separator-line" />
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="auth-alert-error">
                            <p className="auth-alert-error-text">
                                {error}
                            </p>
                        </div>
                    )}

                    {/* Form */}
                    <form onSubmit={handleSubmit(onLoginSubmit)} autoComplete="on" className="flex flex-col gap-4">
                        <p className="auth-helper-text">
                            {t('auth_login_helper', 'Enter your email address to sign in or create an account')}
                        </p>

                        <div className="relative">
                            <input
                                {...register('email', { required: true })}
                                type="email"
                                id="email"
                                required
                                autoComplete="email"
                                placeholder={t('auth_placeholder_email', 'Email address')}
                                className="auth-input auth-input-with-left-icon"
                                style={{ fontFamily: AUTH_FONTS.sans }}
                            />
                            <div className="auth-input-icon auth-input-icon-left">
                                <AtSign className="size-5" aria-hidden="true" />
                            </div>
                        </div>

                        <div className="relative">
                            <input
                                {...register('password', { required: true })}
                                type={showPassword ? 'text' : 'password'}
                                id="password"
                                required
                                autoComplete="current-password"
                                placeholder={t('auth_placeholder_password', 'Enter your password')}
                                className="auth-input auth-input-with-left-icon auth-input-with-right-icon"
                                style={{ fontFamily: AUTH_FONTS.sans }}
                            />
                            <div className="auth-input-icon auth-input-icon-left">
                                <KeyRound className="size-5" aria-hidden="true" />
                            </div>

                            <button
                                type="button"
                                onClick={() => setShowPassword((p) => !p)}
                                className="auth-input-icon auth-input-icon-right auth-eye-button"
                                aria-label={showPassword ? t('auth_hide_password', 'Hide password') : t('auth_show_password', 'Show password')}
                            >
                                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                        </div>

                        <div className="flex justify-end pb-1 pt-1">
                            <Link
                                to="/forgot-password"
                                style={{ fontFamily: AUTH_FONTS.sans, color: AUTH_COLORS.gray500 }}
                                className="text-[13px] font-medium hover:text-[black] underline-offset-4 hover:underline"
                            >
                                {t('forgot_password_link', 'Forgot password?')}
                            </Link>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="auth-button-primary"
                            style={{ fontFamily: AUTH_FONTS.sans }}
                        >
                            {isLoading ? t('auth_continue_action', 'Continuing...') : t('auth_btn_login', 'Sign In')}
                        </button>
                    </form>

                    {/* Footer */}
                    <p className="auth-form-footer" style={{ fontFamily: AUTH_FONTS.sans }}>
                        {t('auth_sub_login', "Don't have an account?")}{' '}
                        <Link
                            to="/signup"
                            className="group inline-flex items-center gap-0.5"
                        >
                            {t('auth_sign_up_now', 'Sign up now')} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                    </p>
                </div>
            </div>
        </AuthLayout>
    );
}
