import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Pencil, Webhook } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import api from '../../../lib/api';
import { TablePageSkeleton } from '../../../components/skeletons/TablePageSkeleton';

type HeaderRow = { id: string; key: string; value: string };
type WebhookCategory = 'thread events' | 'message events' | 'sla events' | 'rule events' | 'calendar events';

type WebhookFormState = {
    url: string;
    isActive: boolean;
    categories: WebhookCategory[];
    secret: string;
    headers: HeaderRow[];
};

const eventCategoryMap: Record<WebhookCategory, string[]> = {
    'thread events': ['thread.created', 'thread.assigned', 'thread.updated', 'thread.closed'],
    'message events': ['message.received', 'message.sent', 'message.updated'],
    'sla events': ['sla.warning', 'sla.breach'],
    'rule events': ['rule.triggered'],
    'calendar events': [
        'calendar.event_created',
        'calendar.event_updated',
        'calendar.event_cancelled',
        'calendar.rsvp_received',
        'calendar_event.created',
        'calendar_event.updated',
        'calendar_event.deleted',
    ],
};

const createHeader = (): HeaderRow => ({ id: `${Date.now()}-${Math.random()}`, key: '', value: '' });
const createForm = (): WebhookFormState => ({ url: '', isActive: true, categories: ['thread events'], secret: '', headers: [] });

const deriveCategories = (events: string[]): WebhookCategory[] => {
    return (Object.keys(eventCategoryMap) as WebhookCategory[]).filter((category) => eventCategoryMap[category].some((event) => events.includes(event)));
};

const deriveStatus = (webhook: any): 'active' | 'paused' | 'failed' => {
    if (!webhook.isActive && Number(webhook.consecutiveFailures || 0) > 0) return 'failed';
    if (!webhook.isActive) return 'paused';
    return 'active';
};

