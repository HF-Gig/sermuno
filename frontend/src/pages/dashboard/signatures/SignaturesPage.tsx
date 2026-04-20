import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { Eye, EyeOff, FileSignature, ImagePlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import api, { resolveAvatarUrl } from '../../../lib/api';
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

type SignaturePlaceholder = {
    token: string;
    label: string;
    defaultValue?: string;
    builtIn?: boolean;
};

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

const extractSignatureTokens = (html: string) => {
    const matches = String(html || '').match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) || [];
    return Array.from(new Set(matches.map((entry) => {
        const normalized = entry.replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim().toLowerCase();
        return `{{${normalized}}}`;
    })));
};

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
    const [placeholders, setPlaceholders] = useState<SignaturePlaceholder[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
    const [deleteSubmitting, setDeleteSubmitting] = useState(false);
    const [saveSubmitting, setSaveSubmitting] = useState(false);
    const [newPlaceholderToken, setNewPlaceholderToken] = useState('');
    const [newPlaceholderDefaultValue, setNewPlaceholderDefaultValue] = useState('');
    const [placeholderAddSubmitting, setPlaceholderAddSubmitting] = useState(false);
    const [placeholderBusyToken, setPlaceholderBusyToken] = useState<string | null>(null);
    const [placeholderDeleteConfirm, setPlaceholderDeleteConfirm] = useState<{ token: string; label: string } | null>(null);
    const [placeholderDeleteSubmitting, setPlaceholderDeleteSubmitting] = useState(false);
    const [imageUploading, setImageUploading] = useState(false);
    const [form, setForm] = useState<SignatureFormState>(createForm(canManage ? 'organization' : 'personal'));
    const [formError, setFormError] = useState('');
    const quillRef = useRef<ReactQuill | null>(null);
    const imageUploadInputRef = useRef<HTMLInputElement | null>(null);

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
                const placeholdersRes = await api.get('/signatures/placeholders').catch(() => ({ data: [] }));

                setSignatures(Array.isArray(signaturesRes.data) ? signaturesRes.data : []);
                setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
                setTeams(Array.isArray(teamsRes.data) ? teamsRes.data : []);
                setMailboxes(Array.isArray(mailboxesRes.data) ? mailboxesRes.data : []);
                setPlaceholders(Array.isArray(placeholdersRes.data) ? placeholdersRes.data : []);
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

    const addPlaceholder = async () => {
        const normalized = newPlaceholderToken.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '').trim().toLowerCase();
        if (!normalized) {
            setError('Placeholder token is required.');
            return;
        }
        const token = `{{${normalized}}}`;
        setPlaceholderAddSubmitting(true);
        try {
            const response = await api.post('/signatures/placeholders', {
                token,
                label: token,
                defaultValue: newPlaceholderDefaultValue,
            });
            setPlaceholders((prev) => [...prev, response.data]);
            setNewPlaceholderToken('');
            setNewPlaceholderDefaultValue('');
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to add placeholder.');
        } finally {
            setPlaceholderAddSubmitting(false);
        }
    };

    const removePlaceholder = async (token: string) => {
        setPlaceholderDeleteSubmitting(true);
        setPlaceholderBusyToken(token);
        try {
            await api.delete(`/signatures/placeholders/${encodeURIComponent(token)}`);
            setPlaceholders((prev) => prev.filter((entry) => entry.token !== token));
            setPlaceholderDeleteConfirm(null);
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to remove placeholder.');
        } finally {
            setPlaceholderBusyToken(null);
            setPlaceholderDeleteSubmitting(false);
        }
    };

    const uploadSignatureImage = async (file?: File | null) => {
        if (!file) return;
        setImageUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const response = await api.post('/signatures/images/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const uploadedUrl = String(response.data?.url || '');
            if (!uploadedUrl) {
                throw new Error('No image URL returned');
            }
            const resolvedImageUrl = resolveAvatarUrl(uploadedUrl) || uploadedUrl;
            const editor = quillRef.current?.getEditor();
            if (editor) {
                const selection = editor.getSelection(true);
                editor.insertEmbed(selection?.index ?? editor.getLength(), 'image', resolvedImageUrl, 'user');
            } else {
                setForm((prev) => ({
                    ...prev,
                    bodyHtml: `${prev.bodyHtml}<p><img src="${resolvedImageUrl}" alt="${file.name}" /></p>`,
                }));
            }
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message || err?.message || 'Failed to upload image.');
        } finally {
            setImageUploading(false);
            if (imageUploadInputRef.current) {
                imageUploadInputRef.current.value = '';
            }
        }
    };

    const canEditSignature = (signature: SignatureRecord) => {
        if (canManage) return true;
        return signature.scope === 'personal' && signature.ownerId === user?.id && !signature.isLocked;
    };

    const canDeleteSignature = (signature: SignatureRecord) => canEditSignature(signature);

    const saveSignature = async () => {
        if (saveSubmitting) return;
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
            variables: Object.fromEntries(extractSignatureTokens(form.bodyHtml).map((token) => [token, token])),
        };

        setSaveSubmitting(true);
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
                    userId: form.scope === 'personal' ? (form.userId || user?.id || undefined) : undefined,
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
        } finally {
            setSaveSubmitting(false);
        }
    };

    const deleteSignature = async (id: string) => {
        setDeleteSubmitting(true);
        try {
            await api.delete(`/signatures/${id}`);
            setSignatures((prev) => prev.filter((entry) => entry.id !== id));
            setDeleteConfirm(null);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to delete signature.');
        } finally {
            setDeleteSubmitting(false);
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
                    {placeholders.map((placeholder) => (
                        <button key={placeholder.token} type="button" onClick={() => insertVariable(placeholder.token)} className="rounded-full border border-[var(--color-card-border)] bg-white px-3 py-1 text-xs font-mono text-[var(--color-primary)]">
                            {placeholder.token}
                        </button>
                    ))}
                </div>
                {canManage && (
                    <div className="mt-4 space-y-3 rounded-xl border border-[var(--color-card-border)] bg-white p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Custom placeholders</div>
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                            <input
                                value={newPlaceholderToken}
                                onChange={(event) => setNewPlaceholderToken(event.target.value)}
                                placeholder="company_name"
                                className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm"
                            />
                            <input
                                value={newPlaceholderDefaultValue}
                                onChange={(event) => setNewPlaceholderDefaultValue(event.target.value)}
                                placeholder="Default value"
                                className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm"
                            />
                            <button
                                type="button"
                                onClick={() => void addPlaceholder()}
                                disabled={placeholderAddSubmitting || Boolean(placeholderBusyToken)}
                                className="rounded-lg bg-[var(--color-cta-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {placeholderAddSubmitting ? 'Adding...' : 'Add'}
                            </button>
                        </div>
                        <div className="space-y-1.5">
                            {placeholders.filter((entry) => !entry.builtIn).map((entry) => (
                                <div key={entry.token} className="flex items-center justify-between rounded-lg border border-[var(--color-card-border)] px-3 py-2">
                                    <div className="min-w-0">
                                        <div className="font-mono text-xs text-[var(--color-text-primary)]">{entry.token}</div>
                                        <div className="truncate text-xs text-[var(--color-text-muted)]">Default: {entry.defaultValue || '--'}</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setPlaceholderDeleteConfirm({ token: entry.token, label: entry.token })}
                                        disabled={placeholderBusyToken === entry.token}
                                        className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        Delete
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
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
                                        {canDeleteSignature(signature) && <button type="button" onClick={() => setDeleteConfirm({ id: signature.id, name: signature.name || 'this signature' })} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
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
                            <table className="w-full table-fixed text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                        <th className="w-[19%] px-4 py-3">Signature Name</th>
                                        <th className="w-[9%] px-4 py-3">Scope</th>
                                        <th className="w-[12%] px-4 py-3">Owner</th>
                                        <th className="w-[12%] px-4 py-3">Created By User</th>
                                        <th className="w-[8%] px-4 py-3">Default Status</th>
                                        <th className="w-[8%] px-4 py-3">Locked Status</th>
                                        <th className="w-[20%] px-4 py-3">Assigned Mailbox IDs</th>
                                        <th className="w-[6%] px-4 py-3">Sort Order</th>
                                        <th className="w-[6%] px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {signatures.map((signature) => (
                                        <React.Fragment key={signature.id}>
                                            <tr className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                                <td className="px-4 py-3 font-medium text-[var(--color-text-primary)] break-words">{signature.name}</td>
                                                <td className="px-4 py-3"><StatusBadge label={signature.scope} variant={signature.scope === 'organization' ? 'info' : signature.scope === 'team' ? 'warning' : 'neutral'} /></td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)] break-words">{getOwnerLabel(signature)}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)] break-words">{getCreatedByLabel(signature)}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{signature.isDefault ? 'Default' : 'No'}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{signature.isLocked ? 'Locked' : 'Unlocked'}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)] break-words">{mailboxSummary(signature)}</td>
                                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{Number(signature.sortOrder || 0)}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button type="button" onClick={() => setPreviewId(previewId === signature.id ? null : signature.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">{previewId === signature.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                                                        {canEditSignature(signature) && <button type="button" onClick={() => openEdit(signature)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="w-4 h-4" /></button>}
                                                        {canDeleteSignature(signature) && <button type="button" onClick={() => setDeleteConfirm({ id: signature.id, name: signature.name || 'this signature' })} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
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

                    <div className="space-y-2 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/30 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Insert Placeholder</div>
                        <div className="flex flex-wrap gap-2">
                            {placeholders.map((placeholder) => (
                                <button
                                    key={`modal-${placeholder.token}`}
                                    type="button"
                                    onClick={() => insertVariable(placeholder.token)}
                                    className="rounded-full border border-[var(--color-card-border)] bg-white px-3 py-1 text-xs font-mono text-[var(--color-primary)]"
                                >
                                    {placeholder.token}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                            <label className="block text-sm font-medium text-[var(--color-text-primary)]">HTML Body</label>
                            <div className="flex items-center gap-2">
                                <input
                                    ref={imageUploadInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) {
                                            void uploadSignatureImage(file);
                                        }
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => imageUploadInputRef.current?.click()}
                                    disabled={imageUploading || saveSubmitting}
                                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {imageUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
                                    {imageUploading ? 'Uploading...' : 'Upload Image'}
                                </button>
                            </div>
                        </div>
                        <ReactQuill
                            ref={quillRef}
                            theme="snow"
                            value={form.bodyHtml}
                            onChange={(value) => setForm((prev) => ({ ...prev, bodyHtml: value }))}
                        />
                    </div>

                    {formError && <div className="text-sm text-red-600">{formError}</div>}

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button type="button" disabled={saveSubmitting} onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
                        <button type="button" disabled={saveSubmitting} onClick={() => void saveSignature()} className="rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)] disabled:cursor-not-allowed disabled:opacity-60">
                            {saveSubmitting ? 'Saving...' : 'Save Signature'}
                        </button>
                    </div>
                </div>
            </Modal>
            <ConfirmDialog
                isOpen={Boolean(deleteConfirm)}
                title="Delete Signature"
                description={deleteConfirm ? `Are you sure you want to delete "${deleteConfirm.name}"?` : ''}
                confirmLabel="Delete"
                isSubmitting={deleteSubmitting}
                onCancel={() => setDeleteConfirm(null)}
                onConfirm={() => {
                    if (deleteConfirm) {
                        void deleteSignature(deleteConfirm.id);
                    }
                }}
            />
            <ConfirmDialog
                isOpen={Boolean(placeholderDeleteConfirm)}
                title="Delete Placeholder"
                description={placeholderDeleteConfirm ? `Are you sure you want to delete "${placeholderDeleteConfirm.label}"?` : ''}
                confirmLabel="Delete"
                isSubmitting={placeholderDeleteSubmitting}
                onCancel={() => {
                    if (!placeholderDeleteSubmitting) {
                        setPlaceholderDeleteConfirm(null);
                    }
                }}
                onConfirm={() => {
                    if (placeholderDeleteConfirm) {
                        void removePlaceholder(placeholderDeleteConfirm.token);
                    }
                }}
            />
        </div>
    );
};

export default SignaturesPage;

