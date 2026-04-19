import React, { useEffect, useMemo, useState } from 'react';
import { Building2, ChevronLeft, ChevronRight, Clock3, Eye, Mail, MessageSquare, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import { InlineSkeleton } from '../../../components/ui/Skeleton';
import api from '../../../lib/api';
import { hasPermission } from '../../../hooks/usePermission';
import { useAuth } from '../../../context/AuthContext';
import { useAdaptiveRows } from '../../../hooks/useAdaptiveCount';

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
    linkedThreads?: Array<any>;
    linkedMessages?: Array<any>;
};

type CompanyRecord = {
    id: string;
    tenantId: string;
    name: string;
    primaryDomain?: string | null;
    additionalDomains?: string[];
    customFields?: Record<string, unknown>;
    contactCount?: number;
    threadCount?: number;
};

type PagedResponse<T> = {
    items: T[];
    total: number;
    page: number;
    limit: number;
};

type DeleteConfirmState = {
    entity: 'contact' | 'company';
    ids: string[];
    names: string[];
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

type TabKey = 'contacts' | 'companies';

const blankContact = {
    email: '',
    fullName: '',
    additionalEmails: '',
    lifecycleStage: 'lead',
    phoneNumbers: '',
    addresses: '',
    socialProfiles: '',
    customFields: '{}',
    assignedToUserId: '',
    source: 'manual',
    companyId: '',
};

const blankCompany = {
    name: '',
    primaryDomain: '',
    additionalDomains: '',
    customFields: '{}',
};

const PAGE_LIMIT = 20;

const ContactsPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { user } = useAuth();
    const canCreate = hasPermission(user?.permissions, 'contacts:create');
    const canManage = hasPermission(user?.permissions, 'contacts:manage');
    const canDelete = hasPermission(user?.permissions, 'contacts:delete');

    const [tab, setTab] = useState<TabKey>('contacts');
    const [contacts, setContacts] = useState<ContactRecord[]>([]);
    const [companies, setCompanies] = useState<CompanyRecord[]>([]);
    const [contactsTotal, setContactsTotal] = useState(0);
    const [companiesTotal, setCompaniesTotal] = useState(0);
    const [contactsPage, setContactsPage] = useState(1);
    const [companiesPage, setCompaniesPage] = useState(1);
    const [users, setUsers] = useState<Array<{ id: string; fullName?: string; email: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedContactId, setSelectedContactId] = useState<string>('');
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [contactDetail, setContactDetail] = useState<ContactRecord | null>(null);
    const [companyDetail, setCompanyDetail] = useState<CompanyRecord | null>(null);
    const [contactDetailLoading, setContactDetailLoading] = useState(false);
    const [companyDetailLoading, setCompanyDetailLoading] = useState(false);
    const [contactModalOpen, setContactModalOpen] = useState(false);
    const [companyModalOpen, setCompanyModalOpen] = useState(false);
    const [editingContactId, setEditingContactId] = useState<string | null>(null);
    const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
    const [contactForm, setContactForm] = useState(blankContact);
    const [companyForm, setCompanyForm] = useState(blankCompany);
    const [formError, setFormError] = useState('');
    const [contactNotificationPreference, setContactNotificationPreference] = useState<ContactNotificationPreference | null>(null);
    const [contactNotificationLoading, setContactNotificationLoading] = useState(false);
    const [contactNotificationSaving, setContactNotificationSaving] = useState(false);
    const [contactNotificationError, setContactNotificationError] = useState('');
    const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
    const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
    const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState | null>(null);
    const [deleteSubmitting, setDeleteSubmitting] = useState(false);
    const [contactDetailsOpen, setContactDetailsOpen] = useState(false);
    const [companyDetailsOpen, setCompanyDetailsOpen] = useState(false);
    const [contactQuery, setContactQuery] = useState('');
    const [companyQuery, setCompanyQuery] = useState('');

    useEffect(() => {
        const tabQuery = searchParams.get('tab');
        if (tabQuery === 'companies') {
            setTab('companies');
        } else if (tabQuery === 'contacts') {
            setTab('contacts');
        }
    }, [searchParams]);

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const [contactsRes, companiesRes, usersRes] = await Promise.all([
                api.get('/contacts', { params: { page: contactsPage, limit: PAGE_LIMIT } }),
                api.get('/companies', { params: { page: companiesPage, limit: PAGE_LIMIT } }),
                api.get('/users').catch(() => ({ data: [] })),
            ]);
            const contactPayload = contactsRes.data as ContactRecord[] | PagedResponse<ContactRecord>;
            const companyPayload = companiesRes.data as CompanyRecord[] | PagedResponse<CompanyRecord>;
            const contactRows = Array.isArray(contactPayload) ? contactPayload : contactPayload.items || [];
            const companyRows = Array.isArray(companyPayload) ? companyPayload : companyPayload.items || [];
            const nextContactsTotal = Array.isArray(contactPayload) ? contactRows.length : Number(contactPayload.total || contactRows.length);
            const nextCompaniesTotal = Array.isArray(companyPayload) ? companyRows.length : Number(companyPayload.total || companyRows.length);
            setContacts(contactRows);
            setCompanies(companyRows);
            setContactsTotal(nextContactsTotal);
            setCompaniesTotal(nextCompaniesTotal);
            setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
            setSelectedContactIds((prev) => prev.filter((id) => contactRows.some((entry) => entry.id === id)));
            setSelectedCompanyIds((prev) => prev.filter((id) => companyRows.some((entry) => entry.id === id)));
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to load CRM data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [contactsPage, companiesPage]);

    useEffect(() => {
        if (!selectedContactId) {
            setContactDetail(null);
            setContactNotificationPreference(null);
            setContactNotificationError('');
            setContactDetailLoading(false);
            return;
        }
        setContactDetailLoading(true);
        setContactDetail(null);
        setContactNotificationLoading(true);
        setContactNotificationError('');
        void Promise.allSettled([
            api.get(`/contacts/${selectedContactId}`),
            api.get(`/contacts/${selectedContactId}/notification-preferences`),
        ])
            .then(([contactResult, preferenceResult]) => {
                if (contactResult.status === 'fulfilled') {
                    setContactDetail(contactResult.value.data);
                } else {
                    setContactDetail(null);
                }

                if (preferenceResult.status === 'fulfilled') {
                    setContactNotificationPreference(preferenceResult.value.data);
                } else {
                    setContactNotificationPreference(null);
                    setContactNotificationError('Failed to load contact notification preference.');
                }
            })
            .finally(() => {
                setContactNotificationLoading(false);
                setContactDetailLoading(false);
            });
    }, [selectedContactId]);

    useEffect(() => {
        if (!selectedCompanyId) {
            setCompanyDetail(null);
            setCompanyDetailLoading(false);
            return;
        }
        setCompanyDetailLoading(true);
        setCompanyDetail(null);
        void api
            .get(`/companies/${selectedCompanyId}`)
            .then((res) => setCompanyDetail(res.data))
            .catch(() => setCompanyDetail(null))
            .finally(() => setCompanyDetailLoading(false));
    }, [selectedCompanyId]);

    const companyMap = useMemo(() => Object.fromEntries(companies.map((company) => [company.id, company.name])), [companies]);
    const userMap = useMemo(() => Object.fromEntries(users.map((entry) => [entry.id, entry.fullName || entry.email])), [users]);
    const contactsLoadingRows = useAdaptiveRows({
        rowHeight: 52,
        minRows: 6,
        maxRows: 14,
        viewportOffset: 340,
    });
    const companiesLoadingRows = useAdaptiveRows({
        rowHeight: 52,
        minRows: 4,
        maxRows: 10,
        viewportOffset: 420,
    });
    const contactDetailSkeletonRows = useAdaptiveRows({
        rowHeight: 46,
        minRows: 4,
        maxRows: 10,
        viewportOffset: 360,
    });
    const companyDetailSkeletonRows = useAdaptiveRows({
        rowHeight: 46,
        minRows: 3,
        maxRows: 8,
        viewportOffset: 420,
    });

    const openContactCreate = () => {
        setEditingContactId(null);
        setContactForm(blankContact);
        setFormError('');
        setContactModalOpen(true);
    };

    const openContactEdit = (contact: ContactRecord) => {
        setEditingContactId(contact.id);
        setContactForm({
            email: contact.email || '',
            fullName: contact.fullName || '',
            additionalEmails: (contact.additionalEmails || []).join('\n'),
            lifecycleStage: contact.lifecycleStage || 'lead',
            phoneNumbers: JSON.stringify(contact.phoneNumbers || [], null, 2),
            addresses: JSON.stringify(contact.addresses || [], null, 2),
            socialProfiles: JSON.stringify(contact.socialProfiles || [], null, 2),
            customFields: JSON.stringify(contact.customFields || {}, null, 2),
            assignedToUserId: contact.assignedToUserId || '',
            source: contact.source || 'manual',
            companyId: contact.companyId || '',
        });
        setFormError('');
        setContactModalOpen(true);
    };

    const openCompanyCreate = () => {
        setEditingCompanyId(null);
        setCompanyForm(blankCompany);
        setFormError('');
        setCompanyModalOpen(true);
    };

    const openCompanyEdit = (company: CompanyRecord) => {
        setEditingCompanyId(company.id);
        setCompanyForm({
            name: company.name || '',
            primaryDomain: company.primaryDomain || '',
            additionalDomains: (company.additionalDomains || []).join('\n'),
            customFields: JSON.stringify(company.customFields || {}, null, 2),
        });
        setFormError('');
        setCompanyModalOpen(true);
    };

    const openContactDetails = (contactId: string) => {
        setSelectedContactId(contactId);
        setContactDetailsOpen(true);
    };

    const closeContactDetails = () => {
        setContactDetailsOpen(false);
        setSelectedContactId('');
    };

    const openCompanyDetails = (companyId: string) => {
        setSelectedCompanyId(companyId);
        setCompanyDetailsOpen(true);
    };

    const closeCompanyDetails = () => {
        setCompanyDetailsOpen(false);
        setSelectedCompanyId('');
    };

    const saveContact = async () => {
        try {
            const payload = {
                email: contactForm.email.trim(),
                fullName: contactForm.fullName.trim() || undefined,
                additionalEmails: splitLines(contactForm.additionalEmails),
                lifecycleStage: contactForm.lifecycleStage,
                phoneNumbers: parseJsonValue(contactForm.phoneNumbers, []),
                addresses: parseJsonValue(contactForm.addresses, []),
                socialProfiles: parseJsonValue(contactForm.socialProfiles, []),
                customFields: parseJsonValue(contactForm.customFields, {}),
                assignedToUserId: contactForm.assignedToUserId || undefined,
                source: contactForm.source,
                companyId: contactForm.companyId || undefined,
            };
            if (editingContactId) {
                await api.patch(`/contacts/${editingContactId}`, payload);
            } else {
                await api.post('/contacts', payload);
            }
            setContactModalOpen(false);
            await load();
        } catch (err: any) {
            setFormError(err?.response?.data?.message || err?.message || 'Failed to save contact.');
        }
    };

    const saveCompany = async () => {
        try {
            const payload = {
                name: companyForm.name.trim(),
                primaryDomain: companyForm.primaryDomain.trim() || undefined,
                additionalDomains: splitLines(companyForm.additionalDomains),
                customFields: parseJsonValue(companyForm.customFields, {}),
            };
            if (editingCompanyId) {
                await api.patch(`/companies/${editingCompanyId}`, payload);
            } else {
                await api.post('/companies', payload);
            }
            setCompanyModalOpen(false);
            await load();
        } catch (err: any) {
            setFormError(err?.response?.data?.message || err?.message || 'Failed to save company.');
        }
    };

    const contactsTotalPages = Math.max(Math.ceil(Math.max(contactsTotal, 0) / PAGE_LIMIT), 1);
    const companiesTotalPages = Math.max(Math.ceil(Math.max(companiesTotal, 0) / PAGE_LIMIT), 1);

    useEffect(() => {
        if (contactsPage > contactsTotalPages) {
            setContactsPage(contactsTotalPages);
        }
    }, [contactsPage, contactsTotalPages]);

    useEffect(() => {
        if (companiesPage > companiesTotalPages) {
            setCompaniesPage(companiesTotalPages);
        }
    }, [companiesPage, companiesTotalPages]);

    const contactPageIds = useMemo(() => contacts.map((entry) => entry.id), [contacts]);
    const companyPageIds = useMemo(() => companies.map((entry) => entry.id), [companies]);
    const allContactsOnPageSelected = contactPageIds.length > 0 && contactPageIds.every((id) => selectedContactIds.includes(id));
    const allCompaniesOnPageSelected = companyPageIds.length > 0 && companyPageIds.every((id) => selectedCompanyIds.includes(id));

    const toggleContactSelection = (id: string, checked: boolean) => {
        setSelectedContactIds((prev) => checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((entry) => entry !== id));
    };

    const toggleCompanySelection = (id: string, checked: boolean) => {
        setSelectedCompanyIds((prev) => checked ? (prev.includes(id) ? prev : [...prev, id]) : prev.filter((entry) => entry !== id));
    };

    const toggleAllContactsOnPage = (checked: boolean) => {
        setSelectedContactIds((prev) => checked ? Array.from(new Set([...prev, ...contactPageIds])) : prev.filter((id) => !contactPageIds.includes(id)));
    };

    const toggleAllCompaniesOnPage = (checked: boolean) => {
        setSelectedCompanyIds((prev) => checked ? Array.from(new Set([...prev, ...companyPageIds])) : prev.filter((id) => !companyPageIds.includes(id)));
    };

    const requestDelete = (entity: 'contact' | 'company', ids: string[], names: string[]) => {
        if (ids.length === 0) return;
        setDeleteConfirm({ entity, ids, names });
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        setDeleteSubmitting(true);
        setError('');
        try {
            const endpoint = deleteConfirm.entity === 'contact' ? '/contacts' : '/companies';
            await Promise.all(deleteConfirm.ids.map((id) => api.delete(`${endpoint}/${id}`)));
            if (deleteConfirm.entity === 'contact') {
                setSelectedContactIds((prev) => prev.filter((id) => !deleteConfirm.ids.includes(id)));
            } else {
                setSelectedCompanyIds((prev) => prev.filter((id) => !deleteConfirm.ids.includes(id)));
            }
            setDeleteConfirm(null);
            await load();
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to delete selected records.');
        } finally {
            setDeleteSubmitting(false);
        }
    };

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
        if (!selectedContactId || !contactNotificationPreference) return;
        setContactNotificationSaving(true);
        setContactNotificationError('');
        try {
            const response = await api.patch(
                `/contacts/${selectedContactId}/notification-preferences`,
                {
                    enabled: contactNotificationPreference.enabled,
                    in_app: contactNotificationPreference.channels.in_app,
                    email: contactNotificationPreference.channels.email,
                    push: contactNotificationPreference.channels.push,
                    desktop: contactNotificationPreference.channels.desktop,
                },
            );
            setContactNotificationPreference(response.data);
        } catch (err: any) {
            setContactNotificationError(
                err?.response?.data?.message || 'Failed to save contact notification preference.',
            );
        } finally {
            setContactNotificationSaving(false);
        }
    };

    const displayContacts = loading
        ? Array.from({ length: contactsLoadingRows }, (_, index) => ({ id: `loading-contact-${index}`, email: '', fullName: '', lifecycleStage: '', source: '', assignedToUserId: '', emailCount: 0, threadCount: 0, lastContactedAt: '' } as ContactRecord))
        : contacts.filter((entry) => {
            const q = contactQuery.trim().toLowerCase();
            if (!q) return true;
            return `${entry.fullName || ''} ${entry.email || ''}`.toLowerCase().includes(q);
        });

    const displayCompanies = loading
        ? Array.from({ length: companiesLoadingRows }, (_, index) => ({ id: `loading-company-${index}`, tenantId: '', name: '', primaryDomain: '', additionalDomains: [], customFields: {}, contactCount: 0, threadCount: 0 } as CompanyRecord))
        : companies.filter((entry) => {
            const q = companyQuery.trim().toLowerCase();
            if (!q) return true;
            return `${entry.name || ''} ${entry.primaryDomain || ''}`.toLowerCase().includes(q);
        });

    return (
        <div className="mx-auto max-w-[1280px] space-y-6">
            <PageHeader
                title="CRM"
                subtitle="Manage contacts, companies, linking, lifecycle data, and CRM activity stats."
                actions={(
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => { setTab('contacts'); setSearchParams({ tab: 'contacts' }); }} className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === 'contacts' ? 'bg-[var(--color-cta-primary)] text-white' : 'border border-[var(--color-card-border)] bg-white text-[var(--color-text-primary)]'}`}>Contacts</button>
                        <button type="button" onClick={() => { setTab('companies'); setSearchParams({ tab: 'companies' }); }} className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === 'companies' ? 'bg-[var(--color-cta-primary)] text-white' : 'border border-[var(--color-card-border)] bg-white text-[var(--color-text-primary)]'}`}>Companies</button>
                    </div>
                )}
            />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {tab === 'contacts' ? (
                <div className="block">
                    <section className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                        <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Contacts Directory</h2>
                                <p className="text-sm text-[var(--color-text-muted)]">Manual, imported, and email-sync contacts.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    value={contactQuery}
                                    onChange={(event) => setContactQuery(event.target.value)}
                                    placeholder="Search records..."
                                    className="w-56 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)]/60 px-3 py-2 text-sm text-[var(--color-text-primary)]"
                                />
                                {canDelete && selectedContactIds.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => requestDelete('contact', selectedContactIds, contacts.filter((entry) => selectedContactIds.includes(entry.id)).map((entry) => entry.fullName || entry.email || entry.id))}
                                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Delete Selected ({selectedContactIds.length})
                                    </button>
                                )}
                                {canCreate && <button type="button" onClick={openContactCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create</button>}
                            </div>
                        </div>
                        <div className="w-full overflow-x-auto overflow-y-hidden pb-2 [scrollbar-gutter:stable]">
                            <table className="w-full min-w-[980px] text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                        <th className="px-4 py-3">
                                            <input
                                                type="checkbox"
                                                aria-label="Select all contacts on page"
                                                checked={allContactsOnPageSelected}
                                                onChange={(event) => toggleAllContactsOnPage(event.target.checked)}
                                                disabled={loading || contactPageIds.length === 0}
                                                className="h-4 w-4 rounded border-[var(--color-card-border)]"
                                            />
                                        </th>
                                        <th className="px-4 py-3">Name & Email</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Activity</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayContacts.map((contact) => (
                                        <tr key={contact.id} className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                            <td className="px-4 py-3">
                                                {loading ? (
                                                    <InlineSkeleton className="h-4 w-4" />
                                                ) : (
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Select ${contact.fullName || contact.email || 'contact'}`}
                                                        checked={selectedContactIds.includes(contact.id)}
                                                        onChange={(event) => toggleContactSelection(contact.id, event.target.checked)}
                                                        className="h-4 w-4 rounded border-[var(--color-card-border)]"
                                                    />
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {loading ? <InlineSkeleton className="h-10 w-56" /> : (
                                                    <div>
                                                        <p className="font-medium text-[var(--color-text-primary)]">{contact.fullName || '--'}</p>
                                                        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{contact.email}</p>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {loading ? <InlineSkeleton className="h-6 w-32" /> : (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 capitalize">{contact.lifecycleStage || '--'}</span>
                                                        <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">{contact.source || '--'}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">
                                                {loading ? <InlineSkeleton className="h-6 w-52" /> : (
                                                    <div className="flex items-center gap-3 text-xs">
                                                        <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {Number(contact.emailCount || 0).toLocaleString()}</span>
                                                        <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {Number(contact.threadCount || 0).toLocaleString()}</span>
                                                        <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /> {contact.lastContactedAt ? new Date(contact.lastContactedAt).toLocaleDateString() : '--'}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-1">
                                                    {!loading && <button type="button" onClick={() => openContactDetails(contact.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]" aria-label="View contact details"><Eye className="h-4 w-4" /></button>}
                                                    {!loading && canManage && <button type="button" onClick={() => openContactEdit(contact)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="h-4 w-4" /></button>}
                                                    {!loading && canDelete && <button type="button" onClick={() => requestDelete('contact', [contact.id], [contact.fullName || contact.email || contact.id])} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <PaginationBar
                            page={contactsPage}
                            total={contactsTotal}
                            limit={PAGE_LIMIT}
                            totalPages={contactsTotalPages}
                            onPageChange={(nextPage) => setContactsPage(nextPage)}
                        />
                    </section>
                    {false && <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-w-0">
                        {loading ? (
                            <div className="space-y-5">
                                <InlineSkeleton className="h-7 w-32" />
                                <InlineSkeleton className="h-4 w-40" />
                                <div className="space-y-3">{Array.from({ length: contactDetailSkeletonRows }, (_, index) => <div key={index} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3"><InlineSkeleton className="h-4 w-full" /></div>)}</div>
                            </div>
                        ) : contactDetail ? (
                            <div className="space-y-5">
                                <div>
                                    <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{contactDetail.fullName || '--'}</h2>
                                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">{contactDetail.email}</p>
                                </div>
                                <DetailBlock title="Core Fields" rows={[
                                    ['ID', contactDetail.id],
                                    ['Tenant ID', contactDetail.tenantId],
                                    ['Lifecycle Stage', contactDetail.lifecycleStage || '--'],
                                    ['Source', contactDetail.source || '--'],
                                    ['Assigned To', userMap[contactDetail.assignedToUserId || ''] || '--'],
                                    ['Company', companyMap[contactDetail.companyId || ''] || '--'],
                                ]} />
                                <div className="rounded-xl border border-[var(--color-card-border)] p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Contact activity notifications</h3>
                                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                                                Override channel and enable settings for this contact only.
                                            </p>
                                        </div>
                                        {contactNotificationPreference?.hasOverride && (
                                            <span className="rounded-full border border-[var(--color-card-border)] bg-[var(--color-background)] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                                                Override
                                            </span>
                                        )}
                                    </div>
                                    {contactNotificationLoading ? (
                                        <div className="mt-3 space-y-2">
                                            <InlineSkeleton className="h-4 w-40" />
                                            <InlineSkeleton className="h-8 w-full" />
                                            <InlineSkeleton className="h-8 w-full" />
                                        </div>
                                    ) : contactNotificationPreference ? (
                                        <div className="mt-4 space-y-3">
                                            <label className="flex items-center justify-between rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
                                                Enabled
                                                <input
                                                    type="checkbox"
                                                    checked={contactNotificationPreference.enabled}
                                                    onChange={(event) =>
                                                        updateContactNotificationPreference({ enabled: event.target.checked })
                                                    }
                                                    className="h-4 w-4 rounded border-[var(--color-card-border)] text-[var(--color-primary)]"
                                                />
                                            </label>
                                            <div className="grid grid-cols-2 gap-2">
                                                {[
                                                    ['in_app', 'In-app'],
                                                    ['email', 'Email'],
                                                    ['push', 'Push'],
                                                    ['desktop', 'Desktop'],
                                                ].map(([channelKey, label]) => (
                                                    <label key={channelKey} className="flex items-center justify-between rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm text-[var(--color-text-primary)]">
                                                        {label}
                                                        <input
                                                            type="checkbox"
                                                            checked={Boolean(contactNotificationPreference.channels[channelKey as keyof ContactNotificationPreference['channels']])}
                                                            onChange={(event) =>
                                                                updateContactNotificationPreference({
                                                                    channels: {
                                                                        [channelKey]: event.target.checked,
                                                                    } as ContactNotificationPreference['channels'],
                                                                })
                                                            }
                                                            className="h-4 w-4 rounded border-[var(--color-card-border)] text-[var(--color-primary)]"
                                                        />
                                                    </label>
                                                ))}
                                            </div>
                                            {contactNotificationError && (
                                                <p className="text-xs text-red-600">{contactNotificationError}</p>
                                            )}
                                            {canManage && (
                                                <div className="flex justify-end">
                                                    <button
                                                        type="button"
                                                        onClick={() => void saveContactNotificationPreference()}
                                                        disabled={contactNotificationSaving}
                                                        className="rounded-lg bg-[var(--color-cta-primary)] px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                                                    >
                                                        {contactNotificationSaving ? 'Saving...' : 'Save contact preference'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
                                            Contact notification preference could not be loaded.
                                        </p>
                                    )}
                                </div>
                                <DetailBlock title="Additional Emails" rows={(contactDetail.additionalEmails || []).map((email) => [email, ''])} emptyLabel="No additional emails" />
                                <JsonBlock title="Phone Numbers" value={contactDetail.phoneNumbers || []} />
                                <JsonBlock title="Addresses" value={contactDetail.addresses || []} />
                                <JsonBlock title="Social Profiles" value={contactDetail.socialProfiles || []} />
                                <JsonBlock title="Custom Fields" value={contactDetail.customFields || {}} />
                                <DetailBlock title="Stats" rows={[
                                    ['Email Count', String(contactDetail.emailCount || 0)],
                                    ['Thread Count', String(contactDetail.threadCount || 0)],
                                    ['Last Contacted', contactDetail.lastContactedAt ? new Date(contactDetail.lastContactedAt).toLocaleString() : '--'],
                                ]} />
                                <JsonBlock title="Linked Threads" value={contactDetail.linkedThreads || []} />
                                <JsonBlock title="Linked Messages" value={contactDetail.linkedMessages || []} />
                            </div>
                        ) : <EmptyState icon={UserRound} title="Select a contact" description="Choose a contact to inspect full CRM details, linking, and stats." />}
                    </section>}
                </div>
            ) : (
                <div className="block">
                    <section className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                        <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Companies Directory</h2>
                                <p className="text-sm text-[var(--color-text-muted)]">Primary domain, additional domains, and custom fields.</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    value={companyQuery}
                                    onChange={(event) => setCompanyQuery(event.target.value)}
                                    placeholder="Search records..."
                                    className="w-56 rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)]/60 px-3 py-2 text-sm text-[var(--color-text-primary)]"
                                />
                                {canDelete && selectedCompanyIds.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => requestDelete('company', selectedCompanyIds, companies.filter((entry) => selectedCompanyIds.includes(entry.id)).map((entry) => entry.name || entry.id))}
                                        className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Delete Selected ({selectedCompanyIds.length})
                                    </button>
                                )}
                                {canCreate && <button type="button" onClick={openCompanyCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create</button>}
                            </div>
                        </div>
                        <div className="w-full overflow-x-auto overflow-y-hidden pb-2 [scrollbar-gutter:stable]">
                            <table className="w-full min-w-[920px] text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                        <th className="px-4 py-3">
                                            <input
                                                type="checkbox"
                                                aria-label="Select all companies on page"
                                                checked={allCompaniesOnPageSelected}
                                                onChange={(event) => toggleAllCompaniesOnPage(event.target.checked)}
                                                disabled={loading || companyPageIds.length === 0}
                                                className="h-4 w-4 rounded border-[var(--color-card-border)]"
                                            />
                                        </th>
                                        <th className="px-4 py-3">Name & Domains</th>
                                        <th className="px-4 py-3">Activity</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayCompanies.map((company) => (
                                        <tr key={company.id} className="border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35">
                                            <td className="px-4 py-3">
                                                {loading ? (
                                                    <InlineSkeleton className="h-4 w-4" />
                                                ) : (
                                                    <input
                                                        type="checkbox"
                                                        aria-label={`Select ${company.name || 'company'}`}
                                                        checked={selectedCompanyIds.includes(company.id)}
                                                        onChange={(event) => toggleCompanySelection(company.id, event.target.checked)}
                                                        className="h-4 w-4 rounded border-[var(--color-card-border)]"
                                                    />
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {loading ? <InlineSkeleton className="h-10 w-64" /> : (
                                                    <div>
                                                        <p className="font-medium text-[var(--color-text-primary)]">{company.name}</p>
                                                        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{company.primaryDomain || '--'}</p>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">
                                                {loading ? <InlineSkeleton className="h-6 w-40" /> : (
                                                    <div className="flex items-center gap-3 text-xs">
                                                        <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" /> {company.threadCount || 0}</span>
                                                        <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> {company.contactCount || 0}</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-4 py-3"><div className="flex justify-end gap-1">{!loading && <button type="button" onClick={() => openCompanyDetails(company.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]" aria-label="View company details"><Eye className="h-4 w-4" /></button>}{!loading && canManage && <button type="button" onClick={() => openCompanyEdit(company)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="h-4 w-4" /></button>}{!loading && canDelete && <button type="button" onClick={() => requestDelete('company', [company.id], [company.name || company.id])} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}</div></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <PaginationBar
                            page={companiesPage}
                            total={companiesTotal}
                            limit={PAGE_LIMIT}
                            totalPages={companiesTotalPages}
                            onPageChange={(nextPage) => setCompaniesPage(nextPage)}
                        />
                    </section>
                    {false && <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-w-0">
                        {loading ? (
                            <div className="space-y-5">
                                <InlineSkeleton className="h-7 w-32" />
                                <div className="space-y-3">{Array.from({ length: companyDetailSkeletonRows }, (_, index) => <div key={index} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3"><InlineSkeleton className="h-4 w-full" /></div>)}</div>
                            </div>
                        ) : companyDetail ? (
                            <div className="space-y-5">
                                <div>
                                    <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{companyDetail.name}</h2>
                                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">{companyDetail.primaryDomain || '--'}</p>
                                </div>
                                <DetailBlock title="Fields" rows={[
                                    ['ID', companyDetail.id],
                                    ['Tenant ID', companyDetail.tenantId],
                                    ['Primary Domain', companyDetail.primaryDomain || '--'],
                                    ['Additional Domains', (companyDetail.additionalDomains || []).join(', ') || '--'],
                                ]} />
                                <JsonBlock title="Custom Fields" value={companyDetail.customFields || {}} />
                            </div>
                        ) : <EmptyState icon={Building2} title="Select a company" description="Choose a company to inspect domains and custom fields." />}
                    </section>}
                </div>
            )}

            <Modal
                isOpen={contactDetailsOpen}
                onClose={closeContactDetails}
                title={contactDetail?.fullName || 'Contact Details'}
                size="xl"
            >
                {contactDetailLoading ? (
                    <div className="space-y-5">
                        <InlineSkeleton className="h-7 w-32" />
                        <InlineSkeleton className="h-4 w-40" />
                        <div className="space-y-3">{Array.from({ length: contactDetailSkeletonRows }, (_, index) => <div key={index} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3"><InlineSkeleton className="h-4 w-full" /></div>)}</div>
                    </div>
                ) : contactDetail ? (
                    <div className="space-y-5">
                        <p className="text-sm text-[var(--color-text-muted)]">{contactDetail.email}</p>
                        <DetailBlock title="Identity" rows={[
                            ['ID', contactDetail.id],
                            ['Tenant ID', contactDetail.tenantId],
                            ['Lifecycle', contactDetail.lifecycleStage || '--'],
                            ['Source', contactDetail.source || '--'],
                            ['Assigned User ID', userMap[contactDetail.assignedToUserId || ''] || '--'],
                            ['Company', companyMap[contactDetail.companyId || ''] || '--'],
                        ]} />
                        <DetailBlock title="Contact Details" rows={[['Primary Email', contactDetail.email]]} />
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
                        <LinkedThreadsBlock title="Linked Threads" threads={Array.isArray(contactDetail.linkedThreads) ? contactDetail.linkedThreads : []} />
                        <JsonBlock title="Linked Messages" value={contactDetail.linkedMessages || []} />
                    </div>
                ) : (
                    <EmptyState icon={UserRound} title="Contact not found" description="The selected contact could not be loaded." />
                )}
            </Modal>

            <Modal
                isOpen={companyDetailsOpen}
                onClose={closeCompanyDetails}
                title={companyDetail?.name || 'Company Details'}
                size="xl"
            >
                {companyDetailLoading ? (
                    <div className="space-y-5">
                        <InlineSkeleton className="h-7 w-32" />
                        <div className="space-y-3">{Array.from({ length: companyDetailSkeletonRows }, (_, index) => <div key={index} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3"><InlineSkeleton className="h-4 w-full" /></div>)}</div>
                    </div>
                ) : companyDetail ? (
                    <div className="space-y-5">
                        <p className="text-sm text-[var(--color-text-muted)]">{companyDetail.primaryDomain || '--'}</p>
                        <DetailBlock title="Fields" rows={[
                            ['ID', companyDetail.id],
                            ['Tenant ID', companyDetail.tenantId],
                            ['Primary Domain', companyDetail.primaryDomain || '--'],
                            ['Additional Domains', (companyDetail.additionalDomains || []).join(', ') || '--'],
                            ['Thread Count', String(companyDetail.threadCount || 0)],
                            ['Contact Count', String(companyDetail.contactCount || 0)],
                        ]} />
                        <JsonBlock title="Custom Fields" value={companyDetail.customFields || {}} />
                    </div>
                ) : (
                    <EmptyState icon={Building2} title="Company not found" description="The selected company could not be loaded." />
                )}
            </Modal>

            <Modal
                isOpen={Boolean(deleteConfirm)}
                onClose={() => !deleteSubmitting && setDeleteConfirm(null)}
                title={deleteConfirm?.entity === 'contact' ? 'Delete Contact(s)' : 'Delete Company(s)'}
                size="sm"
            >
                <div className="space-y-4">
                    <p className="text-sm text-[var(--color-text-primary)]">
                        {deleteConfirm && deleteConfirm.ids.length === 1
                            ? `Are you sure you want to delete this ${deleteConfirm.entity}?`
                            : `Are you sure you want to delete these ${deleteConfirm?.ids.length || 0} ${deleteConfirm?.entity === 'contact' ? 'contacts' : 'companies'}?`}
                    </p>
                    {deleteConfirm && (
                        <div className="max-h-36 overflow-y-auto rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)]/25 px-3 py-2 text-xs text-[var(--color-text-muted)]">
                            {deleteConfirm.names.slice(0, 8).map((name, index) => (
                                <div key={`${name}-${index}`} className="truncate">{name}</div>
                            ))}
                            {deleteConfirm.names.length > 8 && <div>+{deleteConfirm.names.length - 8} more</div>}
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setDeleteConfirm(null)} disabled={deleteSubmitting} className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-primary)]">Cancel</button>
                        <button type="button" onClick={() => void confirmDelete()} disabled={deleteSubmitting} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60">
                            {deleteSubmitting ? 'Deleting...' : 'Delete'}
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={contactModalOpen} onClose={() => setContactModalOpen(false)} title={editingContactId ? 'Update Contact' : 'Create Contact'} size="lg">
                <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Email"><input value={contactForm.email} onChange={(e) => setContactForm((prev) => ({ ...prev, email: e.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" /></Field>
                        <Field label="Full Name"><input value={contactForm.fullName} onChange={(e) => setContactForm((prev) => ({ ...prev, fullName: e.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" /></Field>
                        <Field label="Lifecycle Stage"><select value={contactForm.lifecycleStage} onChange={(e) => setContactForm((prev) => ({ ...prev, lifecycleStage: e.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm"><option value="lead">lead</option><option value="customer">customer</option><option value="partner">partner</option></select></Field>
                        <Field label="Source"><select value={contactForm.source} onChange={(e) => setContactForm((prev) => ({ ...prev, source: e.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm"><option value="manual">manual</option><option value="import">import</option><option value="email-sync">email-sync</option></select></Field>
                        <Field label="Assigned To User"><select value={contactForm.assignedToUserId} onChange={(e) => setContactForm((prev) => ({ ...prev, assignedToUserId: e.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm"><option value="">Unassigned</option>{users.map((entry) => <option key={entry.id} value={entry.id}>{entry.fullName || entry.email}</option>)}</select></Field>
                        <Field label="Company"><select value={contactForm.companyId} onChange={(e) => setContactForm((prev) => ({ ...prev, companyId: e.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm"><option value="">No company</option>{companies.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>
                        <Field label="Additional Emails (one per line)" wide><textarea value={contactForm.additionalEmails} onChange={(e) => setContactForm((prev) => ({ ...prev, additionalEmails: e.target.value }))} className="min-h-24 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" /></Field>
                        <Field label="Phone Numbers JSON" wide><textarea value={contactForm.phoneNumbers} onChange={(e) => setContactForm((prev) => ({ ...prev, phoneNumbers: e.target.value }))} className="min-h-28 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-mono" /></Field>
                        <Field label="Addresses JSON" wide><textarea value={contactForm.addresses} onChange={(e) => setContactForm((prev) => ({ ...prev, addresses: e.target.value }))} className="min-h-28 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-mono" /></Field>
                        <Field label="Social Profiles JSON" wide><textarea value={contactForm.socialProfiles} onChange={(e) => setContactForm((prev) => ({ ...prev, socialProfiles: e.target.value }))} className="min-h-28 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-mono" /></Field>
                        <Field label="Custom Fields JSON" wide><textarea value={contactForm.customFields} onChange={(e) => setContactForm((prev) => ({ ...prev, customFields: e.target.value }))} className="min-h-28 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-mono" /></Field>
                    </div>
                    {formError && <div className="text-sm text-red-600">{formError}</div>}
                    <div className="flex justify-end gap-2"><button type="button" onClick={() => setContactModalOpen(false)} className="rounded-lg px-4 py-2 text-sm">Cancel</button><button type="button" onClick={() => void saveContact()} className="rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white">Save Contact</button></div>
                </div>
            </Modal>

            <Modal isOpen={companyModalOpen} onClose={() => setCompanyModalOpen(false)} title={editingCompanyId ? 'Update Company' : 'Create Company'} size="lg">
                <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Field label="Name"><input value={companyForm.name} onChange={(e) => setCompanyForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" /></Field>
                        <Field label="Primary Domain"><input value={companyForm.primaryDomain} onChange={(e) => setCompanyForm((prev) => ({ ...prev, primaryDomain: e.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" /></Field>
                        <Field label="Additional Domains (one per line)" wide><textarea value={companyForm.additionalDomains} onChange={(e) => setCompanyForm((prev) => ({ ...prev, additionalDomains: e.target.value }))} className="min-h-24 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" /></Field>
                        <Field label="Custom Fields JSON" wide><textarea value={companyForm.customFields} onChange={(e) => setCompanyForm((prev) => ({ ...prev, customFields: e.target.value }))} className="min-h-28 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm font-mono" /></Field>
                    </div>
                    {formError && <div className="text-sm text-red-600">{formError}</div>}
                    <div className="flex justify-end gap-2"><button type="button" onClick={() => setCompanyModalOpen(false)} className="rounded-lg px-4 py-2 text-sm">Cancel</button><button type="button" onClick={() => void saveCompany()} className="rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white">Save Company</button></div>
                </div>
            </Modal>
        </div>
    );
};

const splitLines = (value: string) => value.split('\n').map((entry) => entry.trim()).filter(Boolean);
const parseJsonValue = <T,>(value: string, fallback: T): T => {
    try {
        return value.trim() ? JSON.parse(value) as T : fallback;
    } catch {
        throw new Error('Invalid JSON block');
    }
};

const Field: React.FC<{ label: string; wide?: boolean; children: React.ReactNode }> = ({ label, wide, children }) => (
    <div className={wide ? 'md:col-span-2' : ''}>
        <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">{label}</label>
        {children}
    </div>
);

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

const LinkedThreadsBlock: React.FC<{ title: string; threads: Array<any> }> = ({ title, threads }) => (
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
                    </div>
                ))}
            </div>
        )}
    </div>
);

const PaginationBar: React.FC<{
    page: number;
    total: number;
    limit: number;
    totalPages: number;
    onPageChange: (nextPage: number) => void;
}> = ({ page, total, limit, totalPages, onPageChange }) => (
    <div className="flex items-center justify-between border-t border-[var(--color-card-border)] px-4 py-3">
        <p className="text-xs text-[var(--color-text-muted)]">
            {total === 0 ? 'Page 1 of 1' : `Page ${page} of ${totalPages}`}
        </p>
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => onPageChange(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-[var(--color-card-border)] px-2 py-1 text-sm text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
                <ChevronLeft className="h-4 w-4" />
            </button>
            <button
                type="button"
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-[var(--color-card-border)] px-2 py-1 text-sm text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
                <ChevronRight className="h-4 w-4" />
            </button>
        </div>
    </div>
);

export default ContactsPage;
