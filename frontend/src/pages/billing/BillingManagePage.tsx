import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import PageHeader from '../../components/ui/PageHeader';

type BillingInfoResponse = {
    currentPlan: 'trial' | 'starter' | 'professional' | 'enterprise';
    subscriptionStatus: 'active' | 'past_due' | 'canceled' | 'trialing';
    stripeSubscriptionId?: string | null;
    limits: {
        maxUsers: number;
        maxMailboxes: number;
        maxStorageGb: number;
    };
    usage: {
        usersUsed: number;
        usersTotal: number;
        mailboxesUsed: number;
        mailboxesTotal: number;
        storageUsedGb: number;
        storageTotalGb: number;
    };
    subscriptionDetails: {
        planName: string;
        billingCycle: 'monthly' | 'yearly' | null;
        nextBillingDate: string | null;
        trialEndDate: string | null;
        pricePerCycle: number | null;
        currency: string | null;
        autoRenew: boolean | null;
    };
    paymentMethod: {
        id: string;
        brand: string;
        last4: string;
        expMonth: number;
        expYear: number;
    } | null;
    invoices: Array<{
        id: string;
        invoiceId: string;
        date: string;
        amount: number;
        currency: string;
        status: 'paid' | 'open' | 'draft' | 'void' | 'uncollectible' | string;
        invoicePdf: string | null;
        hostedInvoiceUrl: string | null;
    }>;
    billingInfo: {
        companyName: string | null;
        billingEmail: string | null;
        billingAddress: {
            line1: string | null;
            line2: string | null;
            city: string | null;
            state: string | null;
            postalCode: string | null;
            country: string | null;
        } | null;
        taxNumber: string | null;
    };
};

const formatPlanLabel = (value?: string | null) => {
    const normalized = String(value || 'trial').toLowerCase();
    if (normalized === 'professional' || normalized === 'pro') return 'Professional';
    if (normalized === 'starter') return 'Starter';
    if (normalized === 'enterprise') return 'Enterprise';
    return 'Trial';
};

const formatDate = (value?: string | null) => {
    if (!value) return 'N/A';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString();
};

const formatCurrency = (amount: number | null, currency: string | null) => {
    if (amount === null || amount === undefined) return 'N/A';
    const cur = (currency || 'usd').toUpperCase();
    return `${cur} ${amount.toFixed(2)}`;
};

