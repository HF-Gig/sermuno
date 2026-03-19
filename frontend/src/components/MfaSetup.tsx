import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, QrCode, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';

type Step = 'initial' | 'qr' | 'success' | 'disable_confirm';

export default function MfaSetup({ embedded = false }: { embedded?: boolean }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { user, updateUser } = useAuth();
    const [step, setStep] = useState<Step>('initial');
    const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
    const [secret, setSecret] = useState<string | null>(null);
    const [token, setToken] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    useEffect(() => {
        if (user?.mfaEnabled) {
            setStep('initial');
        }
    }, [user?.mfaEnabled]);

    const resetCodeState = () => {
        setToken('');
        setError(null);
    };

    const generateMfa = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await api.post('/auth/mfa/generate');
            const qrCode = response.data.qrCode;
            if (typeof qrCode === 'string' && qrCode.startsWith('data:image/png;base64,')) {
                const encoded = qrCode.slice('data:image/png;base64,'.length);
                const decoded = atob(encoded);
                setOtpauthUrl(decoded);
            } else {
                setOtpauthUrl(response.data.otpauthUrl || null);
            }
            setSecret(response.data.secret);
            setStep('qr');
        } catch (err: any) {
            setError(err.response?.data?.message || t('mfa_gen_failed'));
        } finally {
            setIsLoading(false);
        }
    };

    const enableMfa = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await api.post('/auth/mfa/enable', { totp: token });
            if (user) updateUser({ ...user, mfaEnabled: true });
            setStep('success');
            setShowSuccess(true);
        } catch (err: any) {
            setError(err.response?.data?.message || 'Invalid 2FA code');
        } finally {
            setIsLoading(false);
        }
    };

    const disableMfa = async () => {
        setIsLoading(true);
        setError(null);
        try {
            await api.post('/auth/mfa/disable', { totp: token });
            if (user) updateUser({ ...user, mfaEnabled: false });
            setStep('initial');
            resetCodeState();
            setShowSuccess(false);
        } catch (err: any) {
            setError(err.response?.data?.message || t('failed_to_disable_mfa'));
        } finally {
            setIsLoading(false);
        }
    };

    const content = (
        <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] p-5 md:p-6">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-[var(--color-primary)]" />
                            <h1 className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)]">
                                {t('mfa_setup_title', 'Two-Factor Authentication Setup')}
                            </h1>
                        </div>
                        <p className="mt-2 text-sm text-[var(--color-text-muted)] max-w-xl">
                            {user?.mfaEnabled
                                ? (t('mfa_enabled_desc', 'Two-factor authentication is currently enabled for your account.'))
                                : (t('mfa_setup_desc', 'Protect your account with two-factor authentication. You will need an authenticator app like Google Authenticator.'))}
                        </p>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${user?.mfaEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {user?.mfaEnabled ? (t('mfa_status_on') || 'MFA On') : (t('mfa_status_off') || 'MFA Off')}
                    </span>
                </div>

                {error && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {step === 'initial' && (
                    <div className="mt-6 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
                        <div className="flex flex-wrap gap-2">
                            {user?.mfaEnabled ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        resetCodeState();
                                        setStep('disable_confirm');
                                    }}
                                    className="inline-flex items-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                                >
                                    {t('disable_mfa')}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={generateMfa}
                                    disabled={isLoading}
                                    className="inline-flex items-center rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)] disabled:opacity-60"
                                >
                                    {isLoading ? t('loading') : t('mfa_setup_btn', 'Setup MFA')}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {step === 'qr' && (
                    <div className="mt-6 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5 items-start">
                        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4 flex items-center justify-center min-h-[220px]">
                            {otpauthUrl ? (
                                <div className="rounded-xl border border-[var(--color-card-border)] bg-white p-2">
                                    <QRCodeSVG value={otpauthUrl} size={180} includeMargin />
                                </div>
                            ) : (
                                <QrCode className="h-10 w-10 text-[var(--color-text-muted)]" />
                            )}
                        </div>

                        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
                            <p className="text-sm text-[var(--color-text-primary)]">
                                {t('mfa_qr_desc', 'Scan this QR code with your authenticator app, then enter the 6-digit code below.')}
                            </p>
                            {secret && (
                                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                                    {t('mfa_secret_label') || 'Secret'}: <span className="font-mono">{secret}</span>
                                </p>
                            )}

                            <div className="mt-4">
                                <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                                    {t('mfa_code_label')}
                                </label>
                                <input
                                    type="text"
                                    value={token}
                                    onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder=""
                                    maxLength={6}
                                    className={`w-full rounded-xl bg-white px-3 py-2.5 text-center tracking-[0.35em] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 ${error ? 'border border-red-300 focus:ring-red-200' : 'border border-[var(--color-input-border)] focus:ring-[var(--color-primary)]/20'}`}
                                />
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={enableMfa}
                                    disabled={isLoading || token.length !== 6}
                                    className="inline-flex items-center rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)] disabled:opacity-60"
                                >
                                    {isLoading ? t('verifying') : t('mfa_enable_btn', 'Enable MFA')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setStep('initial');
                                        resetCodeState();
                                    }}
                                    className="inline-flex items-center rounded-lg border border-[var(--color-card-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
                                >
                                    {t('cancel')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {step === 'disable_confirm' && (
                    <div className="mt-6 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] p-4">
                        <p className="text-sm text-[var(--color-text-primary)]">
                            {t('mfa_disable_confirm_desc', 'To disable MFA, please enter a 6-digit code from your authenticator app.')}
                        </p>
                        <div className="mt-4">
                            <input
                                type="text"
                                value={token}
                                onChange={(e) => setToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                placeholder=""
                                maxLength={6}
                                className={`w-full rounded-xl bg-white px-3 py-2.5 text-center tracking-[0.35em] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 ${error ? 'border border-red-300 focus:ring-red-200' : 'border border-[var(--color-input-border)] focus:ring-[var(--color-primary)]/20'}`}
                            />
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={disableMfa}
                                disabled={isLoading || token.length !== 6}
                                className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                            >
                                {isLoading ? t('loading') : (t('mfa_confirm_disable_btn') || t('disable_mfa'))}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStep('initial');
                                    resetCodeState();
                                }}
                                className="inline-flex items-center rounded-lg border border-[var(--color-card-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
                            >
                                {t('cancel')}
                            </button>
                        </div>
                    </div>
                )}

                {step === 'success' && showSuccess && (
                    <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                        <div className="flex items-start gap-3">
                            <div className="h-10 w-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                                <CheckCircle2 className="h-5 w-5" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-semibold text-emerald-800">
                                    {t('mfa_success_msg', 'Two-factor authentication has been enabled successfully.')}
                                </p>
                                <p className="text-xs text-emerald-700 mt-1">
                                    {t('mfa_login_now_requires_code') || 'Your next sign in will require the 6-digit security code.'}
                                </p>
                            </div>
                        </div>
                        <div className="mt-4">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowSuccess(false);
                                    setStep('initial');
                                    resetCodeState();
                                    if (!embedded) {
                                        navigate('/settings/profile?tab=security');
                                    }
                                }}
                                className="inline-flex items-center rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                            >
                                {t('okay', 'Okay')}
                            </button>
                        </div>
                    </div>
                )}
        </div>
    );

    if (embedded) {
        return content;
    }

    return <div className="max-w-3xl mx-auto py-4">{content}</div>;
}
