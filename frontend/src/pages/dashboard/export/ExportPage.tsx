import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileDown, Upload, Copy, Check } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import api from '../../../lib/api';
import { TablePageSkeleton } from '../../../components/skeletons/TablePageSkeleton';

type ExportType = 'gdpr_export' | 'messages_export' | 'threads_export' | 'contacts_export' | 'analytics_export';
type ExportFormat = 'json' | 'csv' | 'mbox' | 'eml';

type ExportJob = {
    id: string;
    status: string;
    format?: string | null;
    resources?: string[];
    payload?: { format?: string | null } | null;
    createdAt: string;
    expiresAt?: string | null;
    progressPercentage?: number | null;
    downloadCount?: number | null;
    maxDownloads?: number | null;
    checksum?: string | null;
};

type ImportJob = {
    id: string;
    status: string;
    payload?: { originalName?: string | null } | null;
    createdAt: string;
    error?: string | null;
};

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

const normalizeStatus = (status?: string | null) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'done') return 'completed';
    return normalized || 'pending';
};

const checksumPreview = (checksum?: string | null) => {
    if (!checksum) return '--';
    if (checksum.length <= 16) return checksum;
    return `${checksum.slice(0, 8)}...${checksum.slice(-8)}`;
};

const clampProgress = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
};

