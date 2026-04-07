import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Plus, Pencil, Trash2 } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import api from '../../../lib/api';
import { TablePageSkeleton } from '../../../components/skeletons/TablePageSkeleton';
import { useAuth } from '../../../context/AuthContext';
import { hasPermission } from '../../../hooks/usePermission';

type PriorityKey = 'low' | 'normal' | 'high' | 'urgent';
type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

type TargetMetrics = {
    firstResponseMinutes: string;
    nextResponseMinutes: string;
    resolutionMinutes: string;
};

type BusinessDay = {
    enabled: boolean;
    startTime: string;
    endTime: string;
};

type EscalationRule = {
    id: string;
    afterMinutes: string;
    action: 'notify' | 'reassign' | 'escalate';
    channel: 'email' | 'in_app' | 'webhook';
    targetType: 'user' | 'team';
    targetValue: string;
};

type PolicyFormState = {
    name: string;
    isActive: boolean;
    targets: Record<PriorityKey, TargetMetrics>;
    businessHours: {
        timezone: string;
        days: Record<DayKey, BusinessDay>;
        holidays: string[];
    };
    escalationRules: EscalationRule[];
};

const priorityKeys: PriorityKey[] = ['low', 'normal', 'high', 'urgent'];
const dayKeys: Array<{ key: DayKey; label: string; index: number }> = [
    { key: 'sun', label: 'Sun', index: 0 },
    { key: 'mon', label: 'Mon', index: 1 },
    { key: 'tue', label: 'Tue', index: 2 },
    { key: 'wed', label: 'Wed', index: 3 },
    { key: 'thu', label: 'Thu', index: 4 },
    { key: 'fri', label: 'Fri', index: 5 },
    { key: 'sat', label: 'Sat', index: 6 },
];

const createEscalationRule = (): EscalationRule => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    afterMinutes: '30',
    action: 'notify',
    channel: 'in_app',
    targetType: 'user',
    targetValue: '',
});

const createForm = (): PolicyFormState => ({
    name: '',
    isActive: true,
    targets: {
        low: { firstResponseMinutes: '480', nextResponseMinutes: '720', resolutionMinutes: '1440' },
        normal: { firstResponseMinutes: '240', nextResponseMinutes: '480', resolutionMinutes: '720' },
        high: { firstResponseMinutes: '60', nextResponseMinutes: '120', resolutionMinutes: '240' },
        urgent: { firstResponseMinutes: '15', nextResponseMinutes: '30', resolutionMinutes: '60' },
    },
    businessHours: {
        timezone: 'UTC',
        days: {
            sun: { enabled: false, startTime: '09:00', endTime: '17:00' },
            mon: { enabled: true, startTime: '09:00', endTime: '17:00' },
            tue: { enabled: true, startTime: '09:00', endTime: '17:00' },
            wed: { enabled: true, startTime: '09:00', endTime: '17:00' },
            thu: { enabled: true, startTime: '09:00', endTime: '17:00' },
            fri: { enabled: true, startTime: '09:00', endTime: '17:00' },
            sat: { enabled: false, startTime: '09:00', endTime: '17:00' },
        },
        holidays: [],
    },
    escalationRules: [createEscalationRule()],
});

