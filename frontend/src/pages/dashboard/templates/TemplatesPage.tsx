import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { Eye, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import StatusBadge from '../../../components/ui/StatusBadge';
import Modal from '../../../components/ui/Modal';
import api from '../../../lib/api';
import { TablePageSkeleton } from '../../../components/skeletons/TablePageSkeleton';
import { useAuth } from '../../../context/AuthContext';
import { hasPermission } from '../../../hooks/usePermission';

type TemplateScope = 'organization' | 'team' | 'personal';

type VariableDefinition = {
    id: string;
    name: string;
    defaultValue: string;
};

type TemplateFormState = {
    name: string;
    subject: string;
    bodyHtml: string;
    scope: TemplateScope;
    category: string;
    variables: VariableDefinition[];
};

const createVariable = (): VariableDefinition => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    defaultValue: '',
});

const createForm = (scope: TemplateScope): TemplateFormState => ({
    name: '',
    subject: '',
    bodyHtml: '',
    scope,
    category: '',
    variables: [createVariable()],
});

const renderPreviewTemplate = (template: string, variables: Record<string, string>) => {
    return String(template || '').replace(/{{\s*([^}\s]+)\s*}}/g, (_match, variableName: string) => {
        const normalizedName = String(variableName || '').trim();
        return variables[normalizedName] ?? `[${normalizedName}]`;
    });
};

