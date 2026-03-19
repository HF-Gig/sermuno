import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import AuthLayout from './AuthLayout';
import { clearPendingAuthSession, getPendingAuthSession, type PendingAuthSession } from './authCodeSession';
import { useAuth } from '../../context/AuthContext';
import api from '../../lib/api';

export default function AuthCodePage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { login } = useAuth();
    const [session, setSession] = useState<PendingAuthSession | null>(null);
    const [code, setCode] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        setSession(getPendingAuthSession());
    }, []);

    const handleVerify = async (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setIsSubmitting(true);

        if (!session?.tempToken) {
            setError(t('something_went_wrong', 'Something went wrong. Please try again.'));
            setIsSubmitting(false);
            return;
        }

        try {
            const response = await api.post('/auth/mfa/verify-login', {
                tempToken: session.tempToken,
                totp: code,
            });
            const accessToken = response.data?.accessToken || response.data?.access_token;
            const refreshToken = response.data?.refreshToken || response.data?.refresh_token;
            const user = response.data?.user;

            if (!accessToken || !refreshToken || !user) {
                throw new Error('Invalid auth response');
            }

            login({ accessToken, refreshToken }, user);
            clearPendingAuthSession();
            navigate(session.redirectTo || '/dashboard');
        } catch (err: any) {
            setError(err?.response?.data?.message || t('verify_failed_default', 'Verification failed. Invalid code.'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const title = session?.reason === 'signup'
        ? t('auth_code_title_signup', 'Verify your account')
        : t('auth_code_title_login', 'Enter security code');
    const subtitle = session?.reason === 'signup'
        ? t('auth_code_sub_signup', 'Enter the 6-digit code to finish creating your account.')
        : t('auth_code_sub_login', 'Enter the 6-digit code to continue to your workspace.');

    return (
        <AuthLayout>
            <div className="mx-auto w-full max-w-[420px]">
                <div className="flex flex-col gap-5">
                    {/* Heading */}
                    <div className="flex flex-col items-center text-center">
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0B2B26]/5">
                            <ShieldCheck className="h-7 w-7 text-[#0B2B26]" />
                        </div>
                        <h1 className="text-[32px] font-semibold tracking-tight md:text-[36px]" style={{ fontFamily: 'Inter', color: '#0F172A' }}>
                            {title}
                        </h1>
                        <p className="mt-1 text-[15px] text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                            {subtitle}
                        </p>
                    </div>

                    {!session ? (
                        <div className="rounded-xl border border-[#D1D5DB] bg-white p-5 text-center shadow-sm">
                            <p className="text-[15px] text-[#111827]" style={{ fontFamily: 'Inter' }}>
                                {t('auth_code_session_missing', 'No pending verification was found.')}
                            </p>
                            <p className="mt-1 text-[14px] text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                                Please sign in or sign up again.
                            </p>
                            <div className="mt-5 flex flex-col gap-3">
                                <Link to="/login" className="flex h-11 items-center justify-center rounded-xl bg-[#0B2B26] px-4 text-[15px] font-semibold text-white shadow-[0_6px_20_rgba(11,43,38,0.18)] transition-colors hover:bg-[#163832]" style={{ fontFamily: 'Inter' }}>
                                    {t('auth_link_login', 'Sign in')}
                                </Link>
                                <Link to="/signup" className="flex h-11 items-center justify-center rounded-xl border border-[#D1D5DB] bg-white px-4 text-[15px] font-semibold text-[#111827] shadow-sm transition-colors hover:bg-gray-50" style={{ fontFamily: 'Inter' }}>
                                    {t('auth_link_create', 'Create account')}
                                </Link>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleVerify} className="flex flex-col gap-4 mt-2">
                            {error && (
                                <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-center">
                                    <p className="text-sm font-medium text-[#991B1B]" style={{ fontFamily: 'Inter' }}>
                                        {error}
                                    </p>
                                </div>
                            )}

                            <div>
                                <input
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    placeholder="000000"
                                    className="h-14 w-full appearance-none rounded-xl border border-[#D1D5DB] bg-white px-4 text-center text-[28px] font-medium tracking-[0.3em] text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#9CA3AF] focus:outline-none"
                                    style={{ fontFamily: 'Inter' }}
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting || code.length !== 6}
                                className="h-12 w-full mt-2 rounded-xl bg-[#0B2B26] text-[15px] font-semibold text-white shadow-[0_6px_20px_rgba(11,43,38,0.18)] transition-colors hover:bg-[#163832] disabled:cursor-not-allowed disabled:opacity-70"
                                style={{ fontFamily: 'Inter' }}
                            >
                                {isSubmitting ? t('verifying', 'Verifying...') : t('submit_mfa', 'Verify')}
                            </button>

                            <div className="pt-2 text-center text-sm text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                                <Link to="/login" className="group font-medium text-[#111827] hover:text-[#374151]">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-left inline-block mr-1.5 transition-transform group-hover:-translate-x-0.5"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
                                    {t('back_to_login', 'Back to login')}
                                </Link>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </AuthLayout>
    );
}
