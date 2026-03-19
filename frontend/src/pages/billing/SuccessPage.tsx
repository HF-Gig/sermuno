import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, ArrowRight, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../lib/api';

const SuccessPage = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const sessionId = searchParams.get('session_id');
    const [loading, setLoading] = useState(true);
    const [confirmedPlan, setConfirmedPlan] = useState<string | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);

    useEffect(() => {
        const confirmCheckout = async () => {
            if (!sessionId) {
                setSyncError('Missing checkout session id.');
                setLoading(false);
                return;
            }

            try {
                const response = await api.get(`/billing/confirm-checkout?sessionId=${encodeURIComponent(sessionId)}`);
                setConfirmedPlan(response.data?.organization?.plan || null);
            } catch (error: any) {
                console.error('Failed to confirm checkout session:', error);
                setSyncError(error.response?.data?.message || 'Payment succeeded, but we could not sync the organization plan yet. Please refresh Billing in a few moments.');
            } finally {
                setLoading(false);
            }
        };

        confirmCheckout();
    }, [sessionId]);

    return (
        <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12 text-center uppercase">
            <div className="relative mb-8">
                <div className="absolute inset-0 animate-ping rounded-full bg-green-100 opacity-75" />
                <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-green-500 shadow-lg">
                    <CheckCircle className="h-12 w-12 text-white" />
                </div>
            </div>

            <h1 className="mb-4 text-4xl font-bold text-[var(--color-text-primary)] md:text-5xl" style={{ fontFamily: 'var(--font-headline)' }}>
                {t('payment_successful', 'Payment successful')}
            </h1>

            <p className="mx-auto mb-4 max-w-md text-lg text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                {loading
                    ? 'We are syncing your subscription with your organization.'
                    : syncError
                        ? 'Your payment was completed, but the plan has not been confirmed yet.'
                        : `Your organization has been updated successfully${confirmedPlan ? ` to the ${confirmedPlan} plan` : ''}.`}
            </p>

            {syncError && (
                <div className="mx-auto mb-8 flex max-w-xl items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left normal-case text-amber-800">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <div className="font-semibold">Plan sync pending</div>
                        <div className="text-sm">{syncError}</div>
                    </div>
                </div>
            )}

            <button
                onClick={() => navigate('/settings/organization')}
                className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-8 py-4 text-lg font-bold text-white transition-all hover:bg-[var(--color-cta-secondary)] hover:shadow-lg active:scale-95"
                style={{ fontFamily: 'var(--font-ui)' }}
            >
                {t('go_to_dashboard', 'Continue to settings')}
                <ArrowRight className="h-5 w-5" />
            </button>

            <div className="mt-12 text-sm text-[var(--color-text-muted)] normal-case" style={{ fontFamily: 'var(--font-body)' }}>
                {t('order_id', 'Session ID')}: <span className="font-mono text-[var(--color-text-primary)]">{sessionId?.substring(0, 20)}...</span>
            </div>
        </div>
    );
};

export default SuccessPage;