const TemplatesPage: React.FC = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const canCreate = hasPermission(user?.permissions, 'templates:create');
    const canManage = hasPermission(user?.permissions, 'templates:manage');
    const canDelete = hasPermission(user?.permissions, 'templates:delete');

    const [templates, setTemplates] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<TemplateFormState>(createForm(canManage ? 'organization' : 'personal'));
    const [preview, setPreview] = useState<{ subject?: string | null; bodyHtml?: string | null } | null>(null);
    const [formError, setFormError] = useState('');

    useEffect(() => {
        const loadTemplates = async () => {
            setLoading(true);
            try {
                const response = await api.get('/templates');
                setTemplates(Array.isArray(response.data) ? response.data : []);
                setError(null);
            } catch (err: any) {
                setError(err?.response?.data?.message || 'Failed to load templates.');
            } finally {
                setLoading(false);
            }
        };

        void loadTemplates();
    }, []);

    const openCreate = () => {
        setEditingId(null);
        setForm(createForm(canManage ? 'organization' : 'personal'));
        setPreview(null);
        setFormError('');
        setIsModalOpen(true);
    };

    const openEdit = (template: any) => {
        setEditingId(template.id);
        setForm({
            name: template.name || '',
            subject: template.subject || '',
            bodyHtml: template.bodyHtml || '',
            scope: template.scope || 'personal',
            category: template.category || '',
            variables: Array.isArray(template.variables) && template.variables.length > 0
                ? template.variables.map((variable: any) => ({ id: `${Date.now()}-${Math.random()}`, name: variable.name || '', defaultValue: variable.defaultValue || '' }))
                : [createVariable()],
        });
        setPreview(null);
        setFormError('');
        setIsModalOpen(true);
    };

    const saveTemplate = async () => {
        if (!form.name.trim() || !form.bodyHtml.trim()) {
            setFormError('Name, subject, and body are required.');
            return;
        }

        const payload = {
            name: form.name.trim(),
            subject: form.subject.trim(),
            bodyHtml: form.bodyHtml,
            scope: canManage ? form.scope : 'personal',
            category: form.category.trim() || null,
            variables: form.variables.filter((variable) => variable.name.trim()).map((variable) => ({ name: variable.name.trim(), defaultValue: variable.defaultValue.trim() })),
        };

        try {
            if (editingId) {
                const response = await api.patch(`/templates/${editingId}`, payload);
                setTemplates((prev) => prev.map((entry) => entry.id === editingId ? response.data : entry));
            } else {
                const response = await api.post('/templates', payload);
                setTemplates((prev) => [response.data, ...prev]);
            }
            setIsModalOpen(false);
        } catch (err: any) {
            setFormError(err?.response?.data?.message || 'Failed to save template.');
        }
    };

    const deleteTemplate = async (id: string) => {
        try {
            await api.delete(`/templates/${id}`);
            setTemplates((prev) => prev.filter((entry) => entry.id !== id));
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to delete template.');
        }
    };

    const renderPreview = async () => {
        const variables = Object.fromEntries(
            form.variables
                .filter((variable) => variable.name.trim())
                .map((variable) => [variable.name.trim(), variable.defaultValue || `[${variable.name}]`])
        );

        try {
            if (editingId) {
                const response = await api.post(`/templates/${editingId}/render`, {
                    variables,
                });
                setPreview(response.data);
                return;
            }

            setPreview({
                subject: renderPreviewTemplate(form.subject, variables),
                bodyHtml: renderPreviewTemplate(form.bodyHtml, variables),
            });
        } catch (err: any) {
            setFormError(err?.response?.data?.message || 'Failed to render template preview.');
        }
    };

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                <PageHeader
                    title={t('sidebar_templates', 'Templates')}
                    subtitle="Create reusable subject and body templates for compose, calendar invitations, and scheduled messages."
                    actions={canCreate ? (
                        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                            <Plus className="w-4 h-4" /> {t('templates_new', 'New Template')}
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
                title={t('sidebar_templates', 'Templates')}
                subtitle="Create reusable subject and body templates for compose, calendar invitations, and scheduled messages."
                actions={canCreate ? (
                    <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                        <Plus className="w-4 h-4" /> {t('templates_new', 'New Template')}
                    </button>
                ) : null}
            />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {templates.length === 0 ? (
                <EmptyState icon={LayoutTemplate} title="No templates configured" description="Create templates with variable placeholders and use the render endpoint to preview final content." />
            ) : (
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <table className="w-full min-w-[860px] text-left">
                        <thead>
                            <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Scope</th>
                                <th className="px-4 py-3">Category</th>
                                <th className="px-4 py-3">Times Used</th>
                                <th className="px-4 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {templates.map((template) => (
                                <tr key={template.id} className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-[var(--color-text-primary)]">{template.name}</div>
                                        <div className="mt-1 text-xs text-[var(--color-text-muted)]">{template.subject || 'No subject set'}</div>
                                    </td>
                                    <td className="px-4 py-3"><StatusBadge label={template.scope} variant={template.scope === 'organization' ? 'info' : template.scope === 'team' ? 'warning' : 'neutral'} /></td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{template.category || '--'}</td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{Number(template.timesUsed || 0).toLocaleString()}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-1">
                                            <button type="button" onClick={() => openEdit(template)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="w-4 h-4" /></button>
                                            {canDelete && <button type="button" onClick={() => void deleteTemplate(template.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingId ? 'Edit Template' : 'Create Template'} size="lg">
                <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Name</label>
                            <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Scope</label>
                            <select value={canManage ? form.scope : 'personal'} onChange={(event) => setForm((prev) => ({ ...prev, scope: event.target.value as TemplateScope }))} disabled={!canManage} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm disabled:bg-[var(--color-background)]/40">
                                {canManage && <option value="organization">Organization</option>}
                                {canManage && <option value="team">Team</option>}
                                <option value="personal">Personal</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Category</label>
                            <input value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Subject</label>
                            <input value={form.subject} onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                    </div>

                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Body</label>
                        <ReactQuill theme="snow" value={form.bodyHtml} onChange={(value) => setForm((prev) => ({ ...prev, bodyHtml: value }))} />
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Variables</h3>
                            <button type="button" onClick={() => setForm((prev) => ({ ...prev, variables: [...prev.variables, createVariable()] }))} className="text-sm font-medium text-[var(--color-primary)]">+ Add variable</button>
                        </div>
                        {form.variables.map((variable) => (
                            <div key={variable.id} className="grid gap-3 rounded-xl border border-[var(--color-card-border)] p-3 md:grid-cols-[1fr_1fr_auto]">
                                <input value={variable.name} onChange={(event) => setForm((prev) => ({ ...prev, variables: prev.variables.map((item) => item.id === variable.id ? { ...item, name: event.target.value } : item) }))} placeholder="{{variable_name}}" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <input value={variable.defaultValue} onChange={(event) => setForm((prev) => ({ ...prev, variables: prev.variables.map((item) => item.id === variable.id ? { ...item, defaultValue: event.target.value } : item) }))} placeholder="Default preview value" className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                <button type="button" onClick={() => setForm((prev) => ({ ...prev, variables: prev.variables.length === 1 ? prev.variables : prev.variables.filter((item) => item.id !== variable.id) }))} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm text-red-600 hover:bg-red-50">Remove</button>
                            </div>
                        ))}
                    </div>

                    {preview && (
                        <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)]/25 p-4">
                            <div className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Rendered Preview</div>
                            <div className="text-sm text-[var(--color-text-muted)]">{preview.subject || '--'}</div>
                            <div className="mt-3 rounded-xl border border-[var(--color-card-border)] bg-white p-4" dangerouslySetInnerHTML={{ __html: preview.bodyHtml || '' }} />
                        </div>
                    )}

                    {formError && <div className="text-sm text-red-600">{formError}</div>}

                    <div className="flex justify-between gap-2">
                        <button type="button" onClick={() => void renderPreview()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-card-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
                            <Eye className="w-4 h-4" /> Render Preview
                        </button>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">Cancel</button>
                            <button type="button" onClick={() => void saveTemplate()} className="rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">Save</button>
                        </div>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default TemplatesPage;

