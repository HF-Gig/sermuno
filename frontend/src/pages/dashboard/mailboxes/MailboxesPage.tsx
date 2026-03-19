import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../lib/api';
import { Inbox, Mail, Plus, Edit2, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../../../components/ui/PageHeader';
import Modal from '../../../components/ui/Modal';
import { useAuth } from '../../../context/AuthContext';
import { hasPermission } from '../../../hooks/usePermission';

interface Team { id: string; name: string; }
interface User { id: string; fullName: string; email: string; }
interface Mailbox {
    id: string; name: string; email: string | null; provider: string;
    authorizedTeams: Team[]; authorizedUsers: User[];
    smtpHost: string | null; smtpPort: number | null; smtpSecure: boolean; smtpUser: string | null; smtpPass: string | null;
    imapHost: string | null; imapPort: number | null; imapSecure: boolean; imapUser: string | null; imapPass: string | null;
}

const MicrosoftIcon = () => (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" fill="#f25022" />
        <rect x="13" y="3" width="8" height="8" fill="#7fba00" />
        <rect x="3" y="13" width="8" height="8" fill="#00a4ef" />
        <rect x="13" y="13" width="8" height="8" fill="#ffb900" />
    </svg>
);

const MailboxesPage = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const canManage = hasPermission(user?.permissions, 'mailboxes:manage');
    const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [selectedMailbox, setSelectedMailbox] = useState<Mailbox | null>(null);
    const [formData, setFormData] = useState({
        name: '', email: '', provider: 'SMTP',
        authorizedTeamIds: [] as string[], authorizedUserIds: [] as string[],
        smtpHost: '', smtpPort: '465', smtpSecure: true, smtpUser: '', smtpPass: '',
        imapHost: '', imapPort: '993', imapSecure: true, imapUser: '', imapPass: ''
    });
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
    const [testingSmtp, setTestingSmtp] = useState(false);
    const [testingImap, setTestingImap] = useState(false);

    useEffect(() => {
        fetchMailboxes(); fetchTeams(); fetchUsers();
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('success')) { setMessage({ text: t('google_connection_successful'), type: 'success' }); window.history.replaceState({}, document.title, window.location.pathname); }
        else if (urlParams.get('error')) { setMessage({ text: t('google_connection_failed'), type: 'error' }); window.history.replaceState({}, document.title, window.location.pathname); }
    }, []);

    const fetchMailboxes = async () => { try { const r = await api.get('/mailboxes'); setMailboxes(r.data); } catch (e) { console.error(e); } finally { setLoading(false); } };
    const fetchTeams = async () => { try { const r = await api.get('/teams'); setTeams(r.data); } catch (e) { console.error(e); } };
    const fetchUsers = async () => { try { const r = await api.get('/users'); setUsers(r.data); } catch (e) { console.error(e); } };

    const handleCreateOrUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const data = { ...formData, smtpPort: formData.smtpPort ? parseInt(formData.smtpPort) : null, imapPort: formData.imapPort ? parseInt(formData.imapPort) : null };
            if (modalMode === 'create') { await api.post('/mailboxes', data); setMessage({ text: t('mailbox_added_successfully'), type: 'success' }); }
            else { await api.patch(`/mailboxes/${selectedMailbox?.id}`, data); setMessage({ text: t('mailbox_updated_successfully'), type: 'success' }); }
            setShowModal(false); resetForm(); fetchMailboxes();
        } catch (e: any) { setMessage({ text: e.response?.data?.message || 'Error saving mailbox', type: 'error' }); }
    };

    const handleTestConnection = async (type: 'smtp' | 'imap') => {
        const isSmtp = type === 'smtp';
        if (isSmtp) setTestingSmtp(true); else setTestingImap(true);
        try {
            const data = { type, host: isSmtp ? formData.smtpHost : formData.imapHost, port: isSmtp ? formData.smtpPort : formData.imapPort, secure: isSmtp ? formData.smtpSecure : formData.imapSecure, user: isSmtp ? formData.smtpUser : formData.imapUser, pass: isSmtp ? formData.smtpPass : formData.imapPass };
            const r = await api.post('/mailboxes/test-connection', data);
            setMessage({ text: r.data.message, type: 'success' });
        } catch (e: any) { setMessage({ text: e.response?.data?.message || `Failed to test ${type.toUpperCase()} connection`, type: 'error' }); }
        finally { if (isSmtp) setTestingSmtp(false); else setTestingImap(false); }
    };

    const resetForm = () => setFormData({ name: '', email: '', provider: 'SMTP', authorizedTeamIds: [], authorizedUserIds: [], smtpHost: '', smtpPort: '465', smtpSecure: true, smtpUser: '', smtpPass: '', imapHost: '', imapPort: '993', imapSecure: true, imapUser: '', imapPass: '' });

    const mailboxesSkeleton = (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 animate-pulse">
            {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="rounded-lg border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                    <div className="mb-3 flex items-start justify-between">
                        <div className="h-10 w-10 rounded-lg bg-[var(--color-background)]" />
                        <div className="h-5 w-16 rounded-full bg-[var(--color-background)]" />
                    </div>
                    <div className="h-5 w-32 rounded-full bg-[var(--color-background)]" />
                    <div className="mt-2 h-4 w-40 rounded-full bg-[var(--color-background)]" />
                    <div className="mt-4 flex flex-wrap gap-2">
                        <div className="h-5 w-16 rounded-full bg-[var(--color-background)]" />
                        <div className="h-5 w-12 rounded-full bg-[var(--color-background)]" />
                        <div className="h-5 w-20 rounded-full bg-[var(--color-background)]" />
                    </div>
                </div>
            ))}
        </div>
    );

    const handleConnectGoogle = async () => {
        try { const teamIdParam = formData.authorizedTeamIds.length > 0 ? `?teamId=${formData.authorizedTeamIds[0]}` : ''; const r = await api.get(`/auth/google/url${teamIdParam}`); window.location.href = r.data.url; }
        catch (e) { console.error(e); setMessage({ text: 'Failed to initiate Google connection', type: 'error' }); }
    };

    const handleConnectMicrosoft = async () => {
        try { const teamIdParam = formData.authorizedTeamIds.length > 0 ? `?teamId=${formData.authorizedTeamIds[0]}` : ''; const r = await api.get(`/auth/microsoft/connect${teamIdParam}`); window.location.href = r.data.url; }
        catch (e) { console.error(e); setMessage({ text: 'Failed to initiate Microsoft connection', type: 'error' }); }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm(t('confirm_delete_mailbox'))) return;
        try { await api.delete(`/mailboxes/${id}`); setMessage({ text: t('mailbox_removed_successfully'), type: 'success' }); fetchMailboxes(); } catch (e) { console.error(e); }
    };

    const openEdit = (mb: Mailbox) => {
        setSelectedMailbox(mb); setModalMode('edit');
        setFormData({ name: mb.name, email: mb.email || '', provider: mb.provider, authorizedTeamIds: mb.authorizedTeams?.map(t => t.id) || [], authorizedUserIds: mb.authorizedUsers?.map(u => u.id) || [], smtpHost: mb.smtpHost || '', smtpPort: mb.smtpPort?.toString() || '465', smtpSecure: mb.smtpSecure, smtpUser: mb.smtpUser || '', smtpPass: mb.smtpPass || '', imapHost: mb.imapHost || '', imapPort: mb.imapPort?.toString() || '993', imapSecure: mb.imapSecure, imapUser: mb.imapUser || '', imapPass: mb.imapPass || '' });
        setShowModal(true);
    };

    const inputCls = "w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none bg-white transition-colors";

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <PageHeader title={t('mailboxes')} subtitle={t('manage_your_incoming_emails')}
                actions={canManage ? <button onClick={() => { setModalMode('create'); resetForm(); setShowModal(true); }} className="flex items-center px-4 py-2 bg-[var(--color-cta-primary)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-cta-secondary)] transition-colors"><Plus className="w-4 h-4 mr-2" />{t('add_mailbox')}</button> : null} />

            {message && (
                <div className={clsx("p-3 rounded-lg flex items-center justify-between border text-sm", message.type === 'success' ? "bg-[var(--color-background)] text-[var(--color-primary)] border-[var(--color-card-border)]" : "bg-red-50 text-red-800 border-red-100")}>
                    <span className="font-medium">{message.text}</span>
                    <button onClick={() => setMessage(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><X className="w-4 h-4" /></button>
                </div>
            )}

            {loading ? (
                mailboxesSkeleton
            ) : mailboxes.length === 0 ? (
                <div className="bg-white rounded-lg border-2 border-dashed border-[var(--color-card-border)] p-16 text-center">
                    <div className="bg-[var(--color-background)] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Inbox className="w-8 h-8 text-[var(--color-accent)]" /></div>
                    <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-1">{t('no_mailboxes_found')}</h3>
                    <p className="text-sm text-[var(--color-text-muted)]">{t('create_your_first_mailbox_to_start_receiving_emails')}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {mailboxes.map((mb) => (
                        <div key={mb.id} className="bg-white rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow p-5 group">
                            <div className="flex justify-between items-start mb-3">
                                <div className="p-2.5 bg-[var(--color-background)] rounded-lg text-[var(--color-primary)] group-hover:bg-[var(--color-primary)] group-hover:text-white transition-colors"><Mail className="w-5 h-5" /></div>
                                {canManage ? (
                                    <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => openEdit(mb)} className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-background)] rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                                        <button onClick={() => handleDelete(mb.id)} className="p-1.5 text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                ) : null}
                            </div>
                            <h3 className="text-lg font-bold text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors">{mb.name}</h3>
                            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{mb.email || mb.smtpHost || t('no_address_configured')}</p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                <span className="px-2 py-0.5 bg-[var(--color-background)] text-[var(--color-text-muted)] rounded-full text-[10px] font-semibold uppercase tracking-wider">{mb.provider}</span>
                                {mb.authorizedTeams?.map(team => (<span key={team.id} className="px-2 py-0.5 bg-[var(--color-background)] text-[var(--color-primary)] rounded-full text-[10px] font-semibold uppercase tracking-wider">{team.name}</span>))}
                                {mb.authorizedUsers?.map(user => (<span key={user.id} className="px-2 py-0.5 bg-[var(--color-background)] text-[var(--color-secondary)] rounded-full text-[10px] font-semibold uppercase tracking-wider">{user.fullName}</span>))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            <Modal isOpen={showModal && canManage} onClose={() => setShowModal(false)} size="lg" title={modalMode === 'create' ? t('add_mailbox') : t('edit_mailbox')}
                footer={<>
                    <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] rounded-lg">{t('cancel')}</button>
                    <button type="submit" form="mailbox-form" className="px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)]">{t('save')}</button>
                </>}>
                <form id="mailbox-form" onSubmit={handleCreateOrUpdate} className="space-y-6">
                    {/* General */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 pb-1.5 border-b border-[var(--color-card-border)]"><div className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)]" /><h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('general_settings')}</h3></div>
                        <div className="grid grid-cols-2 gap-3">
                            <div><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('mailbox_name')}</label><input type="text" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className={inputCls} placeholder="e.g. Support Team" /></div>
                            <div><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('mailbox_email')}</label><input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className={inputCls} placeholder="support@example.com" /></div>
                            <div className="col-span-2"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('assign_to_teams')}</label>
                                <div className="grid grid-cols-2 gap-1.5 p-2.5 border border-[var(--color-card-border)] rounded-lg max-h-28 overflow-y-auto">
                                    {teams.map(team => (<label key={team.id} className="flex items-center space-x-2 cursor-pointer hover:bg-[var(--color-background)]/50 p-1 rounded text-sm"><input type="checkbox" checked={formData.authorizedTeamIds.includes(team.id)} onChange={e => { const ids = e.target.checked ? [...formData.authorizedTeamIds, team.id] : formData.authorizedTeamIds.filter(id => id !== team.id); setFormData({ ...formData, authorizedTeamIds: ids }); }} className="rounded border-[var(--color-input-border)] text-[var(--color-primary)]" /><span className="text-[var(--color-text-primary)]">{team.name}</span></label>))}
                                </div>
                            </div>
                            <div className="col-span-2"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('assign_to_users')}</label>
                                <div className="grid grid-cols-2 gap-1.5 p-2.5 border border-[var(--color-card-border)] rounded-lg max-h-32 overflow-y-auto">
                                    {users.map(user => (<label key={user.id} className="flex items-center space-x-2 cursor-pointer hover:bg-[var(--color-background)]/50 p-1 rounded text-sm"><input type="checkbox" checked={formData.authorizedUserIds.includes(user.id)} onChange={e => { const ids = e.target.checked ? [...formData.authorizedUserIds, user.id] : formData.authorizedUserIds.filter(id => id !== user.id); setFormData({ ...formData, authorizedUserIds: ids }); }} className="rounded border-[var(--color-input-border)] text-[var(--color-primary)]" /><div><div className="text-[var(--color-text-primary)] font-medium leading-none">{user.fullName}</div><div className="text-[var(--color-text-muted)] text-[10px] mt-0.5">{user.email}</div></div></label>))}
                                </div>
                            </div>
                            <div className="col-span-2 pt-2">
                                <div className="flex items-center gap-2 pb-1.5 border-b border-[var(--color-card-border)] mb-3"><div className="w-1.5 h-1.5 rounded-full bg-amber-400" /><h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('fast_connect')}</h3></div>
                                <button type="button" onClick={handleConnectGoogle} className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white border border-[var(--color-card-border)] rounded-lg font-medium text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors">
                                    <img src="https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png" alt="Google" className="w-5 h-5" />{t('connect_with_google')}
                                </button>
                                <button type="button" onClick={handleConnectMicrosoft} className="mt-2 w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white border border-[var(--color-card-border)] rounded-lg font-medium text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors">
                                    <MicrosoftIcon />Connect with Microsoft
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* SMTP */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-center pb-1.5 border-b border-[var(--color-card-border)]">
                            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" /><h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('smtp_settings')}</h3></div>
                            <button type="button" onClick={() => handleTestConnection('smtp')} disabled={testingSmtp} className="text-[10px] font-semibold text-[var(--color-primary)] hover:text-[var(--color-secondary)] uppercase tracking-wider bg-[var(--color-background)] px-2 py-1 rounded hover:bg-[var(--color-background)]/80 transition-colors disabled:opacity-50">{testingSmtp ? t('testing') : t('test_connection')}</button>
                        </div>
                        <div className="grid grid-cols-6 gap-3">
                            <div className="col-span-4"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('smtp_host')}</label><input type="text" value={formData.smtpHost} onChange={e => setFormData({ ...formData, smtpHost: e.target.value })} className={inputCls} placeholder="smtp.gmail.com" /></div>
                            <div className="col-span-1"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('port')}</label><input type="text" value={formData.smtpPort} onChange={e => setFormData({ ...formData, smtpPort: e.target.value })} className={inputCls} placeholder="465" /></div>
                            <div className="col-span-1"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('ssl_tls')}</label><div className="h-[38px] flex items-center"><input type="checkbox" checked={formData.smtpSecure} onChange={e => setFormData({ ...formData, smtpSecure: e.target.checked })} className="w-5 h-5 text-[var(--color-primary)] rounded border-[var(--color-input-border)]" /></div></div>
                            <div className="col-span-3"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('smtp_user')}</label><input type="text" value={formData.smtpUser} onChange={e => setFormData({ ...formData, smtpUser: e.target.value })} className={inputCls} /></div>
                            <div className="col-span-3"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('smtp_pass')}</label><input type="password" value={formData.smtpPass} onChange={e => setFormData({ ...formData, smtpPass: e.target.value })} className={inputCls} /></div>
                        </div>
                    </div>

                    {/* IMAP */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-center pb-1.5 border-b border-[var(--color-card-border)]">
                            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-[var(--color-secondary)]" /><h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('imap_settings')}</h3></div>
                            <button type="button" onClick={() => handleTestConnection('imap')} disabled={testingImap} className="text-[10px] font-semibold text-[var(--color-primary)] hover:text-[var(--color-secondary)] uppercase tracking-wider bg-[var(--color-background)] px-2 py-1 rounded hover:bg-[var(--color-background)]/80 transition-colors disabled:opacity-50">{testingImap ? t('testing') : t('test_connection')}</button>
                        </div>
                        <div className="grid grid-cols-6 gap-3">
                            <div className="col-span-4"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('imap_host')}</label><input type="text" value={formData.imapHost} onChange={e => setFormData({ ...formData, imapHost: e.target.value })} className={inputCls} placeholder="imap.gmail.com" /></div>
                            <div className="col-span-1"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('port')}</label><input type="text" value={formData.imapPort} onChange={e => setFormData({ ...formData, imapPort: e.target.value })} className={inputCls} placeholder="993" /></div>
                            <div className="col-span-1"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('ssl_tls')}</label><div className="h-[38px] flex items-center"><input type="checkbox" checked={formData.imapSecure} onChange={e => setFormData({ ...formData, imapSecure: e.target.checked })} className="w-5 h-5 text-[var(--color-primary)] rounded border-[var(--color-input-border)]" /></div></div>
                            <div className="col-span-3"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('imap_user')}</label><input type="text" value={formData.imapUser} onChange={e => setFormData({ ...formData, imapUser: e.target.value })} className={inputCls} /></div>
                            <div className="col-span-3"><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1">{t('imap_pass')}</label><input type="password" value={formData.imapPass} onChange={e => setFormData({ ...formData, imapPass: e.target.value })} className={inputCls} /></div>
                        </div>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default MailboxesPage;

