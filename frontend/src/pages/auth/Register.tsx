import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from './AuthLayout';
import api from '../../lib/api';
import { Eye, EyeOff, AtSign, KeyRound, User, ArrowRight, Building } from 'lucide-react';
import { auth, googleProvider, microsoftProvider, isFirebaseConfigured } from '../../lib/firebase';
import { getRedirectResult, signInWithPopup, signInWithRedirect } from 'firebase/auth';
import { setPendingAuthSession } from './authCodeSession';

interface RegisterInputs {
    name?: string;
    email?: string;
    organizationName?: string;
    password?: string;
    confirmPassword?: string;
}

const OAUTH_PENDING_PROVIDER_KEY = 'sermuno_oauth_pending_provider';

const GoogleIcon = (props: React.ComponentProps<'svg'>) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
        <path d="M12.479,14.265v-3.279h11.049c0.108,0.571,0.164,1.247,0.164,1.979c0,2.46-0.672,5.502-2.84,7.669 C18.744,22.829,16.051,24,12.483,24C5.869,24,0.308,18.613,0.308,12S5.869,0,12.483,0c3.659,0,6.265,1.436,8.223,3.307L18.392,5.62 c-1.404-1.317-3.307-2.341-5.913-2.341C7.65,3.279,3.873,7.171,3.873,12s3.777,8.721,8.606,8.721c3.132,0,4.916-1.258,6.059-2.401 c0.927-0.927,1.537-2.251,1.777-4.059L12.479,14.265z" />
    </svg>
);

const MicrosoftIcon = (props: React.ComponentProps<'svg'>) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" fill="currentColor" {...props}>
        <path fill="#f25022" d="M1 1h9v9H1z" />
        <path fill="#7fba00" d="M11 1h9v9h-9z" />
        <path fill="#00a4ef" d="M1 11h9v9H1z" />
        <path fill="#ffb900" d="M11 11h9v9h-9z" />
    </svg>
);

const AuthSeparator = () => {
    return (
        <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#D5D7DC]" />
            </div>
            <div className="relative flex justify-center">
                <span className="bg-white px-3 text-xs font-medium uppercase tracking-[0.08em] text-[#6B7280]">OR</span>
            </div>
        </div>
    );
};

type OAuthProvider = 'google' | 'microsoft';