const normalizeForm = (policy: any): PolicyFormState => {
    const rawTargets = policy.targets || {};
    const businessHours = policy.businessHours || {};
    const explicitDays = businessHours.days || {};
    const activeDays = Array.isArray(businessHours.daysOfWeek) ? businessHours.daysOfWeek : [1, 2, 3, 4, 5];

    return {
        name: policy.name || '',
        isActive: Boolean(policy.isActive),
        targets: {
            low: {
                firstResponseMinutes: String(rawTargets.low?.firstResponseMinutes || rawTargets.low?.first_response || 480),
                nextResponseMinutes: String(rawTargets.low?.nextResponseMinutes || rawTargets.low?.next_response || 720),
                resolutionMinutes: String(rawTargets.low?.resolutionMinutes || rawTargets.low?.resolution || 1440),
            },
            normal: {
                firstResponseMinutes: String(rawTargets.normal?.firstResponseMinutes || rawTargets.normal?.first_response || 240),
                nextResponseMinutes: String(rawTargets.normal?.nextResponseMinutes || rawTargets.normal?.next_response || 480),
                resolutionMinutes: String(rawTargets.normal?.resolutionMinutes || rawTargets.normal?.resolution || 720),
            },
            high: {
                firstResponseMinutes: String(rawTargets.high?.firstResponseMinutes || rawTargets.high?.first_response || 60),
                nextResponseMinutes: String(rawTargets.high?.nextResponseMinutes || rawTargets.high?.next_response || 120),
                resolutionMinutes: String(rawTargets.high?.resolutionMinutes || rawTargets.high?.resolution || 240),
            },
            urgent: {
                firstResponseMinutes: String(rawTargets.urgent?.firstResponseMinutes || rawTargets.urgent?.first_response || 15),
                nextResponseMinutes: String(rawTargets.urgent?.nextResponseMinutes || rawTargets.urgent?.next_response || 30),
                resolutionMinutes: String(rawTargets.urgent?.resolutionMinutes || rawTargets.urgent?.resolution || 60),
            },
        },
        businessHours: {
            timezone: businessHours.timezone || 'UTC',
            days: Object.fromEntries(dayKeys.map((day) => [day.key, {
                enabled: explicitDays[day.key]?.enabled ?? activeDays.includes(day.index),
                startTime: explicitDays[day.key]?.startTime || businessHours.startTime || '09:00',
                endTime: explicitDays[day.key]?.endTime || businessHours.endTime || '17:00',
            }])) as Record<DayKey, BusinessDay>,
            holidays: Array.isArray(policy.holidays) ? policy.holidays : [],
        },
        escalationRules: Array.isArray(policy.escalationRules) && policy.escalationRules.length > 0
            ? policy.escalationRules.map((rule: any) => ({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                afterMinutes: String(rule.afterMinutes || 30),
                action: rule.action || 'notify',
                channel: rule.channel || 'in_app',
                targetType: rule.targetTeamId ? 'team' : 'user',
                targetValue: String(rule.targetUserId || rule.targetTeamId || ''),
            }))
            : [createEscalationRule()],
    };
};