const ExportPage: React.FC = () => {
    const { t } = useTranslation();
    const [jobs, setJobs] = useState<ExportJob[]>([]);
    const [imports, setImports] = useState<ImportJob[]>([]);
    const [mailboxes, setMailboxes] = useState<any[]>([]);
    const [contacts, setContacts] = useState<any[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [importSubmitting, setImportSubmitting] = useState(false);
    const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);
    const [copiedChecksumId, setCopiedChecksumId] = useState<string | null>(null);
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

    const loadInitialData = useCallback(async () => {
        setInitialLoading(true);
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
            setInitialLoading(false);
        }
    }, []);

    const refreshJobsAndImports = useCallback(async () => {
        setRefreshing(true);
        try {
            const [jobsRes, importsRes] = await Promise.all([
                api.get('/export-import/export'),
                api.get('/export-import/import'),
            ]);
            setJobs(Array.isArray(jobsRes.data) ? jobsRes.data : []);
            setImports(Array.isArray(importsRes.data) ? importsRes.data : []);
            setError('');
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to refresh export jobs.');
        } finally {
            setRefreshing(false);
        }
    }, []);

    const hasInFlightExports = useMemo(
        () => jobs.some((job) => ['pending', 'processing'].includes(normalizeStatus(job.status))),
        [jobs],
    );

    useEffect(() => {
        void loadInitialData();
    }, [loadInitialData]);

    useEffect(() => {
        if (!hasInFlightExports) return;
        const intervalId = window.setInterval(() => {
            void refreshJobsAndImports();
        }, 3000);
        return () => window.clearInterval(intervalId);
    }, [hasInFlightExports, refreshJobsAndImports]);

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
            await refreshJobsAndImports();
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to create import.');
        } finally {
            setImportSubmitting(false);
        }
    };

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
            await refreshJobsAndImports();
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to create export.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDownload = async (job: ExportJob) => {
        const normalizedStatus = normalizeStatus(job.status);
        const expiresAt = job.expiresAt ? new Date(job.expiresAt).getTime() : null;
        const expired = Boolean(expiresAt && expiresAt <= Date.now());
        const finalStatus = expired ? 'expired' : normalizedStatus;
        const downloadCount = Number(job.downloadCount ?? 0);
        const maxDownloads = Number(job.maxDownloads ?? 5);

        if (finalStatus !== 'completed') {
            setError('Export is not ready for download yet.');
            return;
        }
        if (downloadCount >= maxDownloads) {
            setError('Download limit reached for this export.');
            return;
        }

        setDownloadingJobId(job.id);
        setError('');

        try {
            const response = await api.get(`/export-import/export/${job.id}/download-url`);
            const directUrl = String(response.data?.url || '');
            const directFilename = String(
                response.data?.filename || `export-${job.id}.${job.format || job.payload?.format || 'json'}`,
            );
            if (!directUrl) {
                throw new Error('Failed to get direct download URL.');
            }
            const link = document.createElement('a');
            link.href = directUrl;
            link.setAttribute('download', directFilename);
            link.setAttribute('rel', 'noopener');
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => {
                void refreshJobsAndImports();
            }, 1200);
        } catch (err: any) {
            if (err?.response?.status === 403) {
                setError('Download limit reached for this export.');
            } else {
                setError(err?.response?.data?.message || err?.message || 'Failed to download export.');
            }
        } finally {
            setDownloadingJobId(null);
        }
    };

    const copyChecksum = async (jobId: string, checksum?: string | null) => {
        if (!checksum) return;
        try {
            await navigator.clipboard.writeText(checksum);
            setCopiedChecksumId(jobId);
            window.setTimeout(() => setCopiedChecksumId(null), 1200);
        } catch {
            setError('Failed to copy checksum to clipboard.');
        }
    };

    if (initialLoading) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                <PageHeader title={t('sidebar_export', 'Export & Import')} subtitle="Create organization-scoped exports for GDPR, threads, messages, contacts, and analytics with expiration-aware downloads." />
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <TablePageSkeleton cols={8} showHeader={false} />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <PageHeader title={t('sidebar_export', 'Export & Import')} subtitle="Create organization-scoped exports for GDPR, threads, messages, contacts, and analytics with expiration-aware downloads." />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {refreshing && <div className="text-xs text-[var(--color-text-muted)]">Refreshing export status...</div>}

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
                <table className="w-full min-w-[1280px] text-left">
                    <thead>
                        <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Format</th>
                            <th className="px-4 py-3">Progress</th>
                            <th className="px-4 py-3">Downloads</th>
                            <th className="px-4 py-3">Checksum</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Created</th>
                            <th className="px-4 py-3">Expires</th>
                            <th className="px-4 py-3 text-right">Download</th>
                        </tr>
                    </thead>
                    <tbody>
                        {jobs.map((job) => {
                            const normalizedStatus = normalizeStatus(job.status);
                            const expired = job.expiresAt && new Date(job.expiresAt).getTime() <= Date.now();
                            const finalStatus = expired ? 'expired' : normalizedStatus;
                            const progress = finalStatus === 'completed' ? 100 : clampProgress(Number(job.progressPercentage ?? 0));
                            const downloadCount = Number(job.downloadCount ?? 0);
                            const maxDownloads = Number(job.maxDownloads ?? 5);
                            const downloadLimitReached = downloadCount >= maxDownloads;
                            const canDownload = finalStatus === 'completed' && !downloadLimitReached;

                            return (
                                <tr key={job.id} className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                    <td className="px-4 py-3 text-[var(--color-text-primary)]">{String((job.resources || [])[0] || 'export').replace(/_/g, ' ')}</td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)] uppercase">{job.format || job.payload?.format || 'json'}</td>
                                    <td className="px-4 py-3">
                                        <div className="w-44 space-y-1">
                                            <div className="h-2 rounded-full bg-[var(--color-background)]">
                                                <div className="h-2 rounded-full bg-[var(--color-primary)] transition-all" style={{ width: `${progress}%` }} />
                                            </div>
                                            <div className="text-xs text-[var(--color-text-muted)]">{progress}%</div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{downloadCount} / {maxDownloads}</td>
                                    <td className="px-4 py-3">
                                        {job.checksum ? (
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs text-[var(--color-text-muted)]">{checksumPreview(job.checksum)}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => void copyChecksum(job.id, job.checksum)}
                                                    className="inline-flex items-center justify-center rounded-md border border-[var(--color-card-border)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"
                                                    title="Copy checksum"
                                                >
                                                    {copiedChecksumId === job.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="text-xs text-[var(--color-text-muted)]">--</span>
                                        )}
                                    </td>
                                    <td className="px-4 py-3"><StatusBadge label={finalStatus} variant={finalStatus === 'completed' ? 'success' : finalStatus === 'failed' || finalStatus === 'expired' ? 'error' : 'warning'} /></td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{new Date(job.createdAt).toLocaleString()}</td>
                                    <td className="px-4 py-3 text-[var(--color-text-muted)]">{job.expiresAt ? new Date(job.expiresAt).toLocaleString() : '--'}</td>
                                    <td className="px-4 py-3 text-right">
                                        <button
                                            type="button"
                                            onClick={() => void handleDownload(job)}
                                            disabled={!canDownload || downloadingJobId === job.id}
                                            className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-card-border)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            <Download className="w-4 h-4" />
                                            {downloadingJobId === job.id ? 'Downloading...' : canDownload ? 'Download' : downloadLimitReached ? 'Limit reached' : 'Unavailable'}
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {jobs.length === 0 && (
                            <tr>
                                <td colSpan={9} className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">No export jobs created yet.</td>
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

