import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Mail, Pencil, Plus, Trash2, UserRound } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import { InlineSkeleton } from '../../../components/ui/Skeleton';
import api from '../../../lib/api';
import { hasPermission } from '../../../hooks/usePermission';
import { useAuth } from '../../../context/AuthContext';

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

const ContactsPage: React.FC = () => {
    const { user } = useAuth();
    const canCreate = hasPermission(user?.permissions, 'contacts:create');
    const canManage = hasPermission(user?.permissions, 'contacts:manage');
    const canDelete = hasPermission(user?.permissions, 'contacts:delete');

    const [tab, setTab] = useState<TabKey>('contacts');
    const [contacts, setContacts] = useState<ContactRecord[]>([]);
    const [companies, setCompanies] = useState<CompanyRecord[]>([]);
    const [users, setUsers] = useState<Array<{ id: string; fullName?: string; email: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedContactId, setSelectedContactId] = useState<string>('');
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [contactDetail, setContactDetail] = useState<ContactRecord | null>(null);
    const [companyDetail, setCompanyDetail] = useState<CompanyRecord | null>(null);
    const [contactModalOpen, setContactModalOpen] = useState(false);
    const [companyModalOpen, setCompanyModalOpen] = useState(false);
    const [editingContactId, setEditingContactId] = useState<string | null>(null);
    const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
    const [contactForm, setContactForm] = useState(blankContact);
    const [companyForm, setCompanyForm] = useState(blankCompany);
    const [formError, setFormError] = useState('');

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const [contactsRes, companiesRes, usersRes] = await Promise.all([
                api.get('/contacts'),
                api.get('/companies'),
                api.get('/users').catch(() => ({ data: [] })),
            ]);
            const contactRows = Array.isArray(contactsRes.data) ? contactsRes.data : [];
            const companyRows = Array.isArray(companiesRes.data) ? companiesRes.data : [];
            setContacts(contactRows);
            setCompanies(companyRows);
            setUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
            setSelectedContactId((prev) => prev || contactRows[0]?.id || '');
            setSelectedCompanyId((prev) => prev || companyRows[0]?.id || '');
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to load CRM data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    useEffect(() => {
        if (!selectedContactId) {
            setContactDetail(null);
            return;
        }
        void api.get(`/contacts/${selectedContactId}`).then((res) => setContactDetail(res.data)).catch(() => setContactDetail(null));
    }, [selectedContactId]);

    useEffect(() => {
        if (!selectedCompanyId) {
            setCompanyDetail(null);
            return;
        }
        void api.get(`/companies/${selectedCompanyId}`).then((res) => setCompanyDetail(res.data)).catch(() => setCompanyDetail(null));
    }, [selectedCompanyId]);

    const companyMap = useMemo(() => Object.fromEntries(companies.map((company) => [company.id, company.name])), [companies]);
    const userMap = useMemo(() => Object.fromEntries(users.map((entry) => [entry.id, entry.fullName || entry.email])), [users]);

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

    const removeContact = async (id: string) => {
        await api.delete(`/contacts/${id}`);
        await load();
    };

    const removeCompany = async (id: string) => {
        await api.delete(`/companies/${id}`);
        await load();
    };

    const displayContacts = loading
        ? Array.from({ length: 6 }, (_, index) => ({ id: `loading-contact-${index}`, email: '', fullName: '', lifecycleStage: '', source: '', assignedToUserId: '', emailCount: 0, threadCount: 0, lastContactedAt: '' } as ContactRecord))
        : contacts;

    const displayCompanies = loading
        ? Array.from({ length: 4 }, (_, index) => ({ id: `loading-company-${index}`, tenantId: '', name: '', primaryDomain: '', additionalDomains: [], customFields: {}, contactCount: 0, threadCount: 0 } as CompanyRecord))
        : companies;

    return (
        <div className="mx-auto max-w-[1280px] space-y-6">
            <PageHeader
                title="CRM"
                subtitle="Manage contacts, companies, linking, lifecycle data, and CRM activity stats."
                actions={(
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => setTab('contacts')} className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === 'contacts' ? 'bg-[var(--color-cta-primary)] text-white' : 'border border-[var(--color-card-border)] bg-white text-[var(--color-text-primary)]'}`}>Contacts</button>
                        <button type="button" onClick={() => setTab('companies')} className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === 'companies' ? 'bg-[var(--color-cta-primary)] text-white' : 'border border-[var(--color-card-border)] bg-white text-[var(--color-text-primary)]'}`}>Companies</button>
                    </div>
                )}
            />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {tab === 'contacts' ? (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_420px]">
                    <section className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                        <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Contacts</h2>
                                <p className="text-sm text-[var(--color-text-muted)]">Manual, imported, and email-sync contacts.</p>
                            </div>
                            {canCreate && <button type="button" onClick={openContactCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create</button>}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1180px] text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                        <th className="px-4 py-3">Full Name</th>
                                        <th className="px-4 py-3">Email</th>
                                        <th className="px-4 py-3">Lifecycle</th>
                                        <th className="px-4 py-3">Source</th>
                                        <th className="px-4 py-3">Assigned</th>
                                        <th className="px-4 py-3">Email Count</th>
                                        <th className="px-4 py-3">Thread Count</th>
                                        <th className="px-4 py-3">Last Contacted</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayContacts.map((contact) => (
                                        <tr key={contact.id} className={`border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35 ${selectedContactId === contact.id ? 'bg-[var(--color-background)]/30' : ''}`}>
                                            <td className="px-4 py-3 font-medium text-[var(--color-text-primary)] cursor-pointer" onClick={() => !loading && setSelectedContactId(contact.id)}>{loading ? <InlineSkeleton className="h-4 w-28" /> : (contact.fullName || '--')}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-40" /> : contact.email}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)] capitalize">{loading ? <InlineSkeleton className="h-4 w-16" /> : (contact.lifecycleStage || '--')}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-16" /> : (contact.source || '--')}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-20" /> : (userMap[contact.assignedToUserId || ''] || '--')}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-8" /> : Number(contact.emailCount || 0).toLocaleString()}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-8" /> : Number(contact.threadCount || 0).toLocaleString()}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-28" /> : (contact.lastContactedAt ? new Date(contact.lastContactedAt).toLocaleString() : '--')}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-1">
                                                    {!loading && canManage && <button type="button" onClick={() => openContactEdit(contact)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="h-4 w-4" /></button>}
                                                    {!loading && canDelete && <button type="button" onClick={() => void removeContact(contact.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-w-0">
                        {loading ? (
                            <div className="space-y-5">
                                <InlineSkeleton className="h-7 w-32" />
                                <InlineSkeleton className="h-4 w-40" />
                                <div className="space-y-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3"><InlineSkeleton className="h-4 w-full" /></div>)}</div>
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
                    </section>
                </div>
            ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                    <section className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                        <div className="flex items-center justify-between border-b border-[var(--color-card-border)] px-5 py-4">
                            <div>
                                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Companies</h2>
                                <p className="text-sm text-[var(--color-text-muted)]">Primary domain, additional domains, and custom fields.</p>
                            </div>
                            {canCreate && <button type="button" onClick={openCompanyCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" /> Create</button>}
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[760px] text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                        <th className="px-4 py-3">Name</th>
                                        <th className="px-4 py-3">Primary Domain</th>
                                        <th className="px-4 py-3">Additional Domains</th>
                                        <th className="px-4 py-3">Threads</th>
                                        <th className="px-4 py-3">Contacts</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayCompanies.map((company) => (
                                        <tr key={company.id} className={`border-b border-[var(--color-card-border)]/70 text-sm hover:bg-[var(--color-background)]/35 ${selectedCompanyId === company.id ? 'bg-[var(--color-background)]/30' : ''}`}>
                                            <td className="px-4 py-3 font-medium text-[var(--color-text-primary)] cursor-pointer" onClick={() => !loading && setSelectedCompanyId(company.id)}>{loading ? <InlineSkeleton className="h-4 w-28" /> : company.name}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-28" /> : (company.primaryDomain || '--')}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-36" /> : ((company.additionalDomains || []).join(', ') || '--')}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-8" /> : (company.threadCount || 0)}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{loading ? <InlineSkeleton className="h-4 w-8" /> : (company.contactCount || 0)}</td>
                                            <td className="px-4 py-3"><div className="flex justify-end gap-1">{!loading && canManage && <button type="button" onClick={() => openCompanyEdit(company)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="h-4 w-4" /></button>}{!loading && canDelete && <button type="button" onClick={() => void removeCompany(company.id)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}</div></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </section>
                    <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-w-0">
                        {loading ? (
                            <div className="space-y-5">
                                <InlineSkeleton className="h-7 w-32" />
                                <div className="space-y-3">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3"><InlineSkeleton className="h-4 w-full" /></div>)}</div>
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
                    </section>
                </div>
            )}

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

export default ContactsPage;