const SLAPage: React.FC = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const canCreate = hasPermission(user?.permissions, 'sla_policies:create');
    const canManage = hasPermission(user?.permissions, 'sla_policies:manage');
    const canDelete = hasPermission(user?.permissions, 'sla_policies:delete');

    const [policies, setPolicies] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<PolicyFormState>(createForm());
    const [formError, setFormError] = useState('');

    const loadPolicies = async () => {
        setLoading(true);
        try {
            const response = await api.get('/sla-policies');
            setPolicies(Array.isArray(response.data) ? response.data : []);
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to load SLA policies.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadPolicies();
    }, []);

    const openCreate = () => {
        setEditingId(null);
        setForm(createForm());
        setFormError('');
        setIsModalOpen(true);
    };

    const openEdit = (policy: any) => {
        setEditingId(policy.id);
        setForm(normalizeForm(policy));
        setFormError('');
        setIsModalOpen(true);
    };

    const savePolicy = async () => {
        if (!form.name.trim()) {
            setFormError('Policy name is required.');
            return;
        }

        const payload = {
            name: form.name.trim(),
            isActive: form.isActive,
            targets: Object.fromEntries(priorityKeys.map((priority) => [priority, {
                firstResponseMinutes: Number(form.targets[priority].firstResponseMinutes || 0),
                nextResponseMinutes: Number(form.targets[priority].nextResponseMinutes || 0),
                resolutionMinutes: Number(form.targets[priority].resolutionMinutes || 0),
            }])),
            businessHours: {
                timezone: form.businessHours.timezone,
                days: Object.fromEntries(dayKeys.map((day) => [day.key, {
                    enabled: form.businessHours.days[day.key].enabled,
                    startTime: form.businessHours.days[day.key].startTime,
                    endTime: form.businessHours.days[day.key].endTime,
                }])),
            },
            holidays: form.businessHours.holidays.filter(Boolean),
            escalationRules: form.escalationRules.map((rule) => ({
                afterMinutes: Number(rule.afterMinutes || 0),
                action: rule.action,
                ...(rule.action === 'reassign'
                    ? rule.targetType === 'team'
                        ? { targetTeamId: rule.targetValue || undefined }
                        : { targetUserId: rule.targetValue || undefined }
                    : { channel: rule.channel }),
            })),
        };

        try {
            if (editingId) {
                const response = await api.patch(`/sla-policies/${editingId}`, payload);
                setPolicies((prev) => prev.map((policy) => policy.id === editingId ? response.data : policy));
            } else {
                const response = await api.post('/sla-policies', payload);
                setPolicies((prev) => [response.data, ...prev]);
            }
            setIsModalOpen(false);
        } catch (err: any) {
            setFormError(err?.response?.data?.message || 'Failed to save SLA policy.');
        }
    };

    const deletePolicy = async (id: string) => {
        try {
            await api.delete(`/sla-policies/${id}`);
            setPolicies((prev) => prev.filter((policy) => policy.id !== id));
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to delete SLA policy.');
        }
    };

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                <PageHeader
                    title={t('sla_policies_title', 'SLA Policies')}
                    subtitle="Configure first response, next response, resolution targets, business hours, and escalation behavior."
                    actions={canCreate ? (
                        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                            <Plus className="w-4 h-4" /> {t('sla_new_policy', 'New Policy')}
                        </button>
                    ) : null}
                />
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <TablePageSkeleton cols={4} showHeader={false} />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <PageHeader
                title={t('sla_policies_title', 'SLA Policies')}
                subtitle="Configure first response, next response, resolution targets, business hours, and escalation behavior."
                actions={canCreate ? (
                    <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                        <Plus className="w-4 h-4" /> {t('sla_new_policy', 'New Policy')}
                    </button>
                ) : null}
            />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {!canCreate && !canManage && (
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)]/35 px-4 py-3 text-sm text-[var(--color-text-muted)]">
                    You have view-only access to SLA policies.
                </div>
            )}

            {policies.length === 0 ? (
                <EmptyState icon={AlertTriangle} title="No SLA policies configured" description="Create a policy to monitor response targets, business hours, and escalation rules." />
            ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                    {policies.map((policy) => {
                        const targets = policy.targets || {};
                        return (
                            <section key={policy.id} className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{policy.name}</h2>
                                            <StatusBadge label={policy.isActive ? 'Active' : 'Paused'} variant={policy.isActive ? 'success' : 'neutral'} />
                                        </div>
                                        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Coverage: {Number(policy.threadsCovered || policy.coverageStats?.threadsCovered || 0).toLocaleString()} threads</p>
                                        <p className="text-sm text-[var(--color-text-muted)]">Breaches: {Number(policy.breachesCount || policy.metrics?.breachesCount || 0).toLocaleString()} | Compliance: {Number((policy.complianceRate || policy.metrics?.complianceRate || 0) * (policy.complianceRate && policy.complianceRate <= 1 ? 100 : 1)).toFixed(1)}%</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {canManage && <button type="button" onClick={() => openEdit(policy)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="w-4 h-4" /></button>}
                                        {canDelete && <button type="button" onClick={() => void deletePolicy(policy.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                                    </div>
                                </div>

                                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                    {priorityKeys.map((priority) => (
                                        <div key={priority} className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/25 p-3 text-sm text-[var(--color-text-muted)]">
                                            <div className="font-semibold uppercase text-[var(--color-text-primary)]">{priority}</div>
                                            <div className="mt-2">First: {Number(targets[priority]?.firstResponseMinutes || targets[priority]?.first_response || 0)} min</div>
                                            <div>Next: {Number(targets[priority]?.nextResponseMinutes || targets[priority]?.next_response || 0)} min</div>
                                            <div>Resolution: {Number(targets[priority]?.resolutionMinutes || targets[priority]?.resolution || 0)} min</div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? 'Edit SLA Policy' : 'Create SLA Policy'} size="lg">
                <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Name</label>
                            <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <label className="flex items-center gap-2 pt-8 text-sm text-[var(--color-text-primary)]">
                            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                            Active
                        </label>
                    </div>

                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Priority Targets</h3>
                        <div className="grid gap-4 lg:grid-cols-2">
                            {priorityKeys.map((priority) => (
                                <div key={priority} className="rounded-xl border border-[var(--color-card-border)] p-4">
                                    <div className="mb-3 text-sm font-semibold uppercase text-[var(--color-text-primary)]">{priority}</div>
                                    <div className="grid gap-3 md:grid-cols-3">
                                        <div>
                                            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">First response</label>
                                            <input value={form.targets[priority].firstResponseMinutes} onChange={(event) => setForm((prev) => ({ ...prev, targets: { ...prev.targets, [priority]: { ...prev.targets[priority], firstResponseMinutes: event.target.value } } }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Next response</label>
                                            <input value={form.targets[priority].nextResponseMinutes} onChange={(event) => setForm((prev) => ({ ...prev, targets: { ...prev.targets, [priority]: { ...prev.targets[priority], nextResponseMinutes: event.target.value } } }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Resolution</label>
                                            <input value={form.targets[priority].resolutionMinutes} onChange={(event) => setForm((prev) => ({ ...prev, targets: { ...prev.targets, [priority]: { ...prev.targets[priority], resolutionMinutes: event.target.value } } }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Business Hours</h3>
                            <input value={form.businessHours.timezone} onChange={(event) => setForm((prev) => ({ ...prev, businessHours: { ...prev.businessHours, timezone: event.target.value } }))} className="w-48 rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" placeholder="Timezone" />
                        </div>
                        <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] p-4">
                            {dayKeys.map((day) => (
                                <div key={day.key} className="grid gap-3 md:grid-cols-[90px_110px_1fr_1fr] items-center">
                                    <div className="font-medium text-[var(--color-text-primary)]">{day.label}</div>
                                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                        <input type="checkbox" checked={form.businessHours.days[day.key].enabled} onChange={(event) => setForm((prev) => ({ ...prev, businessHours: { ...prev.businessHours, days: { ...prev.businessHours.days, [day.key]: { ...prev.businessHours.days[day.key], enabled: event.target.checked } } } }))} />
                                        Enabled
                                    </label>
                                    <input type="time" value={form.businessHours.days[day.key].startTime} onChange={(event) => setForm((prev) => ({ ...prev, businessHours: { ...prev.businessHours, days: { ...prev.businessHours.days, [day.key]: { ...prev.businessHours.days[day.key], startTime: event.target.value } } } }))} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                    <input type="time" value={form.businessHours.days[day.key].endTime} onChange={(event) => setForm((prev) => ({ ...prev, businessHours: { ...prev.businessHours, days: { ...prev.businessHours.days, [day.key]: { ...prev.businessHours.days[day.key], endTime: event.target.value } } } }))} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                </div>
                            ))}
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Holidays</label>
                            <textarea value={form.businessHours.holidays.join('\n')} onChange={(event) => setForm((prev) => ({ ...prev, businessHours: { ...prev.businessHours, holidays: event.target.value.split('\n').map((value) => value.trim()).filter(Boolean) } }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm min-h-24" placeholder="One ISO date per line, e.g. 2026-12-25" />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Escalation Rules</h3>
                            <button type="button" onClick={() => setForm((prev) => ({ ...prev, escalationRules: [...prev.escalationRules, createEscalationRule()] }))} className="text-sm font-medium text-[var(--color-primary)]">+ Add escalation</button>
                        </div>
                        {form.escalationRules.map((rule) => (
                            <div key={rule.id} className="grid gap-3 rounded-xl border border-[var(--color-card-border)] p-3 md:grid-cols-[160px_180px_160px_1fr_auto]">
                                <input value={rule.afterMinutes} onChange={(event) => setForm((prev) => ({ ...prev, escalationRules: prev.escalationRules.map((item) => item.id === rule.id ? { ...item, afterMinutes: event.target.value } : item) }))} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" placeholder="After minutes" />
                                <select value={rule.action} onChange={(event) => setForm((prev) => ({ ...prev, escalationRules: prev.escalationRules.map((item) => item.id === rule.id ? { ...item, action: event.target.value as EscalationRule['action'] } : item) }))} className="rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                                    <option value="notify">Notify</option>
                                    <option value="reassign">Reassign</option>
                                    <option value="escalate">Escalate</option>
                                </select>
                                {rule.action === 'reassign' ? (
                                    <>
                                        <select value={rule.targetType} onChange={(event) => setForm((prev) => ({ ...prev, escalationRules: prev.escalationRules.map((item) => item.id === rule.id ? { ...item, targetType: event.target.value as EscalationRule['targetType'] } : item) }))} className="rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                                            <option value="user">User</option>
                                            <option value="team">Team</option>
                                        </select>
                                        <input value={rule.targetValue} onChange={(event) => setForm((prev) => ({ ...prev, escalationRules: prev.escalationRules.map((item) => item.id === rule.id ? { ...item, targetValue: event.target.value } : item) }))} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" placeholder={rule.targetType === 'team' ? 'Team ID' : 'User ID'} />
                                    </>
                                ) : (
                                    <>
                                        <select value={rule.channel} onChange={(event) => setForm((prev) => ({ ...prev, escalationRules: prev.escalationRules.map((item) => item.id === rule.id ? { ...item, channel: event.target.value as EscalationRule['channel'] } : item) }))} className="rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                                            <option value="in_app">In-app</option>
                                            <option value="email">Email</option>
                                            <option value="webhook">Webhook</option>
                                        </select>
                                        <div className="rounded-lg border border-dashed border-[var(--color-card-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
                                            Explicit channel is stored in the SLA payload.
                                        </div>
                                    </>
                                )}
                                <button type="button" onClick={() => setForm((prev) => ({ ...prev, escalationRules: prev.escalationRules.length === 1 ? prev.escalationRules : prev.escalationRules.filter((item) => item.id !== rule.id) }))} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm text-red-600 hover:bg-red-50">Remove</button>
                            </div>
                        ))}
                    </div>

                    {formError && <div className="text-sm text-red-600">{formError}</div>}

                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">Cancel</button>
                        <button type="button" onClick={() => void savePolicy()} className="rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">Save</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default SLAPage;

