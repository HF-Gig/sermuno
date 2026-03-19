import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileDown, Upload } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import api from '../../../lib/api';
import { TablePageSkeleton } from '../../../components/skeletons/TablePageSkeleton';

type ExportType = 'gdpr_export' | 'messages_export' | 'threads_export' | 'contacts_export' | 'analytics_export';
type ExportFormat = 'json' | 'csv' | 'mbox' | 'eml';

const exportTypes: Array<{ value: ExportType; label: string }> = [
    { value: 'gdpr_export', label: 'GDPR Export' },
    { value: 'messages_export', label: 'Messages' },
    { value: 'threads_export', label: 'Threads' },
    { value: 'contacts_export', label: 'Contacts' },
    { value: 'analytics_export', label: 'Analytics' },
];

const exportFormats: Array<{ value: ExportFormat; label: string }> = [
    { value: 'json', label: 'JSON' },
    { value: 'csv', label: 'CSV' },
    { value: 'mbox', label: 'MBOX' },
    { value: 'eml', label: 'EML' },
];

const ExportPage: React.FC = () => {
    const { t } = useTranslation();
    const [jobs, setJobs] = useState<any[]>([]);
    const [imports, setImports] = useState<any[]>([]);
    const [mailboxes, setMailboxes] = useState<any[]>([]);
    const [contacts, setContacts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [importSubmitting, setImportSubmitting] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        type: 'gdpr_export' as ExportType,
        format: 'json' as ExportFormat,
        mailboxId: '',
        contactId: '',
        from: '',
        to: '',
        includeAttachments: true,
    });

    const load = async () => {
        setLoading(true);
        try {
            const [jobsRes, importsRes, mailboxesRes, contactsRes] = await Promise.all([
                api.get('/export-import/export'),
                api.get('/export-import/import'),
                api.get('/mailboxes'),
                api.get('/contacts'),
            ]);
            setJobs(Array.isArray(jobsRes.data) ? jobsRes.data : []);
            setImports(Array.isArray(importsRes.data) ? importsRes.data : []);
            setMailboxes(Array.isArray(mailboxesRes.data) ? mailboxesRes.data : []);
            setContacts(Array.isArray(contactsRes.data?.items) ? contactsRes.data.items : Array.isArray(contactsRes.data) ? contactsRes.data : []);
            setError('');
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to load export data.');
        } finally {
            setLoading(false);
        }
    };

    const createImport = async () => {
        if (!importFile) {
            setError('Select a file to import.');
            return;
        }

        setImportSubmitting(true);
        setError('');
        try {
            const formData = new FormData();
            formData.append('file', importFile);
            await api.post('/export-import/import', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
            });
            setImportFile(null);
            await load();
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to create import.');
        } finally {
            setImportSubmitting(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const createExport = async () => {
        setSubmitting(true);
        setError('');
        try {
            const typeToResource: Record<ExportType, string[]> = {
                gdpr_export: ['threads', 'messages', 'contacts'],
                messages_export: ['messages'],
                threads_export: ['threads'],
                contacts_export: ['contacts'],
                analytics_export: ['analytics'],
            };

            await api.post('/export-import/export', {
                type: form.type,
                format: form.format,
                resources: typeToResource[form.type],
                mailboxIds: form.mailboxId ? [form.mailboxId] : [],
                from: form.from || undefined,
                to: form.to || undefined,
                contactId: form.contactId || undefined,
                includeAttachments: form.includeAttachments,
            });
            await load();
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to create export.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                <PageHeader title={t('sidebar_export', 'Export & Import')} subtitle="Create organization-scoped exports for GDPR, threads, messages, contacts, and analytics with expiration-aware downloads." />
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <TablePageSkeleton rows={5} cols={5} showHeader={false} />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <PageHeader title={t('sidebar_export', 'Export & Import')} subtitle="Create organization-scoped exports for GDPR, threads, messages, contacts, and analytics with expiration-aware downloads." />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] space-y-5">
                <div className="flex items-center gap-2">
                    <Download className="w-5 h-5 text-[var(--color-primary)]" />
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Create Export</h2>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Export Type</label>
                        <select value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as ExportType }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                            {exportTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Format</label>
                        <select value={form.format} onChange={(event) => setForm((prev) => ({ ...prev, format: event.target.value as ExportFormat }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                            {exportFormats.map((format) => <option key={format.value} value={format.value}>{format.label}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Mailbox Filter</label>
                        <select value={form.mailboxId} onChange={(event) => setForm((prev) => ({ ...prev, mailboxId: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                            <option value="">All mailboxes</option>
                            {mailboxes.map((mailbox: any) => <option key={mailbox.id} value={mailbox.id}>{mailbox.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Contact Filter</label>
                        <select value={form.contactId} onChange={(event) => setForm((prev) => ({ ...prev, contactId: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                            <option value="">All contacts</option>
                            {contacts.map((contact: any) => <option key={contact.id} value={contact.id}>{contact.fullName || contact.email}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">From Date</label>
                        <input type="date" value={form.from} onChange={(event) => setForm((prev) => ({ ...prev, from: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">To Date</label>
                        <input type="date" value={form.to} onChange={(event) => setForm((prev) => ({ ...prev, to: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                    </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                    <input type="checkbox" checked={form.includeAttachments} onChange={(event) => setForm((prev) => ({ ...prev, includeAttachments: event.target.checked }))} />
                    Include attachments
                </label>

                <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/25 px-4 py-3 text-sm text-[var(--color-text-muted)]">
                    Downloads are limited and exports expire automatically when the expiration window ends.
                </div>

                <div className="flex justify-end">
                    <button type="button" onClick={() => void createExport()} disabled={submitting} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)] disabled:opacity-60">
                        <FileDown className="w-4 h-4" />
                        {submitting ? 'Creating...' : 'Create Export'}
                    </button>
                </div>
            </section>

            <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] space-y-5">
                <div className="flex items-center gap-2">
                    <Upload className="w-5 h-5 text-[var(--color-primary)]" />
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Create Import</h2>
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <div>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Import File</label>
                        <input
                            type="file"
                            accept=".json,.csv,.mbox,.eml"
                            onChange={(event) => setImportFile(event.target.files?.[0] || null)}
                            className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm"
                        />
                        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Supported formats: JSON, CSV, MBOX, and EML.</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void createImport()}
                        disabled={importSubmitting || !importFile}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)] disabled:opacity-60"
                    >
                        <Upload className="w-4 h-4" />
                        {importSubmitting ? 'Uploading...' : 'Create Import'}
                    </button>
                </div>
            </section>

            <section className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                <table className="w-full min-w-[980px] text-left">
                    <thead>
                        <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Format</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Created</th>
                            <th className="px-4 py-3">Expires</th>
                            <th className="px-4 py-3 text-right">Download</th>
                        </tr>
                    </thead>
                    <tbody>
                        {jobs.map((job) => {
                            const normalizedStatus = job.status === 'done' ? 'completed' : job.status;
                            const expired = job.expiresAt && new Date(job.expiresAt).getTime() <= Date.now();
                            const finalStatus = expired ? 'expired' : normalizedStatus;
                            return (
                                <tr key={job.id} className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{String((job.resources || [])[0] || 'export').replace(/_/g, ' ')}</td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)] uppercase">{job.format || job.payload?.format || 'json'}</td>
                                    <td className="px-4 py-3"><StatusBadge label={finalStatus} variant={finalStatus === 'completed' ? 'success' : finalStatus === 'failed' || finalStatus === 'expired' ? 'error' : 'warning'} /></td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{new Date(job.createdAt).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{job.expiresAt ? new Date(job.expiresAt).toLocaleString() : '--'}</td>
                                    <td className="px-4 py-3 text-right">
                                        {finalStatus === 'completed' ? (
                                            <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/export-import/export/${job.id}/download`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-card-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
                                                <Download className="w-4 h-4" /> Download
                                            </a>
                                        ) : (
                                            <span className="text-sm text-[var(--color-text-muted)]">Unavailable</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {jobs.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">No export jobs created yet.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </section>

            <section className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                <table className="w-full min-w-[760px] text-left">
                    <thead>
                        <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                            <th className="px-4 py-3">File</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Created</th>
                            <th className="px-4 py-3">Error</th>
                        </tr>
                    </thead>
                    <tbody>
                        {imports.map((job) => (
                            <tr key={job.id} className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                <td className="px-4 py-3 text-[var(--color-text-primary)]">{job.payload?.originalName || job.id}</td>
                                <td className="px-4 py-3">
                                    <StatusBadge
                                        label={job.status}
                                        variant={job.status === 'completed' ? 'success' : job.status === 'failed' ? 'error' : 'warning'}
                                    />
                                </td>
                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{new Date(job.createdAt).toLocaleString()}</td>
                                <td className="px-4 py-3 text-[var(--color-text-muted)]">{job.error || '--'}</td>
                            </tr>
                        ))}
                        {imports.length === 0 && (
                            <tr>
                                <td colSpan={4} className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">No import jobs created yet.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </section>
        </div>
    );
};

export default ExportPage;
