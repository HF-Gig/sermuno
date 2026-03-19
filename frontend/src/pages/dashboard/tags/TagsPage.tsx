import React, { useEffect, useState } from 'react';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import EmptyState from '../../../components/ui/EmptyState';
import { Tag, Plus, Pencil, Trash2, Search } from 'lucide-react';
import api from '../../../lib/api';
import { TablePageSkeleton } from '../../../components/skeletons/TablePageSkeleton';
import { useAuth } from '../../../context/AuthContext';
import { hasPermission } from '../../../hooks/usePermission';

type TagsPageProps = {
    embedded?: boolean;
};

const TagsPage: React.FC<TagsPageProps> = ({ embedded = false }) => {
    const { user } = useAuth();
    const canManageTags = hasPermission(user?.permissions, 'tags:manage');
    const canCreateTags = hasPermission(user?.permissions, 'tags:create');
    const [tags, setTags] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editId, setEditId] = useState<string | null>(null);
    const defaultScope = canManageTags ? 'organization' : 'personal';
    const [form, setForm] = useState({ name: '', color: '#3b82f6', scope: defaultScope as 'organization' | 'personal' });

    useEffect(() => {
        const fetchTags = async () => {
            setLoading(true);
            try {
                const response = await api.get('/tags');
                setTags(Array.isArray(response.data) ? response.data : []);
                setError(null);
            } catch (err: any) {
                setError(err?.userMessage || err?.response?.data?.message || 'Failed to load tags.');
            } finally {
                setLoading(false);
            }
        };

        fetchTags();
    }, []);

    const filtered = tags.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

    const handleSave = async () => {
        if (!canCreateTags) return;
        if (!form.name.trim()) return;
        try {
            if (editId) {
                const response = await api.put(`/tags/${editId}`, form);
                setTags(prev => prev.map(t => t.id === editId ? response.data : t));
            } else {
                const response = await api.post('/tags', form);
                setTags(prev => [...prev, response.data]);
            }
            setError(null);
            resetForm();
        } catch (err: any) {
            setError(err?.userMessage || err?.response?.data?.error || err?.response?.data?.message || 'Failed to save tag.');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/tags/${id}`);
            setTags(prev => prev.filter(t => t.id !== id));
            setError(null);
        } catch (err: any) {
            setError(err?.userMessage || err?.response?.data?.error || err?.response?.data?.message || 'Failed to delete tag.');
        }
    };
    const handleEdit = (tag: any) => { setForm({ name: tag.name, color: tag.color, scope: tag.scope }); setEditId(tag.id); setShowForm(true); };
    const resetForm = () => { setForm({ name: '', color: '#3b82f6', scope: defaultScope as 'organization' | 'personal' }); setEditId(null); setShowForm(false); };

    if (loading) {
        return embedded ? (
            <div className="space-y-5">
                <div className="border-b border-[var(--color-card-border)] pb-4 flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)]">Tags</h3>
                        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">Create and organize tags for your organization.</p>
                    </div>
                </div>
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <TablePageSkeleton rows={6} cols={3} showHeader={false} />
                </div>
            </div>
        ) : (
            <div className="max-w-5xl mx-auto space-y-5">
                <PageHeader title="Tags" subtitle="Organize threads by creating and managing tags."
                    actions={canCreateTags ? <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-2 bg-[var(--color-cta-primary)] hover:bg-[var(--color-cta-secondary)] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"><Plus className="w-4 h-4" /> New Tag</button> : null} />
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <TablePageSkeleton rows={6} cols={3} showHeader={false} />
                </div>
            </div>
        );
    }

    if (error && tags.length === 0) {
        if (embedded) {
            return (
                <div className="space-y-4">
                    <div className="border-b border-[var(--color-card-border)] pb-4">
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)]">Tags</h3>
                        <p className="text-sm text-[var(--color-text-muted)]">Create and organize tags for your organization.</p>
                    </div>
                    <EmptyState icon={Tag} title="No tags" description={error} />
                </div>
            );
        }
        return <div className="max-w-5xl mx-auto space-y-5"><PageHeader title="Tags" /><EmptyState icon={Tag} title="No tags" description={error} /></div>;
    }

    return (
        <div className={embedded ? 'space-y-5' : 'max-w-5xl mx-auto space-y-5'}>
            {embedded ? (
                <div className="border-b border-[var(--color-card-border)] pb-4 flex items-center justify-between gap-4">
                    <div>
                        <h3 className="text-lg font-bold text-[var(--color-text-primary)]">Tags</h3>
                        <p className="text-sm text-[var(--color-text-muted)] mt-0.5">Create and organize tags for your organization.</p>
                    </div>
                    {canCreateTags ? (
                        <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-2 bg-[var(--color-cta-primary)] hover:bg-[var(--color-cta-secondary)] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"><Plus className="w-4 h-4" /> New Tag</button>
                    ) : null}
                </div>
            ) : (
                <PageHeader title="Tags" subtitle="Organize threads by creating and managing tags."
                    actions={canCreateTags ? <button onClick={() => { resetForm(); setShowForm(true); }} className="flex items-center gap-2 bg-[var(--color-cta-primary)] hover:bg-[var(--color-cta-secondary)] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"><Plus className="w-4 h-4" /> New Tag</button> : null} />
            )}

            {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            {/* Search */}
            <div className="relative max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                <input type="text" placeholder="Search tags..." value={search} onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-[var(--color-card-border)] rounded-lg focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none" />
            </div>

            {/* Form */}
            {showForm && (
                <div className="bg-white rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] p-5">
                    <h3 className="text-sm font-bold text-[var(--color-text-primary)] mb-4">{editId ? 'Edit Tag' : 'Create Tag'}</h3>
                    <div className="flex items-end gap-4 flex-wrap">
                        <div className="flex-1 min-w-[200px]">
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Name</label>
                            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                                className="w-full px-3 py-2 text-sm border border-[var(--color-input-border)] rounded-lg focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none" placeholder="e.g. urgent" />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Color</label>
                            <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} className="w-10 h-10 rounded-lg border border-[var(--color-card-border)] cursor-pointer" />
                        </div>
                        <div className="min-w-[160px]">
                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Scope</label>
                            <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as any })}
                                className="w-full px-3 py-2 text-sm border border-[var(--color-input-border)] rounded-lg focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none">
                                {canManageTags ? <option value="organization">Organization</option> : null}
                                <option value="personal">Personal</option>
                            </select>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleSave} className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-cta-primary)] rounded-lg hover:bg-[var(--color-cta-secondary)]">Save</button>
                            <button onClick={resetForm} className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] border border-[var(--color-card-border)] rounded-lg hover:bg-[var(--color-background)]">Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Tags Table */}
            <div className="bg-white rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] overflow-hidden">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-[var(--color-card-border)]">
                            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">Tag</th>
                            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">Scope</th>
                            <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40 w-24">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--color-card-border)]">
                        {filtered.map(tag => (
                            <tr key={tag.id} className="hover:bg-[var(--color-background)]/30">
                                <td className="px-5 py-3">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                                        <span className="text-sm font-medium text-[var(--color-text-primary)]">{tag.name}</span>
                                    </div>
                                </td>
                                <td className="px-5 py-3"><StatusBadge label={tag.scope} variant={tag.scope === 'organization' ? 'primary' : 'neutral'} /></td>
                                <td className="px-5 py-3">
                                    <div className="flex items-center gap-1">
                                        {canManageTags ? <button onClick={() => handleEdit(tag)} className="p-1.5 hover:bg-[var(--color-background)] rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"><Pencil className="w-3.5 h-3.5" /></button> : null}
                                        {canManageTags ? <button onClick={() => handleDelete(tag.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-[var(--color-text-muted)] hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button> : null}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default TagsPage;
