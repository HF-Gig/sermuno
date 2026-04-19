import React, { useEffect, useState } from 'react';
import { ArrowLeft, UserRound } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import { InlineSkeleton } from '../../../components/ui/Skeleton';
import api from '../../../lib/api';

type LinkedThreadRecord = {
    id: string;
    mailboxId?: string | null;
    subject?: string | null;
    status?: string | null;
    priority?: string | null;
    createdAt?: string;
    updatedAt?: string;
    messagesInThread?: number;
    internalNotes?: number;
};

type ContactRecord = {
    id: string;
    tenantId: string;
    email: string;
    fullName?: string | null;
    additionalEmails?: string[];
    lifecycleStage?: string;
    phoneNumbers?: Array<{ type: string; value: string; primary?: boolean }>;
    addresses?: Array<{ type: string; street?: string; city?: string; state?: string; postalCode?: string; country?: string }>;
    socialProfiles?: Array<{ platform: string; url: string; username?: string }>;
    customFields?: Record<string, unknown>;
    assignedToUserId?: string | null;
    source?: string;
    emailCount?: number;
    threadCount?: number;
    lastContactedAt?: string | null;
    companyId?: string | null;
    linkedThreads?: LinkedThreadRecord[];
    linkedMessages?: Array<any>;
};

type ContactNotificationPreference = {
    contactId: string;
    notificationType: 'contact_activity';
    hasOverride: boolean;
    enabled: boolean;
    channels: {
        in_app: boolean;
        email: boolean;
        push: boolean;
        desktop: boolean;
    };
};

const ContactDetailPage: React.FC = () => {
    const navigate = useNavigate();
    const { contactId = '' } = useParams();
    const [searchParams] = useSearchParams();
    const backTab = searchParams.get('tab') === 'companies' ? 'companies' : 'contacts';

    const [loading, setLoading] = useState(true);
    const [contactDetail, setContactDetail] = useState<ContactRecord | null>(null);
    const [contactNotificationPreference, setContactNotificationPreference] = useState<ContactNotificationPreference | null>(null);
    const [contactNotificationLoading, setContactNotificationLoading] = useState(false);
    const [contactNotificationSaving, setContactNotificationSaving] = useState(false);
    const [contactNotificationError, setContactNotificationError] = useState('');

    useEffect(() => {
        if (!contactId) {
            setContactDetail(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        setContactNotificationLoading(true);
        void Promise.allSettled([
            api.get(`/contacts/${contactId}`),
            api.get(`/contacts/${contactId}/notification-preferences`),
        ])
            .then(([contactResult, preferenceResult]) => {
                if (contactResult.status === 'fulfilled') {
                    setContactDetail(contactResult.value.data);
                } else {
                    setContactDetail(null);
                }

                if (preferenceResult.status === 'fulfilled') {
                    setContactNotificationPreference(preferenceResult.value.data);
                    setContactNotificationError('');
                } else {
                    setContactNotificationPreference(null);
                    setContactNotificationError('Failed to load contact notification preference.');
                }
            })
            .finally(() => {
                setLoading(false);
                setContactNotificationLoading(false);
            });
    }, [contactId]);

    const updateContactNotificationPreference = (patch: Partial<ContactNotificationPreference>) => {
        setContactNotificationPreference((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                ...patch,
                channels: {
                    ...prev.channels,
                    ...(patch.channels || {}),
                },
            };
        });
    };

    const saveContactNotificationPreference = async () => {
        if (!contactId || !contactNotificationPreference) return;
        setContactNotificationSaving(true);
        setContactNotificationError('');
        try {
            const response = await api.patch(`/contacts/${contactId}/notification-preferences`, {
                enabled: contactNotificationPreference.enabled,
                in_app: contactNotificationPreference.channels.in_app,
                email: contactNotificationPreference.channels.email,
                push: contactNotificationPreference.channels.push,
                desktop: contactNotificationPreference.channels.desktop,
            });
            setContactNotificationPreference(response.data);
        } catch (err: any) {
            setContactNotificationError(err?.response?.data?.message || 'Failed to save contact notification preference.');
        } finally {
            setContactNotificationSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-[1280px] space-y-6">
            <PageHeader
                title="Contact Details"
                subtitle="Full profile, linked threads, and CRM metadata."
                actions={(
                    <button
                        type="button"
                        onClick={() => navigate(`/contacts?tab=${backTab}`)}
                        className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-card-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)]"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to CRM
                    </button>
                )}
            />

            <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-w-0">
                {loading ? (
                    <div className="space-y-5">
                        <InlineSkeleton className="h-7 w-32" />
                        <InlineSkeleton className="h-4 w-40" />
                        <div className="space-y-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3"><InlineSkeleton className="h-4 w-full" /></div>)}</div>
                    </div>
                ) : contactDetail ? (
                    <div className="space-y-5">
                        <div>
                            <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{contactDetail.fullName || '--'}</h2>
                            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{contactDetail.email}</p>
                        </div>

                        <DetailBlock title="Identity" rows={[
                            ['ID', contactDetail.id],
                            ['Tenant ID', contactDetail.tenantId],
                            ['Lifecycle', contactDetail.lifecycleStage || '--'],
                            ['Source', contactDetail.source || '--'],
                            ['Assigned User ID', contactDetail.assignedToUserId || '--'],
                            ['Company ID', contactDetail.companyId || '--'],
                        ]} />
                        <DetailBlock title="Emails" rows={[
                            ['Primary', contactDetail.email],
                            ...((contactDetail.additionalEmails || []).map((email, index) => [`Additional ${index + 1}`, email] as [string, string])),
                        ]} emptyLabel="No additional emails" />
                        <JsonBlock title="Phone Numbers" value={contactDetail.phoneNumbers || []} />
                        <JsonBlock title="Addresses" value={contactDetail.addresses || []} />
                        <JsonBlock title="Social Profiles" value={contactDetail.socialProfiles || []} />
                        <JsonBlock title="Custom Fields" value={contactDetail.customFields || {}} />

                        <div className="space-y-3 rounded-2xl border border-[var(--color-card-border)] p-4">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Contact Notifications</h3>
                            {contactNotificationLoading ? (
                                <InlineSkeleton className="h-4 w-full" />
                            ) : contactNotificationPreference ? (
                                <div className="space-y-3">
                                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                                        <input
                                            type="checkbox"
                                            checked={contactNotificationPreference.enabled}
                                            onChange={(event) => updateContactNotificationPreference({ enabled: event.target.checked })}
                                            className="h-4 w-4 rounded border-[var(--color-card-border)]"
                                        />
                                        Enable contact activity notifications
                                    </label>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {(['in_app', 'email', 'push', 'desktop'] as const).map((channel) => (
                                            <label key={channel} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] capitalize">
                                                <input
                                                    type="checkbox"
                                                    checked={contactNotificationPreference.channels[channel]}
                                                    onChange={(event) => updateContactNotificationPreference({ channels: { [channel]: event.target.checked } as ContactNotificationPreference['channels'] })}
                                                    className="h-4 w-4 rounded border-[var(--color-card-border)]"
                                                />
                                                {channel.replace('_', ' ')}
                                            </label>
                                        ))}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => void saveContactNotificationPreference()}
                                        disabled={contactNotificationSaving}
                                        className="rounded-lg bg-[var(--color-cta-primary)] px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {contactNotificationSaving ? 'Saving...' : 'Save Preferences'}
                                    </button>
                                </div>
                            ) : (
                                <p className="text-sm text-[var(--color-text-muted)]">No notification override found.</p>
                            )}
                            {contactNotificationError && <p className="text-xs text-red-600">{contactNotificationError}</p>}
                        </div>

                        <DetailBlock title="Activity Stats" rows={[
                            ['Email Count', String(contactDetail.emailCount || 0)],
                            ['Thread Count', String(contactDetail.threadCount || 0)],
                            ['Last Contacted', contactDetail.lastContactedAt ? new Date(contactDetail.lastContactedAt).toLocaleString() : '--'],
                        ]} />
                        <LinkedThreadsBlock title="Linked Threads" threads={contactDetail.linkedThreads || []} />
                        <JsonBlock title="Linked Messages" value={contactDetail.linkedMessages || []} />
                    </div>
                ) : (
                    <EmptyState icon={UserRound} title="Contact not found" description="The selected contact could not be loaded." />
                )}
            </section>
        </div>
    );
};