export default function Register() {
    const { t } = useTranslation();
    const { register, handleSubmit } = useForm<RegisterInputs>();
    const navigate = useNavigate();
    const { login } = useAuth();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const completeFirebaseAuth = async (token: string, method: OAuthProvider) => {
        const payload: Record<string, unknown> = { token, idToken: token, method, intent: 'register' };

        const response = await api.post('/auth/firebase', payload);
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
                setSuccess(null);
                const token = await redirectUser.getIdToken();
                const providerId = String(result?.providerId || pendingProvider || '').toLowerCase();
                const method: OAuthProvider = providerId.includes('microsoft') ? 'microsoft' : 'google';
                await completeFirebaseAuth(token, method);
            } catch (err: any) {
                console.error('Redirect OAuth registration failed:', err);
                setError(err?.response?.data?.message || t('auth_oauth_complete_register_failed', 'Failed to complete OAuth sign up. Please try again.'));
                sessionStorage.removeItem(OAUTH_PENDING_PROVIDER_KEY);
            } finally {
                setIsLoading(false);
            }
        };

        processRedirectAuth();
    }, []);

    const handleOAuthRegister = async (provider: OAuthProvider) => {
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            if (!isFirebaseConfigured || !auth) {
                throw new Error(t('auth_oauth_signup_unavailable', 'OAuth sign-up is not configured in this environment. Use email registration.'));
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
            console.error(`${provider} OAuth registration failed:`, err);
            setError(
                err?.response?.data?.message ||
                t('auth_oauth_register_failed', 'Failed to continue with {{provider}}. Please try again.', { provider })
            );
        } finally {
            setIsLoading(false);
        }
    };

    const onRegisterSubmit = async (data: RegisterInputs) => {
        setIsLoading(true);
        setError(null);
        setSuccess(null);

        if (!data.organizationName) {
            setError(t('auth_org_required', 'Organization name is required.'));
            setIsLoading(false);
            return;
        }

        if (data.password !== data.confirmPassword) {
            setError(t('passwords_do_not_match', 'Passwords do not match.'));
            setIsLoading(false);
            return;
        }

        try {
            const response = await api.post('/auth/register', {
                email: data.email,
                password: data.password,
                fullName: data.name,
                organizationName: data.organizationName,
                method: 'email'
            });

            setSuccess(response.data.message || t('auth_registration_success', 'Registration successful. Please verify your email.'));
        } catch (err: any) {
            console.error("Registration failed:", err);
            setError(err.response?.data?.message || t('auth_register_failed', 'Failed to register account.'));
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
                        <h1 className="text-[32px] font-semibold tracking-tight md:text-[36px]" style={{ fontFamily: 'Inter', color: '#0F172A' }}>
                            {t('auth_register_heading', 'Start for free')}
                        </h1>
                        <p className="mt-1 text-[15px] text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                            {t('auth_register_subheading', 'No credit card required.')}
                        </p>
                    </div>

                    {/* OAuth */}
                    <div className="flex flex-col gap-3">
                        <button
                            type="button"
                            onClick={() => handleOAuthRegister('google')}
                            className="h-12 w-full rounded-xl bg-[#0B2B26] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#163832] disabled:cursor-not-allowed disabled:opacity-70"
                            style={{ fontFamily: 'Inter' }}
                            disabled={isLoading || !isFirebaseConfigured}
                        >
                            <span className="flex items-center justify-center gap-3">
                                <GoogleIcon className="size-5" />
                                {t('auth_sign_up_with_google', 'Sign up with Google')}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => handleOAuthRegister('microsoft')}
                            className="h-12 w-full rounded-xl bg-[#0B2B26] px-5 text-[15px] font-semibold text-white transition-colors hover:bg-[#163832] disabled:cursor-not-allowed disabled:opacity-70"
                            style={{ fontFamily: 'Inter' }}
                            disabled={isLoading || !isFirebaseConfigured}
                        >
                            <span className="flex items-center justify-center gap-3">
                                <MicrosoftIcon className="size-5" />
                                {t('auth_sign_up_with_microsoft', 'Sign up with Microsoft')}
                            </span>
                        </button>
                    </div>

                    {!isFirebaseConfigured && (
                        <p className="text-center text-xs text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                            {t('auth_oauth_signup_unavailable', 'OAuth sign-up is not configured in this environment. Use email registration.')}
                        </p>
                    )}

                    {/* Divider */}
                    <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-[#D1D5DB]" />
                        <span className="text-xs font-medium uppercase tracking-[0.08em] text-[#6B7280]">{t('auth_divider_or', 'OR')}</span>
                        <div className="h-px flex-1 bg-[#D1D5DB]" />
                    </div>

                    {/* Success */}
                    {success && (
                        <div className="rounded-xl border border-[#D1FAE5] bg-[#F0FDF4] px-4 py-3 text-center">
                            <p className="text-sm font-medium text-[#065F46]" style={{ fontFamily: 'Inter' }}>
                                {success}
                            </p>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-center">
                            <p className="text-sm font-medium text-[#991B1B]" style={{ fontFamily: 'Inter' }}>
                                {error}
                            </p>
                        </div>
                    )}

                    {/* Form */}
                    <form className="flex flex-col gap-4" onSubmit={handleSubmit(onRegisterSubmit)} autoComplete="on">
                        <p className="text-center text-[13px] text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                            {t('auth_register_email_helper', 'Or sign up with your email address')}
                        </p>

                        <div className="relative">
                            <input
                                {...register("name", { required: true })}
                                type="text"
                                id="name"
                                placeholder={t('auth_placeholder_full_name', 'Your full name')}
                                autoComplete="name"
                                className="h-12 w-full appearance-none rounded-xl border border-[#D1D5DB] bg-white !pl-12 !pr-4 py-3 text-[15px] leading-6 text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#9CA3AF] focus:outline-none"
                                style={{ fontFamily: 'Inter', paddingLeft: '3rem', paddingRight: '1rem' }}
                                required
                            />
                            <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]">
                                <User className="size-5" aria-hidden="true" />
                            </div>
                        </div>

                        <div className="relative">
                            <input
                                {...register("email", { required: true })}
                                placeholder={t('auth_placeholder_email', 'Email address')}
                                className="h-12 w-full appearance-none rounded-xl border border-[#D1D5DB] bg-white !pl-12 !pr-4 py-3 text-[15px] leading-6 text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#9CA3AF] focus:outline-none"
                                style={{ fontFamily: 'Inter', paddingLeft: '3rem', paddingRight: '1rem' }}
                                type="email"
                                id="email"
                                autoComplete="username"
                                required
                            />
                            <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]">
                                <AtSign className="size-5" aria-hidden="true" />
                            </div>
                        </div>

                        <div className="relative">
                            <input
                                {...register("organizationName", { required: true })}
                                type="text"
                                id="organizationName"
                                placeholder={t('auth_placeholder_org_name', 'Company or Organization Name')}
                                autoComplete="organization"
                                className="h-12 w-full appearance-none rounded-xl border border-[#D1D5DB] bg-white !pl-12 !pr-4 py-3 text-[15px] leading-6 text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#9CA3AF] focus:outline-none"
                                style={{ fontFamily: 'Inter', paddingLeft: '3rem', paddingRight: '1rem' }}
                                required
                            />
                            <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]">
                                <Building className="size-5" aria-hidden="true" />
                            </div>
                        </div>

                        <>
                            <div className="relative">
                                <input
                                    {...register("password", { required: true, minLength: 8 })}
                                    type={showPassword ? "text" : "password"}
                                    id="password"
                                    placeholder={t('auth_placeholder_create_password', 'Create a password')}
                                    autoComplete="new-password"
                                    required
                                    className="h-12 w-full appearance-none rounded-xl border border-[#D1D5DB] bg-white !pl-12 !pr-11 py-3 text-[15px] leading-6 text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#9CA3AF] focus:outline-none"
                                    style={{ fontFamily: 'Inter', paddingLeft: '3rem', paddingRight: '2.75rem' }}
                                />
                                <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]">
                                    <KeyRound className="size-5" aria-hidden="true" />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(prev => !prev)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] focus:outline-none auth-eye-button"
                                    aria-label={showPassword ? t('auth_hide_password', 'Hide password') : t('auth_show_password', 'Show password')}
                                >
                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>

                            <div className="relative">
                                <input
                                    {...register("confirmPassword", { required: true, minLength: 8 })}
                                    type={showConfirmPassword ? "text" : "password"}
                                    id="confirmPassword"
                                    placeholder={t('auth_placeholder_confirm_password', 'Confirm your password')}
                                    autoComplete="new-password"
                                    required
                                    className="h-12 w-full appearance-none rounded-xl border border-[#D1D5DB] bg-white !pl-12 !pr-11 py-3 text-[15px] leading-6 text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#9CA3AF] focus:outline-none"
                                    style={{ fontFamily: 'Inter', paddingLeft: '3rem', paddingRight: '2.75rem' }}
                                />
                                <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]">
                                    <KeyRound className="size-5" aria-hidden="true" />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(prev => !prev)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] focus:outline-none auth-eye-button"
                                    aria-label={showConfirmPassword ? t('auth_hide_password', 'Hide password') : t('auth_show_password', 'Show password')}
                                >
                                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                        </>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="h-12 w-full mt-2 rounded-xl bg-[#0B2B26] text-[15px] font-semibold text-white shadow-[0_6px_20px_rgba(11,43,38,0.18)] transition-colors hover:bg-[#163832] disabled:cursor-not-allowed disabled:opacity-70"
                            style={{ fontFamily: 'Inter' }}
                        >
                            {isLoading ? t('auth_creating_account', 'Creating Account...') : t('auth_create_free_account', 'Create Free Account')}
                        </button>
                    </form>

                    {/* Footer */}
                    <div className="pt-2 text-center text-sm text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                        <p>
                            {t('auth_sub_register', 'Already have an account?')}{' '}
                            <Link to="/login" className="group font-semibold text-[#111827] underline underline-offset-4 hover:text-[#374151]">
                                {t('auth_link_login', 'Sign in')} <ArrowRight className="size-4 inline-block ml-0.5 transition-transform group-hover:translate-x-0.5" />
                            </Link>
                        </p>
                        <p className="mt-4 text-xs">
                            {t('auth_terms_prefix', 'By creating an account, you agree to our')}{' '}
                            <Link to="/terms" className="hover:text-[#111827] underline underline-offset-4">{t('auth_terms_of_service', 'Terms of Service')}</Link>
                            {' '}{t('auth_and', 'and')}{' '}
                            <Link to="/privacy-policy" className="hover:text-[#111827] underline underline-offset-4">{t('auth_privacy_policy', 'Privacy Policy')}</Link>.
                        </p>
                    </div>
                </div>
            </div>
        </AuthLayout>
    );
}
