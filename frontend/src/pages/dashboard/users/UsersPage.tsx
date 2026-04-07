import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Search, Mail, Shield, Trash2, Clock, X, CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import PageHeader from '../../../components/ui/PageHeader';
import Modal from '../../../components/ui/Modal';
import { canManageUsers, normalizeRole } from '../../../lib/rbac';
import { useAdaptiveRows } from '../../../hooks/useAdaptiveCount';

interface User {
    id: string; fullName: string; email: string; role: string;
    isActive: boolean; emailVerified: boolean; lastLogin: string | null;
}

interface PendingInvite {
    id: string;
    email: string;
    role: string;
    invitedBy: string | null;
    inviteDate: string;
    expiresAt?: string;
    status: 'pending';
}

type ActiveTab = 'users' | 'pending';

const UsersPage = () => {
    const { t } = useTranslation();
    const { user: currentUser } = useAuth();
    const currentRole = normalizeRole(currentUser?.role);
    const canManage = canManageUsers(currentRole);
    const roleRank = (role?: string) => ({ USER: 1, MANAGER: 2, ADMIN: 3 }[String(role || 'USER').toUpperCase()] || 0);
    const [users, setUsers] = useState<User[]>([]);
    const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
    const [loading, setLoading] = useState(true);
    const [pendingLoading, setPendingLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState<ActiveTab>('users');
    const [showInviteModal, setShowInviteModal] = useState(false);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
    const [formData, setFormData] = useState({ email: '', fullName: '', role: 'USER' });

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const r = await api.get('/users');
            const payload = r.data;
            setUsers(Array.isArray(payload) ? payload : (payload?.items || []));
        }
        catch (e) { console.error('Failed to fetch users:', e); setMessage({ text: t('failed_to_fetch_users'), type: 'error' }); }
        finally { setLoading(false); }
    };

    const fetchPendingInvites = async () => {
        if (!canManage) return;
        try {
            setPendingLoading(true);
            const response = await api.get('/invites/pending');
            setPendingInvites(response.data || []);
        } catch (e) {
            console.error('Failed to fetch pending invites:', e);
            setMessage({ text: 'Failed to fetch pending invites.', type: 'error' });
        } finally {
            setPendingLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
        if (canManage) {
            fetchPendingInvites();
        }
    }, [canManage]);

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/users/invite', formData);
            setMessage({ text: 'User invited successfully.', type: 'success' });
            setShowInviteModal(false);
            setFormData({ email: '', fullName: '', role: 'USER' });
            await Promise.all([fetchUsers(), fetchPendingInvites()]);
            setTimeout(() => setMessage(null), 5000);
        } catch (e) { console.error('Failed to invite user:', e); setMessage({ text: t('failed_to_invite_user'), type: 'error' }); }
    };

    const handleDeleteUser = async (userId: string) => {
        if (!window.confirm(t('confirm_delete_user'))) return;
        try { await api.delete(`/users/${userId}`); setMessage({ text: t('user_removed_successfully'), type: 'success' }); fetchUsers(); setTimeout(() => setMessage(null), 5000); }
        catch (e) { console.error('Failed to delete user:', e); setMessage({ text: t('failed_to_remove_user'), type: 'error' }); }
    };

    const handleRevokeInvite = async (inviteId: string) => {
        if (!window.confirm('Are you sure you want to revoke this invite?')) return;
        try {
            await api.delete(`/invites/${inviteId}`);
            setMessage({ text: 'Invite revoked successfully.', type: 'success' });
            await fetchPendingInvites();
            setTimeout(() => setMessage(null), 5000);
        } catch (e) {
            console.error('Failed to revoke invite:', e);
            setMessage({ text: 'Failed to revoke invite.', type: 'error' });
        }
    };

    const handleResendInvite = async (inviteId: string) => {
        try {
            await api.post(`/invites/${inviteId}/resend`);
            setMessage({ text: 'Invite resent successfully.', type: 'success' });
            await fetchPendingInvites();
            setTimeout(() => setMessage(null), 5000);
        } catch (e) {
            console.error('Failed to resend invite:', e);
            setMessage({ text: 'Failed to resend invite.', type: 'error' });
        }
    };

    const filteredUsers = users.filter((u) =>
        u.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || u.email.toLowerCase().includes(searchTerm.toLowerCase())
    );
    const filteredPendingInvites = pendingInvites.filter((invite) =>
        invite.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(invite.invitedBy || '').toLowerCase().includes(searchTerm.toLowerCase()),
    );
    const pendingInviteIds = useMemo(() => new Set(pendingInvites.map((invite) => invite.id)), [pendingInvites]);
    const activeUsers = canManage ? filteredUsers.filter((u) => !pendingInviteIds.has(u.id)) : filteredUsers;
    const pendingSkeletonRows = useAdaptiveRows({
        rowHeight: 54,
        minRows: 3,
        maxRows: 8,
        viewportOffset: 420,
    });
    const usersSkeletonRows = useAdaptiveRows({
        rowHeight: 58,
        minRows: 3,
        maxRows: 8,
        viewportOffset: 420,
    });

    const roleBadgeStyles: Record<string, string> = {
        ADMIN: 'bg-red-50 text-red-700 border-red-100',
        MANAGER: 'bg-amber-50 text-amber-700 border-amber-100',
        USER: 'bg-[var(--color-background)] text-[var(--color-primary)] border-[var(--color-card-border)]',
    };

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <PageHeader title={t('users')} subtitle={t('manage_users_description') || 'View and manage all members of your organization.'}
                actions={
                    canManage ? (
                        <button onClick={() => setShowInviteModal(true)} className="inline-flex items-center px-4 py-2 bg-[var(--color-cta-primary)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-cta-secondary)] transition-colors">
                            <UserPlus className="w-4 h-4 mr-2" /> {t('invite_user')}
                        </button>
                    ) : null
                }
            />

            {message && (
                <div className={`p-3 rounded-lg flex items-center gap-3 border text-sm ${message.type === 'success' ? 'bg-[var(--color-background)] border-[var(--color-card-border)] text-[var(--color-primary)]' : 'bg-red-50 border-red-100 text-red-800'}`}>
                    {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                    <span className="font-medium">{message.text}</span>
                    <button onClick={() => setMessage(null)} className="ml-auto opacity-50 hover:opacity-100"><X className="w-4 h-4" /></button>
                </div>
            )}

            <div className="bg-white rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] overflow-hidden">
                <div className="p-4 border-b border-[var(--color-card-border)]">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        {canManage ? (
                            <div className="inline-flex rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)] p-1">
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('users')}
                                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'users'
                                        ? 'bg-white text-[var(--color-text-primary)] border border-[var(--color-card-border)]'
                                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                                        }`}
                                >
                                    Users
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab('pending')}
                                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === 'pending'
                                        ? 'bg-white text-[var(--color-text-primary)] border border-[var(--color-card-border)]'
                                        : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                                        }`}
                                >
                                    Pending
                                </button>
                            </div>
                        ) : <div />}

                        <div className="relative w-full max-w-sm">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-accent)]" />
                            <input
                                type="text"
                                placeholder={activeTab === 'pending' ? 'Search pending invites...' : (t('search_users') || 'Search users...')}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-[var(--color-input-border)] rounded-lg text-sm focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none transition-colors"
                            />
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-[var(--color-card-border)]">
                                {activeTab === 'pending' ? (
                                    <>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">Email</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">{t('role')}</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">Invited By</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">Invite Date</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">{t('status')}</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-right bg-[var(--color-background)]/40">Actions</th>
                                    </>
                                ) : (
                                    <>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">{t('user')}</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">{t('role')}</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">{t('status')}</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] bg-[var(--color-background)]/40">{t('last_login')}</th>
                                        <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-right bg-[var(--color-background)]/40"></th>
                                    </>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--color-card-border)]">
                            {activeTab === 'pending' ? (
                                pendingLoading ? (
                                    Array.from({ length: pendingSkeletonRows }, (_, i) => (
                                        <tr key={i} className="animate-pulse">
                                            <td colSpan={6} className="px-5 py-4"><div className="w-full h-6 bg-[var(--color-background)]/40 rounded" /></td>
                                        </tr>
                                    ))
                                ) : filteredPendingInvites.length === 0 ? (
                                    <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-[var(--color-text-muted)]">No pending invites found</td></tr>
                                ) : filteredPendingInvites.map((invite) => (
                                    <tr key={invite.id} className="hover:bg-[var(--color-background)]/30 transition-colors">
                                        <td className="px-5 py-3.5">
                                            <div className="text-sm font-medium text-[var(--color-text-primary)]">{invite.email}</div>
                                        </td>
                                        <td className="px-5 py-3.5">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${roleBadgeStyles[invite.role] || roleBadgeStyles.USER}`}>{invite.role}</span>
                                        </td>
                                        <td className="px-5 py-3.5 text-sm text-[var(--color-text-muted)]">{invite.invitedBy || '-'}</td>
                                        <td className="px-5 py-3.5 text-sm text-[var(--color-text-muted)]">{new Date(invite.inviteDate).toLocaleDateString()}</td>
                                        <td className="px-5 py-3.5">
                                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Pending</span>
                                        </td>
                                        <td className="px-5 py-3.5 text-right">
                                            <div className="inline-flex items-center gap-2">
                                                <button
                                                    onClick={() => handleResendInvite(invite.id)}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors"
                                                >
                                                    Resend
                                                </button>
                                                <button
                                                    onClick={() => handleRevokeInvite(invite.id)}
                                                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    Revoke
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : loading ? (
                                Array.from({ length: usersSkeletonRows }, (_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="w-9 h-9 bg-[var(--color-background)] rounded-full" /><div className="space-y-1.5"><div className="w-28 h-3.5 bg-[var(--color-background)] rounded" /><div className="w-20 h-3 bg-[var(--color-background)]/60 rounded" /></div></div></td>
                                        <td colSpan={4} className="px-5 py-4"><div className="w-full h-6 bg-[var(--color-background)]/40 rounded" /></td>
                                    </tr>
                                ))
                            ) : activeUsers.length === 0 ? (
                                <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-[var(--color-text-muted)]">{t('no_users_found') || 'No users found'}</td></tr>
                            ) : activeUsers.map((user) => (
                                <tr key={user.id} className="hover:bg-[var(--color-background)]/30 transition-colors group">
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-[var(--color-background)] text-[var(--color-primary)] flex items-center justify-center font-bold text-sm">{user.fullName.charAt(0)}</div>
                                            <div>
                                                <div className="text-sm font-semibold text-[var(--color-text-primary)]">{user.fullName}</div>
                                                <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1"><Mail className="w-3 h-3" />{user.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-1.5">
                                            <Shield className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${roleBadgeStyles[user.role] || roleBadgeStyles.USER}`}>{t(user.role.toLowerCase())}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-1.5">
                                            <div className={`w-2 h-2 rounded-full ${user.isActive ? 'bg-[var(--color-accent)]' : 'bg-gray-300'}`} />
                                            <span className="text-xs font-medium text-[var(--color-text-muted)]">{user.isActive ? t('active') : t('inactive')}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                                            <Clock className="w-3.5 h-3.5" />{user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : t('never')}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5 text-right">
                                        {canManage && currentUser?.id !== user.id && roleRank(user.role) < roleRank(currentRole) && (
                                            <button onClick={() => handleDeleteUser(user.id)} className="p-1.5 text-[var(--color-text-muted)] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Invite Modal */}
            <Modal isOpen={showInviteModal && canManage} onClose={() => setShowInviteModal(false)} title={t('invite_user')}
                footer={<>
                    <button type="button" onClick={() => setShowInviteModal(false)} className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] rounded-lg transition-colors">{t('cancel')}</button>
                    <button type="submit" form="invite-form" className="px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors">{t('send_invitation')}</button>
                </>}>
                <form id="invite-form" onSubmit={handleInvite} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('full_name')}</label>
                        <input type="text" required value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} placeholder="John Doe"
                            className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('email_address')}</label>
                        <input type="email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="john@example.com"
                            className="w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('role')}</label>
                        <div className="grid grid-cols-3 gap-2">
                            {['ADMIN', 'MANAGER', 'USER'].filter(r => roleRank(r) < roleRank(currentRole)).map((r) => (
                                <button key={r} type="button" onClick={() => setFormData({ ...formData, role: r })}
                                    className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors ${formData.role === r
                                        ? 'bg-[var(--color-cta-primary)] border-[var(--color-cta-primary)] text-white'
                                        : 'bg-white border-[var(--color-card-border)] text-[var(--color-text-muted)] hover:border-[var(--color-input-focus)]'
                                        }`}>{t(r.toLowerCase())}</button>
                            ))}
                        </div>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default UsersPage;
