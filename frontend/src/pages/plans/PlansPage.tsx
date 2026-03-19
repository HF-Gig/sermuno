import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import api from '../../lib/api';
import { clsx } from 'clsx';

const PlansPage = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const contactEmail = import.meta.env.VITE_CONTACT_EMAIL;
    const [currentPlan, setCurrentPlan] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [updatingPlan, setUpdatingPlan] = useState<string | null>(null);

    useEffect(() => {
        const fetch = async () => {
            try {
                const r = await api.get('/organizations/me');
                setCurrentPlan(r.data.plan?.toLowerCase() || 'trial');
            } catch {
                setCurrentPlan('trial');
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, []);

    const handleUpgrade = async (planType: string) => {
        if (!planType || currentPlan === planType) return;
        if (planType === 'enterprise') {
            if (contactEmail) {
                window.location.href = `mailto:${contactEmail}`;
            }
            return;
        }
        setUpdatingPlan(planType);
        try {
            const response = await api.post('/billing/checkout', { planType: planType.toLowerCase() });
            if (response.data?.url) {
                window.location.href = response.data.url;
            } else {
                alert('Failed to initiate checkout. Please try again.');
            }
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } }; message?: string };
            const errorMsg = err.response?.data?.message || err.message || 'Unknown error';
            alert(`Upgrade failed: ${errorMsg}`);
        } finally {
            setUpdatingPlan(null);
        }
    };

    const plans = [
        { id: 'trial', name: t('plan_trial'), price: '$0', description: t('trial_plan_description'), features: [t('max_1_user'), t('max_1_mailbox'), t('1gb_storage'), t('standard_support')], cta: t('get_started'), popular: false },
        { id: 'starter', name: t('plan_starter'), price: '$10', description: t('starter_plan_description'), features: [t('max_5_users'), t('max_3_mailboxes'), t('10gb_storage'), t('standard_support')], cta: t('get_started'), popular: false },
        { id: 'professional', name: 'Professional', price: '$20', description: t('pro_plan_description'), features: [t('unlimited_users'), t('unlimited_mailboxes'), t('100gb_storage'), t('priority_24_7_support'), t('advanced_analytics'), t('custom_branding')], cta: t('get_started'), popular: true },
        { id: 'enterprise', name: t('plan_enterprise'), price: t('custom'), description: t('enterprise_plan_description'), features: [t('custom_user_mailbox_limit'), t('unlimited_storage'), t('priority_24_7_support'), t('dedicated_account_manager'), t('sso_saml'), t('custom_branding')], cta: t('contact_sales'), popular: false },
    ];

    const normalizedCurrentPlan = useMemo(() => currentPlan, [currentPlan]);
    const plansSkeleton = (
        <div className="mx-auto grid w-full max-w-[90rem] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4 animate-pulse">
            {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex min-h-[30.5rem] w-full flex-col rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                    <div className="mb-3 flex min-h-7 items-center justify-center">
                        <div className="h-6 w-24 rounded-full bg-[var(--color-background)]" />
                    </div>
                    <div className="mb-4 border-b border-[var(--color-card-border)] pb-4 space-y-3">
                        <div className="h-6 w-28 rounded-full bg-[var(--color-background)]" />
                        <div className="h-8 w-24 rounded-full bg-[var(--color-background)]" />
                    </div>
                    <div className="mb-4 space-y-2">
                        <div className="h-4 w-full rounded-full bg-[var(--color-background)]" />
                        <div className="h-4 w-10/12 rounded-full bg-[var(--color-background)]" />
                        <div className="h-4 w-8/12 rounded-full bg-[var(--color-background)]" />
                    </div>
                    <div className="mb-6 grow space-y-2.5">
                        {Array.from({ length: 5 }).map((__, featureIndex) => (
                            <div key={featureIndex} className="flex items-start gap-2">
                                <span className="mt-[0.35rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-background)]" />
                                <div className="h-4 w-full rounded-full bg-[var(--color-background)]" />
                            </div>
                        ))}
                    </div>
                    <div className="mt-auto h-12 rounded-xl bg-[var(--color-background)]" />
                </div>
            ))}
        </div>
    );

    return (
        <div className="mx-auto w-full max-w-[90rem] px-4 py-5">
            <div className="mb-4 flex justify-end">
                <button
                    type="button"
                    onClick={() => navigate(-1)}
                    aria-label="Back"
                    className="inline-flex items-center rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-background)] transition-colors"
                    style={{ fontFamily: 'var(--font-ui)' }}
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>
            </div>

            <div className="mb-6 text-center">
                <h1 className="mb-3 text-3xl font-bold uppercase text-[var(--color-text-primary)] md:text-4xl" style={{ fontFamily: 'var(--font-headline)' }}>
                    {t('choose_your_plan')}
                </h1>
                <p className="mx-auto max-w-2xl text-lg text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                    {t('pricing_subtitle')}
                </p>
            </div>
            {loading ? plansSkeleton : <div className="mx-auto grid w-full max-w-[90rem] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {plans.map(plan => {
                    const isCurrent = normalizedCurrentPlan === plan.id;
                    const buttonLabel = isCurrent
                        ? t('current_plan_btn')
                        : plan.id === 'enterprise'
                            ? t('contact_sales')
                            : t('get_started');
                    return (
                        <div
                            key={plan.id}
                            className={clsx(
                                'flex min-h-[30.5rem] w-full flex-col rounded-2xl border bg-white p-5 shadow-[var(--shadow-sm)]',
                                plan.popular
                                    ? 'border-2 border-[var(--color-primary)] shadow-[var(--shadow-md)]'
                                    : 'border-[var(--color-card-border)]',
                            )}
                        >
                            <div className={clsx('mb-3 flex min-h-7 items-center justify-center', !plan.popular && 'invisible')}>
                                {plan.popular && (
                                    <span
                                        className="inline-flex items-center rounded-full border border-[var(--color-primary)] bg-[var(--color-primary)] px-3 py-1 text-[10px] font-semibold text-white"
                                        style={{ fontFamily: 'var(--font-ui)' }}
                                    >
                                        {String(t('most_popular')).toUpperCase()}
                                    </span>
                                )}
                            </div>

                            <div className="mb-4 border-b border-[var(--color-card-border)] pb-4">
                                <h3 className="break-words text-xl font-bold leading-tight text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>
                                    {plan.name}
                                </h3>
                                <div className="mt-2 flex items-baseline gap-1">
                                    <span className="text-3xl font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>{plan.price}</span>
                                </div>
                            </div>

                            <p className="mb-4 min-h-20 text-sm leading-relaxed text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                                {plan.description}
                            </p>

                            <ul className="mb-6 grow space-y-2.5">
                                {plan.features.map((f, i) => (
                                    <li
                                        key={i}
                                        className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]"
                                        style={{ fontFamily: 'var(--font-body)' }}
                                    >
                                        <span className="mt-[0.35rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-primary)]" />
                                        <span>{f}</span>
                                    </li>
                                ))}
                            </ul>

                            <button
                                onClick={() => !isCurrent && handleUpgrade(plan.id)}
                                disabled={isCurrent || loading || updatingPlan === plan.id}
                                className={clsx(
                                    'mt-auto flex w-full items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition-colors',
                                    isCurrent
                                        ? 'cursor-not-allowed border border-[var(--color-card-border)] bg-[var(--color-background)] text-[var(--color-text-muted)]'
                                        : 'bg-[var(--color-cta-primary)] text-white hover:bg-[var(--color-cta-secondary)]',
                                )}
                                style={{ fontFamily: 'var(--font-ui)' }}
                            >
                                {String(updatingPlan === plan.id ? 'APPLYING...' : buttonLabel).toUpperCase()}
                            </button>
                        </div>
                    );
                })}
            </div>}

            <div className="mt-8 text-center">
                <p className="font-medium text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-body)' }}>
                    {t('need_more')}{' '}
                    {contactEmail ? (
                        <a href={`mailto:${contactEmail}`} className="font-bold text-[var(--color-primary)] hover:underline" style={{ fontFamily: 'var(--font-ui)' }}>
                            {t('contact_sales')}
                        </a>
                    ) : (
                        <span className="font-bold text-[var(--color-primary)]" style={{ fontFamily: 'var(--font-ui)' }}>
                            {t('contact_sales')}
                        </span>
                    )}
                </p>
            </div>
        </div>
    );
};

export default PlansPage;
