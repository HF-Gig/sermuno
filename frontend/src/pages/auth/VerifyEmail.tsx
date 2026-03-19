import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import AuthLayout from './AuthLayout';

const VerifyEmail = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const verifyToken = async () => {
            if (!token) {
                setStatus('error');
                setError(t('missing_verification_token', 'Missing verification token.'));
                return;
            }

            try {
                await api.post('/auth/verify-email', { token });
                setStatus('success');
                setTimeout(() => {
                    navigate('/login');
                }, 3000);
            } catch (err: any) {
                console.error('Email verification failed:', err);
                setStatus('error');
                setError(err.response?.data?.message || t('invalid_or_expired_verification_token', 'Invalid or expired verification token.'));
            }
        };

        verifyToken();
    }, [token, navigate, t]);

    return (
        <AuthLayout>
            <div className="text-center">
                {status === 'loading' && (
                    <div className="space-y-4">
                        <Loader2 className="w-12 h-12 text-[#163832] animate-spin mx-auto" />
                        <h2 className="text-2xl font-bold tracking-tight text-[#051F20]" style={{ fontFamily: 'Inter' }}>
                            {t('verifying_your_email', 'Verifying your email...')}
                        </h2>
                        <p className="text-sm text-[#0B2B26]" style={{ fontFamily: 'Inter' }}>
                            {t('please_wait_while_we_verify', 'Please wait while we verify your email address.')}
                        </p>
                    </div>
                )}

                {status === 'success' && (
                    <div className="space-y-4">
                        <CheckCircle2 className="w-12 h-12 text-[#235347] mx-auto" />
                        <h2 className="text-2xl font-bold tracking-tight text-[#051F20]" style={{ fontFamily: 'Inter' }}>
                            {t('email_verified_success', 'Email Verified!')}
                        </h2>
                        <p className="text-sm text-[#0B2B26]" style={{ fontFamily: 'Inter' }}>
                            {t('redirecting_to_dashboard', 'Redirecting to your dashboard...')}
                        </p>
                    </div>
                )}

                {status === 'error' && (
                    <div className="space-y-6">
                        <XCircle className="w-12 h-12 text-[#8EB69B] mx-auto" />
                        <div>
                            <h2 className="text-2xl font-bold tracking-tight text-[#051F20] mb-2" style={{ fontFamily: 'Inter' }}>
                                {t('verification_failed', 'Verification Failed')}
                            </h2>
                            <p className="text-[#163832] font-medium text-sm" style={{ fontFamily: 'Inter' }}>
                                {error}
                            </p>
                        </div>
                        <button
                            onClick={() => navigate('/login')}
                            className="w-full flex items-center justify-center h-11 rounded-md bg-[#163832] text-[#ffffff] hover:bg-[#235347] transition-colors font-medium text-sm"
                            style={{ fontFamily: 'Inter' }}
                        >
                            {t('back_to_login', 'Back to logging in')}
                        </button>
                    </div>
                )}
            </div>
        </AuthLayout>
    );
};

export default VerifyEmail;