const DetailBlock: React.FC<{ title: string; rows: Array<[string, string]>; emptyLabel?: string }> = ({ title, rows, emptyLabel }) => (
    <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        {rows.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">{emptyLabel || '--'}</p> : <div className="space-y-2">{rows.map(([label, value], index) => <div key={`${title}-${label}-${index}`} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3 text-sm"><div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div><div className="mt-1 break-words text-[var(--color-text-primary)]">{value || '--'}</div></div>)}</div>}
    </div>
);

const JsonBlock: React.FC<{ title: string; value: unknown }> = ({ title, value }) => (
    <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <pre className="overflow-x-auto rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/20 p-3 text-xs text-[var(--color-text-primary)]">{JSON.stringify(value, null, 2)}</pre>
    </div>
);

const LinkedThreadsBlock: React.FC<{ title: string; threads: LinkedThreadRecord[] }> = ({ title, threads }) => (
    <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        {threads.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No linked threads</p>
        ) : (
            <div className="space-y-2">
                {threads.map((thread) => (
                    <div key={thread.id} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{thread.subject || '(No subject)'}</p>
                                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">Thread ID: {thread.id}</p>
                            </div>
                            <div className="text-right text-xs text-[var(--color-text-muted)]">
                                <div>{thread.messagesInThread ?? 0} msgs</div>
                                <div>{thread.internalNotes ?? 0} notes</div>
                            </div>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[var(--color-text-muted)]">Status: {thread.status || '--'}</span>
                            <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[var(--color-text-muted)]">Priority: {thread.priority || '--'}</span>
                            <span className="rounded-full border border-[var(--color-card-border)] px-2 py-0.5 text-[var(--color-text-muted)]">Mailbox: {thread.mailboxId || '--'}</span>
                        </div>
                        <div className="mt-2 grid gap-1 text-xs text-[var(--color-text-muted)]">
                            <div>Created: {thread.createdAt ? new Date(thread.createdAt).toLocaleString() : '--'}</div>
                            <div>Updated: {thread.updatedAt ? new Date(thread.updatedAt).toLocaleString() : '--'}</div>
                        </div>
                    </div>
                ))}
            </div>
        )}
    </div>
);

export default ContactDetailPage;