export default function BillingManagePage() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [billing, setBilling] = useState<BillingInfoResponse | null>(null);

    const [detailsForm, setDetailsForm] = useState({
        companyName: '',
        billingEmail: '',
        line1: '',
        line2: '',
        city: '',
        state: '',
        postalCode: '',
        country: '',
        taxNumber: '',
    });

    const loadBilling = async () => {
        try {
            setLoading(true);
            const response = await api.get<BillingInfoResponse>('/billing/info');
            const payload = response.data;
            setBilling(payload);

            setDetailsForm({
                companyName: payload.billingInfo.companyName || '',
                billingEmail: payload.billingInfo.billingEmail || '',
                line1: payload.billingInfo.billingAddress?.line1 || '',
                line2: payload.billingInfo.billingAddress?.line2 || '',
                city: payload.billingInfo.billingAddress?.city || '',
                state: payload.billingInfo.billingAddress?.state || '',
                postalCode: payload.billingInfo.billingAddress?.postalCode || '',
                country: payload.billingInfo.billingAddress?.country || '',
                taxNumber: payload.billingInfo.taxNumber || '',
            });
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } }; message?: string };
            setMessage({ type: 'error', text: err.response?.data?.message || err.message || 'Failed to load billing info' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadBilling();
    }, []);

    const withSubmit = async (handler: () => Promise<void>) => {
        try {
            setSubmitting(true);
            setMessage(null);
            await handler();
            await loadBilling();
        } catch (error: unknown) {
            const err = error as { response?: { data?: { message?: string } }; message?: string };
            setMessage({ type: 'error', text: err.response?.data?.message || err.message || 'Action failed' });
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = async () => {
        await withSubmit(async () => {
            await api.post('/billing/subscription/cancel');
            setMessage({ type: 'success', text: 'Subscription will cancel at the end of the current period.' });
        });
    };

    const handleResume = async () => {
        await withSubmit(async () => {
            await api.post('/billing/subscription/resume');
            setMessage({ type: 'success', text: 'Subscription resumed successfully.' });
        });
    };

    const openPaymentMethodPortal = async () => {
        await withSubmit(async () => {
            const response = await api.post('/billing/payment-method/portal', { returnUrl: window.location.href });
            if (response.data?.url) {
                window.location.href = response.data.url;
            }
        });
    };

    const handleUpgrade = async () => {
        await withSubmit(async () => {
            navigate('/billing/plans');
        });
    };

    const handleDowngrade = async () => {
        await withSubmit(async () => {
            await api.post('/billing/subscription/change', {
                planType: 'starter',
                cycle: 'monthly',
            });
            setMessage({ type: 'success', text: 'Plan downgraded successfully.' });
        });
    };

    const saveBillingDetails = async () => {
        await withSubmit(async () => {
            await api.patch('/billing/details', {
                companyName: detailsForm.companyName || undefined,
                billingEmail: detailsForm.billingEmail || undefined,
                address: {
                    line1: detailsForm.line1 || undefined,
                    line2: detailsForm.line2 || undefined,
                    city: detailsForm.city || undefined,
                    state: detailsForm.state || undefined,
                    postalCode: detailsForm.postalCode || undefined,
                    country: detailsForm.country || undefined,
                },
                taxNumber: detailsForm.taxNumber || undefined,
            });
            setMessage({ type: 'success', text: 'Billing details updated successfully.' });
        });
    };

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <PageHeader
                title="Billing & Subscription"
                subtitle="Manage plan, payments, invoices, and billing details"
                actions={
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => navigate(-1)}
                            className="inline-flex items-center justify-center rounded-lg border border-[var(--color-card-border)] bg-white p-2 text-[var(--color-primary)] hover:bg-[var(--color-background)] transition-colors"
                            style={{ fontFamily: 'var(--font-ui)' }}
                            aria-label="Back"
                            title="Back"
                        >
                            <ArrowLeft className="w-4 h-4" />
                        </button>
                    </div>
                }
            />

            {message && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                    {message.text}
                </div>
            )}

            {loading || !billing ? (
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-6">
                    <div className="h-5 w-48 animate-pulse rounded bg-[var(--color-background)]" />
                </div>
            ) : (
                <>
                    <section className="grid grid-cols-1 gap-6 xl:grid-cols-2 items-stretch">
                        <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-h-[22rem] h-full">
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>Overview</h2>
                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Current Plan</div>
                                    <div className="mt-1 text-lg font-bold text-[var(--color-text-primary)]">{formatPlanLabel(billing.currentPlan)}</div>
                                </div>
                                <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] px-4 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Subscription Status</div>
                                    <div className="mt-1 text-lg font-bold text-[var(--color-text-primary)] capitalize">{String(billing.subscriptionStatus || 'active')}</div>
                                </div>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Max Users</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">{billing.limits.maxUsers}</div>
                                </div>
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Max Mailboxes</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">{billing.limits.maxMailboxes}</div>
                                </div>
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Max Storage</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">{billing.limits.maxStorageGb} GB</div>
                                </div>
                            </div>

                        </div>

                        <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-h-[22rem] h-full">
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>Payment Method</h2>
                            <div className="mt-4 rounded-xl border border-[var(--color-card-border)] p-4">
                                {billing.paymentMethod ? (
                                    <div className="space-y-1 text-sm">
                                        <div><span className="text-[var(--color-text-muted)]">Card Brand:</span> <span className="font-semibold uppercase">{billing.paymentMethod.brand}</span></div>
                                        <div><span className="text-[var(--color-text-muted)]">Last 4:</span> <span className="font-semibold">{billing.paymentMethod.last4}</span></div>
                                        <div><span className="text-[var(--color-text-muted)]">Expiry:</span> <span className="font-semibold">{billing.paymentMethod.expMonth}/{billing.paymentMethod.expYear}</span></div>
                                    </div>
                                ) : (
                                    <div className="text-sm text-[var(--color-text-muted)]">No payment method on file.</div>
                                )}
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                                <button disabled={submitting} onClick={() => void openPaymentMethodPortal()} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--color-background)]">Update Payment Method</button>
                                <button disabled={submitting} onClick={() => void openPaymentMethodPortal()} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--color-background)]">Add Payment Method</button>
                                <button disabled={submitting} onClick={() => void openPaymentMethodPortal()} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--color-background)]">Remove Payment Method</button>
                            </div>
                        </div>
                    </section>

                    <section className="grid grid-cols-1 gap-6 xl:grid-cols-2 items-stretch">
                        <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-h-[22rem] h-full">
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>Subscription Details</h2>
                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Plan Name</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">{formatPlanLabel(billing.subscriptionDetails.planName)}</div>
                                </div>
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Billing Cycle</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">Monthly</div>
                                </div>
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Next Billing Date</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">{formatDate(billing.subscriptionDetails.nextBillingDate)}</div>
                                </div>
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Trial End Date</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">{formatDate(billing.subscriptionDetails.trialEndDate)}</div>
                                </div>
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Price Per Cycle</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">{formatCurrency(billing.subscriptionDetails.pricePerCycle, billing.subscriptionDetails.currency)}</div>
                                </div>
                                <div className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                                    <div className="text-xs text-[var(--color-text-muted)]">Auto Renew</div>
                                    <div className="mt-1 font-semibold text-[var(--color-text-primary)]">{billing.subscriptionDetails.autoRenew === null ? 'N/A' : billing.subscriptionDetails.autoRenew ? 'ON' : 'OFF'}</div>
                                </div>
                            </div>
                            <div className="mt-4 rounded-xl border border-[var(--color-card-border)] p-4 space-y-3">
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                    <button disabled={submitting} onClick={() => void handleUpgrade()} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--color-background)]">Upgrade Plan</button>
                                    <button disabled={submitting} onClick={() => void handleDowngrade()} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--color-background)]">Downgrade Plan</button>
                                    {billing.subscriptionStatus === 'trialing' ? (
                                        <div className="rounded-lg border border-dashed border-[var(--color-card-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">Cancel Subscription unavailable during trial</div>
                                    ) : billing.subscriptionStatus === 'canceled' || billing.subscriptionDetails.autoRenew === false ? (
                                        <button disabled={submitting} onClick={() => void handleResume()} className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-100">Resume Subscription</button>
                                    ) : (
                                        <button disabled={submitting} onClick={() => void handleCancel()} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100">Cancel Subscription</button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-h-[22rem] h-full">
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>Billing Info</h2>
                            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <input value={detailsForm.companyName} onChange={(e) => setDetailsForm((prev) => ({ ...prev, companyName: e.target.value }))} placeholder="Company name" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <input value={detailsForm.billingEmail} onChange={(e) => setDetailsForm((prev) => ({ ...prev, billingEmail: e.target.value }))} placeholder="Billing email" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <input value={detailsForm.line1} onChange={(e) => setDetailsForm((prev) => ({ ...prev, line1: e.target.value }))} placeholder="Address line 1" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm sm:col-span-2" />
                                <input value={detailsForm.line2} onChange={(e) => setDetailsForm((prev) => ({ ...prev, line2: e.target.value }))} placeholder="Address line 2" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm sm:col-span-2" />
                                <input value={detailsForm.city} onChange={(e) => setDetailsForm((prev) => ({ ...prev, city: e.target.value }))} placeholder="City" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <input value={detailsForm.state} onChange={(e) => setDetailsForm((prev) => ({ ...prev, state: e.target.value }))} placeholder="State" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <input value={detailsForm.postalCode} onChange={(e) => setDetailsForm((prev) => ({ ...prev, postalCode: e.target.value }))} placeholder="Postal code" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <input value={detailsForm.country} onChange={(e) => setDetailsForm((prev) => ({ ...prev, country: e.target.value }))} placeholder="Country" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <input value={detailsForm.taxNumber} onChange={(e) => setDetailsForm((prev) => ({ ...prev, taxNumber: e.target.value }))} placeholder="Tax/VAT number" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm sm:col-span-2" />
                            </div>
                            <div className="mt-3 flex justify-end">
                                <button disabled={submitting} onClick={() => void saveBillingDetails()} className="rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-cta-secondary)]">Update Billing Details</button>
                            </div>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                        <div className="px-5 py-4 border-b border-[var(--color-card-border)] flex items-center justify-between gap-2">
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-headline)' }}>Invoices</h2>
                            <button
                                onClick={() => void loadBilling()}
                                className="inline-flex items-center justify-center rounded-lg border border-[var(--color-card-border)] p-2 hover:bg-[var(--color-background)]"
                                aria-label="Refresh invoices"
                                title="Refresh invoices"
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-card-border)] bg-[var(--color-background)]/30">
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)]">Invoice ID</th>
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)]">Date</th>
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)]">Amount</th>
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)]">Status</th>
                                        <th className="px-4 py-3 text-xs font-semibold text-[var(--color-text-muted)] text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[var(--color-card-border)]">
                                    {billing.invoices.map((invoice) => (
                                        <tr key={invoice.id} className="hover:bg-[var(--color-background)]/25">
                                            <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">{invoice.invoiceId}</td>
                                            <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">{formatDate(invoice.date)}</td>
                                            <td className="px-4 py-3 text-sm font-medium text-[var(--color-text-primary)]">{formatCurrency(invoice.amount, invoice.currency)}</td>
                                            <td className="px-4 py-3 text-sm uppercase text-[var(--color-text-muted)]">{invoice.status}</td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="inline-flex gap-2">
                                                    {invoice.invoicePdf && (
                                                        <a href={invoice.invoicePdf} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] hover:underline">
                                                            <Download className="w-3.5 h-3.5" /> PDF
                                                        </a>
                                                    )}
                                                    {invoice.hostedInvoiceUrl && (
                                                        <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-primary)] hover:underline">
                                                            <ExternalLink className="w-3.5 h-3.5" /> DETAILS
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                    {billing.invoices.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">No invoices available yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}
