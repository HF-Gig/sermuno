import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { Eye, EyeOff, FileSignature, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import api from '../../../lib/api';
import { TablePageSkeleton } from '../../../components/skeletons/TablePageSkeleton';
import { useAuth } from '../../../context/AuthContext';
import { hasPermission } from '../../../hooks/usePermission';

type SignatureScope = 'organization' | 'team' | 'personal';

type SignatureRecord = {
    id: string;
    name: string;
    scope: SignatureScope;
    ownerId?: string | null;
    ownerType?: string | null;
    bodyHtml?: string | null;
    contentHtml?: string | null;
    createdByUserId?: string | null;
    isDefault: boolean;
    isLocked: boolean;
    variables?: Record<string, string> | null;
    assignedMailboxIds?: string[] | null;
    sortOrder?: number;
};

type SignatureFormState = {
    name: string;
    scope: SignatureScope;
    bodyHtml: string;
    isDefault: boolean;
    isLocked: boolean;
    mailboxIds: string[];
    teamId: string;
    userId: string;
    sortOrder: number;
};

const variableTokens = ['{{user_name}}', '{{user_title}}', '{{user_phone}}'];

const createForm = (scope: SignatureScope = 'personal'): SignatureFormState => ({
    name: '',
    scope,
    bodyHtml: '',
    isDefault: false,
    isLocked: false,
    mailboxIds: [],
    teamId: '',
    userId: '',
    sortOrder: 0,
});

const SignaturesPage: React.FC = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const canCreate = hasPermission(user?.permissions, 'signatures:create');
    const canManage = hasPermission(user?.permissions, 'signatures:manage');
    const canViewUsers = hasPermission(user?.permissions, 'users:view');
    const canViewTeams = hasPermission(user?.permissions, 'teams:view');
    const canViewMailboxes = hasPermission(user?.permissions, 'mailboxes:view');

    const [signatures, setSignatures] = useState<SignatureRecord[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [teams, setTeams] = useState<any[]>([]);
    const [mailboxes, setMailboxes] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<SignatureFormState>(createForm(canManage ? 'organization' : 'personal'));
    const [formError, setFormError] = useState('');

    useEffect(() => {
        const load = async () => {
            setLoading(true);
            try {
                const [signaturesRes, usersRes, teamsRes, mailboxesRes] = await Promise.all([
                    api.get('/signatures'),
                    canViewUsers ? api.get('/users').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
                    canViewTeams ? api.get('/teams').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
                    canViewMailboxes ? api.get('/mailboxes').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
                ]);

                setSignatures(Array.isArray(signaturesRes.data) ? signaturesRes.data : []);
                setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
                setTeams(Array.isArray(teamsRes.data) ? teamsRes.data : []);
                setMailboxes(Array.isArray(mailboxesRes.data) ? mailboxesRes.data : []);
                setError(null);
            } catch (err: any) {
                setError(err?.response?.data?.message || 'Failed to load signatures.');
            } finally {
                setLoading(false);
            }
        };

        void load();
    }, [canViewMailboxes, canViewTeams, canViewUsers]);

    const userLabelMap = useMemo(() => Object.fromEntries(users.map((entry: any) => [entry.id, entry.fullName || entry.email])), [users]);
    const teamLabelMap = useMemo(() => Object.fromEntries(teams.map((entry: any) => [entry.id, entry.name])), [teams]);
    const mailboxLabelMap = useMemo(() => Object.fromEntries(mailboxes.map((entry: any) => [entry.id, entry.name || entry.email || entry.id])), [mailboxes]);

    const openCreate = () => {
        setEditingId(null);
        setForm(createForm(canManage ? 'organization' : 'personal'));
        setFormError('');
        setIsModalOpen(true);
    };

    const openEdit = (signature: SignatureRecord) => {
        setEditingId(signature.id);
        setForm({
            name: signature.name,
            scope: signature.scope,
            bodyHtml: signature.bodyHtml || signature.contentHtml || '',
            isDefault: signature.isDefault,
            isLocked: signature.isLocked,
            mailboxIds: Array.isArray(signature.assignedMailboxIds) ? signature.assignedMailboxIds : [],
            teamId: signature.scope === 'team' ? signature.ownerId || '' : '',
            userId: signature.scope === 'personal' ? signature.ownerId || '' : '',
            sortOrder: Number(signature.sortOrder || 0),
        });
        setFormError('');
        setIsModalOpen(true);
    };

    const insertVariable = (token: string) => {
        setForm((prev) => ({ ...prev, bodyHtml: `${prev.bodyHtml}${prev.bodyHtml ? ' ' : ''}${token}` }));
    };

    const canEditSignature = (signature: SignatureRecord) => {
        if (canManage) return true;
        return signature.scope === 'personal' && signature.ownerId === user?.id && !signature.isLocked;
    };

    const canDeleteSignature = (signature: SignatureRecord) => canEditSignature(signature);

    const saveSignature = async () => {
        if (!form.name.trim() || !form.bodyHtml.trim()) {
            setFormError('Name and HTML body are required.');
            return;
        }

        const payload = {
            name: form.name.trim(),
            bodyHtml: form.bodyHtml,
            scope: canManage ? form.scope : 'personal',
            isDefault: form.isDefault,
            sortOrder: Number(form.sortOrder || 0),
            variables: Object.fromEntries(variableTokens.filter((token) => form.bodyHtml.includes(token)).map((token) => [token, token])),
        };

        try {
            let savedRecord: any;
            let signatureId = editingId;

            if (editingId) {
                const response = await api.patch(`/signatures/${editingId}`, payload);
                savedRecord = response.data;
            } else {
                const response = await api.post('/signatures', payload);
                savedRecord = response.data;
                signatureId = response.data.id;
            }

            if (signatureId && canManage) {
                await api.post(`/signatures/${signatureId}/assign`, {
                    mailboxIds: form.mailboxIds,
                    teamId: form.scope === 'team' ? form.teamId || undefined : undefined,
                    userId: form.scope === 'personal' && form.userId && form.userId !== user?.id ? form.userId : undefined,
                });

                if (form.isLocked) {
                    await api.post(`/signatures/${signatureId}/lock`);
                    savedRecord.isLocked = true;
                }
            }

            const mergedRecord = {
                ...savedRecord,
                assignedMailboxIds: form.mailboxIds,
                sortOrder: payload.sortOrder,
                scope: payload.scope,
                ownerId: form.scope === 'team' ? form.teamId || null : form.scope === 'personal' ? (form.userId || user?.id || null) : null,
                ownerType: form.scope === 'team' ? 'team' : form.scope === 'personal' ? 'user' : null,
                createdByUserId: savedRecord.createdByUserId || user?.id,
            };

            if (editingId) {
                setSignatures((prev) => prev.map((entry) => entry.id === editingId ? mergedRecord : entry));
            } else {
                setSignatures((prev) => [mergedRecord, ...prev]);
            }
            setIsModalOpen(false);
        } catch (err: any) {
            setFormError(err?.response?.data?.message || 'Failed to save signature.');
        }
    };

    const deleteSignature = async (id: string) => {
        try {
            await api.delete(`/signatures/${id}`);
            setSignatures((prev) => prev.filter((entry) => entry.id !== id));
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to delete signature.');
        }
    };

    const getOwnerLabel = (signature: SignatureRecord) => {
        if (signature.scope === 'organization') return 'Organization';
        if (signature.scope === 'team') return teamLabelMap[signature.ownerId || ''] || signature.ownerId || 'Team';
        return userLabelMap[signature.ownerId || ''] || user?.fullName || signature.ownerId || 'Personal';
    };

    const getCreatedByLabel = (signature: SignatureRecord) => userLabelMap[signature.createdByUserId || ''] || signature.createdByUserId || '--';

    const mailboxSummary = (signature: SignatureRecord) => {
        const ids = Array.isArray(signature.assignedMailboxIds) ? signature.assignedMailboxIds : [];
        if (ids.length === 0) return '--';
        return ids.map((id) => mailboxLabelMap[id] || id).join(', ');
    };

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                <PageHeader
                    title={t('sidebar_signatures', 'Signatures')}
                    subtitle="Manage organization, team, and personal signatures with assignment, locking, mailbox defaults, and variables."
                    actions={canCreate ? (
                        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                            <Plus className="w-4 h-4" /> {t('signatures_new', 'New Signature')}
                        </button>
                    ) : null}
                />
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <TablePageSkeleton cols={8} showHeader={false} />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <PageHeader
                title={t('sidebar_signatures', 'Signatures')}
                subtitle="Manage organization, team, and personal signatures with assignment, locking, mailbox defaults, and variables."
                actions={canCreate ? (
                    <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                        <Plus className="w-4 h-4" /> {t('signatures_new', 'New Signature')}
                    </button>
                ) : null}
            />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)]/35 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Variables</div>
                <div className="flex flex-wrap gap-2">
                    {variableTokens.map((token) => (
                        <button key={token} type="button" onClick={() => insertVariable(token)} className="rounded-full border border-[var(--color-card-border)] bg-white px-3 py-1 text-xs font-mono text-[var(--color-primary)]">
                            {token}
                        </button>
                    ))}
                </div>
            </div>

            {signatures.length === 0 ? (
                <EmptyState icon={FileSignature} title="No signatures configured" description="Create signatures with HTML content, variables, scope, ownership, locking, default status, mailbox assignments, and sort order." />
            ) : (
                <>
                    <div className="space-y-3 xl:hidden">
                        {signatures.map((signature) => (
                            <section key={signature.id} className="rounded-2xl border border-[var(--color-card-border)] bg-white p-4 shadow-[var(--shadow-sm)]">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-base font-semibold text-[var(--color-text-primary)]">{signature.name}</div>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <StatusBadge label={signature.scope} variant={signature.scope === 'organization' ? 'info' : signature.scope === 'team' ? 'warning' : 'neutral'} />
                                            <StatusBadge label={signature.isDefault ? 'Default' : 'Not Default'} variant={signature.isDefault ? 'success' : 'neutral'} />
                                            <StatusBadge label={signature.isLocked ? 'Locked' : 'Unlocked'} variant={signature.isLocked ? 'warning' : 'neutral'} />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button type="button" onClick={() => setPreviewId(previewId === signature.id ? null : signature.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Eye className="w-4 h-4" /></button>
                                        {canEditSignature(signature) && <button type="button" onClick={() => openEdit(signature)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="w-4 h-4" /></button>}
                                        {canDeleteSignature(signature) && <button type="button" onClick={() => void deleteSignature(signature.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                                    </div>
                                </div>
                                <div className="mt-3 grid gap-1.5 text-xs text-[var(--color-text-muted)]">
                                    <div><span className="font-semibold text-[var(--color-text-primary)]">Owner:</span> {getOwnerLabel(signature)}</div>
                                    <div><span className="font-semibold text-[var(--color-text-primary)]">Created By:</span> {getCreatedByLabel(signature)}</div>
                                    <div><span className="font-semibold text-[var(--color-text-primary)]">Assigned Mailboxes:</span> {mailboxSummary(signature)}</div>
                                    <div><span className="font-semibold text-[var(--color-text-primary)]">Sort Order:</span> {Number(signature.sortOrder || 0)}</div>
                                </div>
                                {previewId === signature.id && (
                                    <div className="mt-4 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/20 p-4" dangerouslySetInnerHTML={{ __html: signature.bodyHtml || signature.contentHtml || '' }} />
                                )}
                            </section>
                        ))}
                    </div>

                    <div className="hidden xl:block rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1280px] text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                        <th className="px-4 py-3">Signature Name</th>
                                        <th className="px-4 py-3">Scope</th>
                                        <th className="px-4 py-3">Owner</th>
                                        <th className="px-4 py-3">Created By User</th>
                                        <th className="px-4 py-3">Default Status</th>
                                        <th className="px-4 py-3">Locked Status</th>
                                        <th className="px-4 py-3">Assigned Mailbox IDs</th>
                                        <th className="px-4 py-3">Sort Order</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {signatures.map((signature) => (
                                        <React.Fragment key={signature.id}>
                                            <tr className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                                <td className="px-4 py-3 font-medium text-[var(--color-text-primary)]">{signature.name}</td>
                                                <td className="px-4 py-3"><StatusBadge label={signature.scope} variant={signature.scope === 'organization' ? 'info' : signature.scope === 'team' ? 'warning' : 'neutral'} /></td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{getOwnerLabel(signature)}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{getCreatedByLabel(signature)}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{signature.isDefault ? 'Default' : 'No'}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{signature.isLocked ? 'Locked' : 'Unlocked'}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)] max-w-[260px] break-words">{mailboxSummary(signature)}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{Number(signature.sortOrder || 0)}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button type="button" onClick={() => setPreviewId(previewId === signature.id ? null : signature.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">{previewId === signature.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                                                        {canEditSignature(signature) && <button type="button" onClick={() => openEdit(signature)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="w-4 h-4" /></button>}
                                                        {canDeleteSignature(signature) && <button type="button" onClick={() => void deleteSignature(signature.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                                                    </div>
                                                </td>
                                            </tr>
                                            {previewId === signature.id && (
                                                <tr className="border-b border-[var(--color-card-border)]/70 bg-[var(--color-background)]/20">
                                                    <td colSpan={9} className="px-4 py-4">
                                                        <div className="rounded-xl border border-[var(--color-card-border)] bg-white p-4" dangerouslySetInnerHTML={{ __html: signature.bodyHtml || signature.contentHtml || '' }} />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? 'Edit Signature' : 'Create Signature'} size="lg">
                <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Signature Name</label>
                            <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Scope</label>
                            <select value={canManage ? form.scope : 'personal'} onChange={(event) => setForm((prev) => ({ ...prev, scope: event.target.value as SignatureScope, teamId: '', userId: event.target.value === 'personal' ? user?.id || '' : '' }))} disabled={!canManage} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm disabled:bg-[var(--color-background)]/40">
                                {canManage && <option value="organization">organization</option>}
                                {canManage && <option value="team">team</option>}
                                <option value="personal">personal</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Sort Order</label>
                            <input type="number" value={form.sortOrder} onChange={(event) => setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value || 0) }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                    </div>

                    {canManage && (
                        <div className="grid gap-4 md:grid-cols-2">
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Assign to Team</label>
                                <select value={form.teamId} onChange={(event) => setForm((prev) => ({ ...prev, teamId: event.target.value }))} disabled={form.scope !== 'team'} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm disabled:bg-[var(--color-background)]/40">
                                    <option value="">No team selected</option>
                                    {teams.map((team: any) => <option key={team.id} value={team.id}>{team.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Assign to User</label>
                                <select value={form.userId} onChange={(event) => setForm((prev) => ({ ...prev, userId: event.target.value, scope: 'personal' }))} disabled={form.scope !== 'personal' || !canManage} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm disabled:bg-[var(--color-background)]/40">
                                    <option value="">Use current owner</option>
                                    {users.map((entry: any) => <option key={entry.id} value={entry.id}>{entry.fullName || entry.email}</option>)}
                                </select>
                            </div>
                        </div>
                    )}

                    {canManage && (
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Assigned Mailbox IDs</label>
                            <div className="grid gap-2 rounded-xl border border-[var(--color-card-border)] p-3 md:grid-cols-2">
                                {mailboxes.map((mailbox: any) => (
                                    <label key={mailbox.id} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                                        <input type="checkbox" checked={form.mailboxIds.includes(mailbox.id)} onChange={(event) => setForm((prev) => ({ ...prev, mailboxIds: event.target.checked ? [...prev.mailboxIds, mailbox.id] : prev.mailboxIds.filter((id) => id !== mailbox.id) }))} />
                                        <span>{mailbox.name || mailbox.email || mailbox.id}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                            <input type="checkbox" checked={form.isDefault} onChange={(event) => setForm((prev) => ({ ...prev, isDefault: event.target.checked }))} />
                            Default status
                        </label>
                        {canManage && (
                            <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                                <input type="checkbox" checked={form.isLocked} onChange={(event) => setForm((prev) => ({ ...prev, isLocked: event.target.checked }))} />
                                Locked status
                            </label>
                        )}
                    </div>

                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">HTML Body</label>
                        <ReactQuill theme="snow" value={form.bodyHtml} onChange={(value) => setForm((prev) => ({ ...prev, bodyHtml: value }))} />
                    </div>

                    {formError && <div className="text-sm text-red-600">{formError}</div>}

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">Cancel</button>
                        <button type="button" onClick={() => void saveSignature()} className="rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">Save Signature</button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default SignaturesPage;