const WebhooksPage: React.FC = () => {
    const { t } = useTranslation();
    const [webhooks, setWebhooks] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; label: string } | null>(null);
    const [deleteSubmitting, setDeleteSubmitting] = useState(false);
    const [form, setForm] = useState<WebhookFormState>(createForm());
    const [formError, setFormError] = useState('');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const response = await api.get('/webhooks');
                setWebhooks(Array.isArray(response.data) ? response.data : []);
                setError(null);
            } catch (err: any) {
                setError(err?.response?.data?.message || 'Failed to load webhooks.');
            } finally {
                setLoading(false);
            }
        };

        void load();
    }, []);

    const rows = useMemo(() => webhooks.map((webhook) => ({
        ...webhook,
        status: deriveStatus(webhook),
        categories: deriveCategories(Array.isArray(webhook.events) ? webhook.events : []),
    })), [webhooks]);

    const openCreate = () => {
        setEditingId(null);
        setForm(createForm());
        setFormError('');
        setIsModalOpen(true);
    };

    const openEdit = (webhook: any) => {
        setEditingId(webhook.id);
        setForm({
            url: webhook.url || '',
            isActive: Boolean(webhook.isActive),
            categories: deriveCategories(Array.isArray(webhook.events) ? webhook.events : []),
            secret: webhook.secret || '',
            headers: Object.entries(webhook.headers || {}).map(([key, value]) => ({ id: `${Date.now()}-${Math.random()}`, key, value: String(value) })),
        });
        setFormError('');
        setIsModalOpen(true);
    };

    const saveWebhook = async () => {
        if (!form.url.trim()) {
            setFormError('Webhook URL is required.');
            return;
        }
        if (form.categories.length === 0) {
            setFormError('Select at least one event category.');
            return;
        }

        const payload = {
            url: form.url.trim(),
            isActive: form.isActive,
            secret: form.secret.trim() || undefined,
            events: Array.from(new Set(form.categories.flatMap((category) => eventCategoryMap[category]))),
            headers: Object.fromEntries(form.headers.filter((header) => header.key.trim()).map((header) => [header.key.trim(), header.value])),
        };

        try {
            if (editingId) {
                const response = await api.patch(`/webhooks/${editingId}`, payload);
                setWebhooks((prev) => prev.map((entry) => entry.id === editingId ? response.data : entry));
            } else {
                const response = await api.post('/webhooks', payload);
                setWebhooks((prev) => [response.data, ...prev]);
            }
            setIsModalOpen(false);
        } catch (err: any) {
            setFormError(err?.response?.data?.message || 'Failed to save webhook.');
        }
    };

    const deleteWebhook = async (id: string) => {
        setDeleteSubmitting(true);
        try {
            await api.delete(`/webhooks/${id}`);
            setWebhooks((prev) => prev.filter((entry) => entry.id !== id));
            setDeleteConfirm(null);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to delete webhook.');
        } finally {
            setDeleteSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                <PageHeader
                    title={t('sidebar_webhooks', 'Webhooks')}
                    subtitle="Send HMAC-signed thread, message, SLA, rule, and calendar events with three retries and automatic failure shutdown."
                    actions={(
                        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                            <Plus className="w-4 h-4" /> {t('webhooks_add', 'Add Webhook')}
                        </button>
                    )}
                />
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <TablePageSkeleton cols={5} showHeader={false} />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <PageHeader
                title={t('sidebar_webhooks', 'Webhooks')}
                subtitle="Send HMAC-signed thread, message, SLA, rule, and calendar events with three retries and automatic failure shutdown."
                actions={(
                    <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                        <Plus className="w-4 h-4" /> {t('webhooks_add', 'Add Webhook')}
                    </button>
                )}
            />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)]/35 px-4 py-3 text-sm text-[var(--color-text-muted)]">
                Retry logic is limited to 3 attempts. Repeated failures auto-disable the webhook.
            </div>

            {rows.length === 0 ? (
                <EmptyState icon={Webhook} title="No webhooks configured" description="Create a webhook to subscribe to thread, message, SLA, rule, and calendar events." />
            ) : (
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <table className="w-full min-w-[980px] text-left">
                        <thead>
                            <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                <th className="px-4 py-3">URL</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Events Subscribed</th>
                                <th className="px-4 py-3">Last Triggered</th>
                                <th className="px-4 py-3">Failure Count</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.id} className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                    <td className="px-4 py-3 font-mono text-[var(--color-text-primary)]">{row.url}</td>
                                    <td className="px-4 py-3"><StatusBadge label={row.status} variant={row.status === 'active' ? 'success' : row.status === 'failed' ? 'error' : 'neutral'} /></td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {row.categories.map((category: WebhookCategory) => (
                                                <span key={`${row.id}-${category}`} className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 py-0.5 text-xs text-[var(--color-text-primary)]">{category}</span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{row.lastTriggeredAt ? new Date(row.lastTriggeredAt).toLocaleString() : '--'}</td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{Number(row.consecutiveFailures || 0).toLocaleString()}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                            <button type="button" onClick={() => openEdit(row)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="w-4 h-4" /></button>
                                            <button type="button" onClick={() => setDeleteConfirm({ id: row.id, label: row.url || 'this webhook' })} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? 'Edit Webhook' : 'Create Webhook'} size="lg">
                <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">URL</label>
                            <input value={form.url} onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" placeholder="https://hooks.example.com/sermuno" />
                        </div>
                        <label className="flex items-center gap-2 pt-8 text-sm text-[var(--color-text-primary)]">
                            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                            Active
                        </label>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Secret Key (HMAC)</label>
                            <input value={form.secret} onChange={(event) => setForm((prev) => ({ ...prev, secret: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-mono" placeholder="Optional custom secret" />
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-medium text-[var(--color-text-primary)]">Events</label>
                        <div className="grid gap-2 rounded-xl border border-[var(--color-card-border)] p-3 md:grid-cols-2">
                            {(Object.keys(eventCategoryMap) as WebhookCategory[]).map((category) => (
                                <label key={category} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                                    <input type="checkbox" checked={form.categories.includes(category)} onChange={(event) => setForm((prev) => ({ ...prev, categories: event.target.checked ? [...prev.categories, category] : prev.categories.filter((item) => item !== category) }))} />
                                    <span>{category}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Custom Headers</h3>
                            <button type="button" onClick={() => setForm((prev) => ({ ...prev, headers: [...prev.headers, createHeader()] }))} className="text-sm font-medium text-[var(--color-primary)]">+ Add header</button>
                        </div>
                        {form.headers.map((header) => (
                            <div key={header.id} className="grid gap-3 rounded-xl border border-[var(--color-card-border)] p-3 md:grid-cols-[1fr_1fr_auto]">
                                <input value={header.key} onChange={(event) => setForm((prev) => ({ ...prev, headers: prev.headers.map((item) => item.id === header.id ? { ...item, key: event.target.value } : item) }))} placeholder="Header name" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <input value={header.value} onChange={(event) => setForm((prev) => ({ ...prev, headers: prev.headers.map((item) => item.id === header.id ? { ...item, value: event.target.value } : item) }))} placeholder="Header value" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <button type="button" onClick={() => setForm((prev) => ({ ...prev, headers: prev.headers.filter((item) => item.id !== header.id) }))} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm text-red-600 hover:bg-red-50">Remove</button>
                            </div>
                        ))}
                    </div>

                    {formError && <div className="text-sm text-red-600">{formError}</div>}

                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">Cancel</button>
                        <button type="button" onClick={() => void saveWebhook()} className="rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">Save</button>
                    </div>
                </div>
            </Modal>
            <ConfirmDialog
                isOpen={Boolean(deleteConfirm)}
                title="Delete Webhook"
                description={deleteConfirm ? `Are you sure you want to delete webhook "${deleteConfirm.label}"?` : ''}
                confirmLabel="Delete"
                isSubmitting={deleteSubmitting}
                onCancel={() => setDeleteConfirm(null)}
                onConfirm={() => {
                    if (deleteConfirm) {
                        void deleteWebhook(deleteConfirm.id);
                    }
                }}
            />
        </div>
    );
};

export default WebhooksPage;

