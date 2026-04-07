import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../../lib/api';
import { Users, Plus, Edit2, Trash2, UserPlus, X, Inbox, Wand2 } from 'lucide-react';
import { clsx } from 'clsx';
import PageHeader from '../../../components/ui/PageHeader';
import Modal from '../../../components/ui/Modal';
import { hasPermission } from '../../../hooks/usePermission';
import { useAuth } from '../../../context/AuthContext';
import { useAdaptiveGridCount } from '../../../hooks/useAdaptiveCount';

interface Mailbox { id: string; name: string; email: string; teamId: string | null; }
interface TeamRule { id: string; name: string; trigger: string; priorityLevel: number; isActive: boolean; conditions: any; actions: any; }
interface Team { id: string; name: string; description: string | null; mailboxes?: Mailbox[]; authorizedMailboxes?: Mailbox[]; _count?: { members: number; }; }
interface TeamMember { id: string; userId: string; role: string; user: { id: string; fullName: string; email: string; }; }
interface TeamDetail extends Team { members: TeamMember[]; authorizedMailboxes?: Mailbox[]; }

const TeamsPage = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const canCreateTeam = hasPermission(user?.permissions, 'teams:create');
    const [teams, setTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
    const [formData, setFormData] = useState({ name: '', description: '' });
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
    const [showMembersModal, setShowMembersModal] = useState(false);
    const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
    const [availableUsers, setAvailableUsers] = useState<{ id: string, fullName: string, email: string }[]>([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [showMailboxesModal, setShowMailboxesModal] = useState(false);
    const [availableMailboxes, setAvailableMailboxes] = useState<Mailbox[]>([]);
    const [selectedMailboxId, setSelectedMailboxId] = useState('');
    const [showRulesModal, setShowRulesModal] = useState(false);
    const [teamRules, setTeamRules] = useState<TeamRule[]>([]);
    const [ruleForm, setRuleForm] = useState({ name: '', trigger: 'INCOMING_EMAIL', conditions: '{\n  "match": "all"\n}', actions: '{\n  "assignTeam": true\n}' });
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

    useEffect(() => { fetchTeams(); }, []);

    const fetchTeams = async () => {
        try {
            const r = await api.get('/teams');
            setTeams(r.data);
            return r.data as Team[];
        } catch (e) {
            console.error('Failed to fetch teams:', e);
            return [] as Team[];
        } finally { setLoading(false); }
    };

    const handleCreateOrUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            if (modalMode === 'create') { await api.post('/teams', formData); setMessage({ text: t('team_created_successfully'), type: 'success' }); }
            else { await api.patch(`/teams/${selectedTeam?.id}`, formData); setMessage({ text: t('team_updated_successfully'), type: 'success' }); }
            setShowModal(false); setFormData({ name: '', description: '' }); fetchTeams();
        } catch (e: any) { setMessage({ text: e.response?.data?.message || 'Error saving team', type: 'error' }); }
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm(t('are_you_sure_you_want_to_delete_this_team'))) return;
        try { await api.delete(`/teams/${id}`); setMessage({ text: t('team_deleted_successfully'), type: 'success' }); fetchTeams(); } catch (e) { console.error(e); }
    };

    const openManageMembers = async (team: Team) => {
        setSelectedTeam(team); setShowMembersModal(true);
        try {
            const [membersRes, usersRes] = await Promise.all([api.get(`/teams/${team.id}`), api.get('/users')]);
            setTeamMembers(membersRes.data.members);
            const ids = membersRes.data.members.map((m: TeamMember) => m.userId);
            setAvailableUsers(usersRes.data.filter((u: any) => !ids.includes(u.id)));
        } catch (e) { console.error(e); }
    };

    const handleAddMember = async () => {
        if (!selectedUserId || !selectedTeam) return;
        try { await api.post(`/teams/${selectedTeam.id}/members`, { userId: selectedUserId }); setMessage({ text: t('member_added_successfully'), type: 'success' }); setSelectedUserId(''); openManageMembers(selectedTeam); fetchTeams(); } catch (e) { console.error(e); }
    };

    const handleRemoveMember = async (userId: string) => {
        if (!selectedTeam) return;
        try { await api.delete(`/teams/${selectedTeam.id}/members/${userId}`); setMessage({ text: t('member_removed_successfully'), type: 'success' }); openManageMembers(selectedTeam); fetchTeams(); } catch (e) { console.error(e); }
    };

    const handleUpdateMemberRole = async (userId: string, role: 'lead' | 'member') => {
        if (!selectedTeam) return;
        try {
            await api.patch(`/teams/${selectedTeam.id}/members/${userId}`, { role });
            setTeamMembers(prev => prev.map(member => member.userId === userId ? { ...member, role } : member));
            setMessage({ text: t('team_role_updated', 'Team role updated successfully'), type: 'success' });
            fetchTeams();
        } catch (e: any) {
            setMessage({ text: e.response?.data?.message || t('failed_to_update_team_role', 'Failed to update team role'), type: 'error' });
        }
    };

    const openManageMailboxes = async (team: Team) => {
        setSelectedTeam(team); setShowMailboxesModal(true);
        try {
            const r = await api.get('/mailboxes');
            const assignedMailboxIds = new Set((team.authorizedMailboxes || team.mailboxes || []).map((mailbox) => mailbox.id));
            setAvailableMailboxes(r.data.filter((m: Mailbox) => !assignedMailboxIds.has(m.id)));
        } catch (e) { console.error(e); }
    };

    const syncTeamMailboxAccess = async (teamId: string, nextMailboxIds: string[]) => {
        const teamResponse = await api.get(`/teams/${teamId}`);
        const teamDetail = teamResponse.data as TeamDetail;
        const memberIds = (teamDetail.members || []).map(member => member.userId);
        const leadId = (teamDetail.members || []).find(member => member.role === 'lead')?.userId;

        await api.patch(`/teams/${teamId}`, {
            name: teamDetail.name,
            description: teamDetail.description || '',
            members: memberIds,
            leadId,
            linkedMailboxIds: nextMailboxIds,
        });
    };

    const openManageRules = async (team: Team) => {
        setSelectedTeam(team);
        setShowRulesModal(true);
        setEditingRuleId(null);
        setRuleForm({ name: '', trigger: 'INCOMING_EMAIL', conditions: '{\n  "match": "all"\n}', actions: '{\n  "assignTeam": true\n}' });
        try {
            const r = await api.get(`/rules?teamId=${team.id}`);
            setTeamRules(r.data || []);
        } catch (e) {
            console.error(e);
            setMessage({ text: 'Failed to load team rules', type: 'error' });
        }
    };

    const handleSaveRule = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTeam) return;

        try {
            const payload = {
                teamId: selectedTeam.id,
                name: ruleForm.name,
                trigger: ruleForm.trigger,
                priorityLevel: 2,
                conditions: JSON.parse(ruleForm.conditions),
                actions: JSON.parse(ruleForm.actions),
            };

            if (editingRuleId) {
                await api.patch(`/rules/${editingRuleId}`, payload);
                setMessage({ text: 'Team rule updated successfully', type: 'success' });
            } else {
                await api.post('/rules', payload);
                setMessage({ text: 'Team rule created successfully', type: 'success' });
            }

            openManageRules(selectedTeam);
        } catch (e: any) {
            setMessage({ text: e.response?.data?.message || 'Failed to save team rule', type: 'error' });
        }
    };

    const handleEditRule = (rule: TeamRule) => {
        setEditingRuleId(rule.id);
        setRuleForm({
            name: rule.name,
            trigger: rule.trigger,
            conditions: JSON.stringify(rule.conditions ?? {}, null, 2),
            actions: JSON.stringify(rule.actions ?? {}, null, 2),
        });
    };

    const handleDeleteRule = async (ruleId: string) => {
        if (!selectedTeam) return;
        try {
            await api.delete(`/rules/${ruleId}`);
            setMessage({ text: 'Team rule deleted successfully', type: 'success' });
            openManageRules(selectedTeam);
        } catch (e: any) {
            setMessage({ text: e.response?.data?.message || 'Failed to delete team rule', type: 'error' });
        }
    };

    const handleAddMailbox = async () => {
        if (!selectedMailboxId || !selectedTeam) return;
        try {
            const existingMailboxIds = (selectedTeam.authorizedMailboxes || selectedTeam.mailboxes || []).map(mailbox => mailbox.id);
            await syncTeamMailboxAccess(selectedTeam.id, [...new Set([...existingMailboxIds, selectedMailboxId])]);
            setMessage({ text: t('mailbox_added_successfully'), type: 'success' });
            setSelectedMailboxId('');
            const refreshedTeams = await fetchTeams();
            const refreshedTeam = refreshedTeams.find(team => team.id === selectedTeam.id) || selectedTeam;
            openManageMailboxes(refreshedTeam);
        } catch (e) { console.error(e); }
    };

    const handleRemoveMailbox = async (mailboxId: string) => {
        if (!selectedTeam) return;
        try {
            const existingMailboxIds = (selectedTeam.authorizedMailboxes || selectedTeam.mailboxes || []).map(mailbox => mailbox.id);
            await syncTeamMailboxAccess(selectedTeam.id, existingMailboxIds.filter(id => id !== mailboxId));
            setMessage({ text: t('mailbox_removed_successfully'), type: 'success' });
            const refreshedTeams = await fetchTeams();
            const refreshedTeam = refreshedTeams.find(team => team.id === selectedTeam.id) || selectedTeam;
            openManageMailboxes(refreshedTeam);
        } catch (e) { console.error(e); }
    };

    const inputCls = "w-full px-3 py-2 border border-[var(--color-input-border)] rounded-lg text-sm focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none bg-white transition-colors";
    const selectCls = inputCls;
    const teamSkeletonCards = useAdaptiveGridCount({
        columns: 3,
        rowHeight: 260,
        minRows: 1,
        maxRows: 2,
        viewportOffset: 320,
    });

    const teamsSkeleton = (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 animate-pulse">
            {Array.from({ length: teamSkeletonCards }, (_, index) => (
                <div key={index} className="rounded-lg border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)]">
                    <div className="mb-4 flex items-start justify-between">
                        <div className="h-10 w-10 rounded-lg bg-[var(--color-background)]" />
                        <div className="h-5 w-14 rounded-full bg-[var(--color-background)]" />
                    </div>
                    <div className="h-5 w-32 rounded-full bg-[var(--color-background)]" />
                    <div className="mt-2 h-4 w-11/12 rounded-full bg-[var(--color-background)]" />
                    <div className="mt-2 h-4 w-8/12 rounded-full bg-[var(--color-background)]" />
                    <div className="mt-5 space-y-4 border-t border-[var(--color-card-border)] pt-4">
                        <div className="flex items-center justify-between">
                            <div className="h-3 w-20 rounded-full bg-[var(--color-background)]" />
                            <div className="h-4 w-28 rounded-full bg-[var(--color-background)]" />
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="h-3 w-16 rounded-full bg-[var(--color-background)]" />
                            <div className="h-4 w-32 rounded-full bg-[var(--color-background)]" />
                        </div>
                        <div className="space-y-2">
                            <div className="h-3 w-full rounded-full bg-[var(--color-background)]" />
                            <div className="h-3 w-10/12 rounded-full bg-[var(--color-background)]" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

    const canManageTeam = (team: Team) => {
        if (hasPermission(user?.permissions, 'teams:manage')) return true;
        const membership = (team as any).members?.find((member: any) => member.userId === user?.id);
        return membership?.role === 'lead';
    };

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <PageHeader title={t('teams')} subtitle={t('organize_users_into_teams')}
                actions={
                    canCreateTeam ? (
                        <button onClick={() => { setModalMode('create'); setFormData({ name: '', description: '' }); setShowModal(true); }}
                            className="flex items-center px-4 py-2 bg-[var(--color-cta-primary)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-cta-secondary)] transition-colors">
                            <Plus className="w-4 h-4 mr-2" /> {t('create_team')}
                        </button>
                    ) : null
                }
            />

            {message && (
                <div className={clsx("p-3 rounded-lg flex items-center justify-between border text-sm",
                    message.type === 'success' ? "bg-[var(--color-background)] text-[var(--color-primary)] border-[var(--color-card-border)]" : "bg-red-50 text-red-800 border-red-100")}>
                    <span className="font-medium">{message.text}</span>
                    <button onClick={() => setMessage(null)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"><X className="w-4 h-4" /></button>
                </div>
            )}

            {loading ? (
                teamsSkeleton
            ) : teams.length === 0 ? (
                <div className="bg-white rounded-lg border-2 border-dashed border-[var(--color-card-border)] p-16 text-center">
                    <div className="bg-[var(--color-background)] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Users className="w-8 h-8 text-[var(--color-accent)]" /></div>
                    <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-1">{t('no_teams_found')}</h3>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {teams.map((team) => (
                        <div key={team.id} className="bg-white rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] transition-shadow p-5 group">
                            <div className="flex justify-between items-start mb-3">
                                <div className="p-2.5 bg-[var(--color-background)] rounded-lg text-[var(--color-primary)] group-hover:bg-[var(--color-primary)] group-hover:text-white transition-colors">
                                    <Users className="w-5 h-5" />
                                </div>
                                {canManageTeam(team) && (
                                    <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => { setSelectedTeam(team); setModalMode('edit'); setFormData({ name: team.name, description: team.description || '' }); setShowModal(true); }}
                                            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-background)] rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                                        <button onClick={() => handleDelete(team.id)}
                                            className="p-1.5 text-[var(--color-text-muted)] hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                )}
                            </div>
                            <h3 className="text-lg font-bold text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors">{team.name}</h3>
                            <p className="text-sm text-[var(--color-text-muted)] mt-1 line-clamp-2 h-10">{team.description || t('no_description_provided')}</p>
                            <div className="mt-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{team._count?.members || 0} {t('members')}</span>
                                    {canManageTeam(team) && <button onClick={() => openManageMembers(team)} className="text-sm font-semibold text-[var(--color-primary)] hover:text-[var(--color-secondary)]">{t('manage_members')}</button>}
                                </div>
                                <div className="pt-3 border-t border-[var(--color-card-border)]">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">{t('mailboxes')}</span>
                                        {canManageTeam(team) && <button onClick={() => openManageMailboxes(team)} className="text-sm font-semibold text-[var(--color-primary)] hover:text-[var(--color-secondary)]">{t('manage_mailboxes')}</button>}
                                    </div>
                                    <div className="space-y-1">
                                        {(team.authorizedMailboxes || team.mailboxes) && (team.authorizedMailboxes || team.mailboxes)!.length > 0 ? (team.authorizedMailboxes || team.mailboxes)!.map(m => (
                                            <div key={m.id} className="text-xs text-[var(--color-text-muted)] flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-[var(--color-accent)]" />{m.name} ({m.email})</div>
                                        )) : <div className="text-xs text-[var(--color-text-muted)]/60 italic">{t('no_mailboxes_assigned')}</div>}
                                    </div>
                                </div>
                                <div className="pt-3 border-t border-[var(--color-card-border)]">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Team Rules</span>
                                        {canManageTeam(team) && <button onClick={() => openManageRules(team)} className="text-sm font-semibold text-[var(--color-primary)] hover:text-[var(--color-secondary)]">Manage rules</button>}
                                    </div>
                                    <div className="text-xs text-[var(--color-text-muted)]">Priority level 2 team automations scoped to mailbox workflows.</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Create/Edit Modal */}
            <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={modalMode === 'create' ? t('create_team') : t('edit_team')}
                footer={<>
                    <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] rounded-lg">{t('cancel')}</button>
                    <button type="submit" form="team-form" className="px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)]">{t('save')}</button>
                </>}>
                <form id="team-form" onSubmit={handleCreateOrUpdate} className="space-y-4">
                    <div><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('team_name')}</label><input type="text" required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className={inputCls} /></div>
                    <div><label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('team_description')}</label><textarea rows={3} value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} className={inputCls + ' resize-none'} /></div>
                </form>
            </Modal>

            {/* Members Modal */}
            <Modal isOpen={showMembersModal} size="lg" onClose={() => setShowMembersModal(false)} title={t('manage_members') + (selectedTeam ? ` — ${selectedTeam.name}` : '')}>
                <div className="bg-[var(--color-background)]/50 p-4 rounded-lg mb-4 flex items-end space-x-3">
                    <div className="flex-1"><label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">{t('add_member_to_team')}</label>
                        <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className={selectCls}>
                            <option value="">{t('select_a_user')}</option>{availableUsers.map(u => <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>)}
                        </select>
                    </div>
                    <button onClick={handleAddMember} disabled={!selectedUserId} className="px-3 py-2 bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)] disabled:opacity-50 h-[38px]"><UserPlus className="w-4 h-4" /></button>
                </div>
                <div className="space-y-2">
                    {teamMembers.map(m => (
                        <div key={m.id} className="flex items-center justify-between p-3 border border-[var(--color-card-border)] rounded-lg hover:bg-[var(--color-background)]/30 transition-colors">
                            <div className="flex items-center space-x-3">
                                <div className="w-9 h-9 rounded-full bg-[var(--color-background)] text-[var(--color-primary)] flex items-center justify-center font-bold text-sm">{m.user.fullName.charAt(0)}</div>
                                <div><div className="text-sm font-semibold text-[var(--color-text-primary)]">{m.user.fullName}</div><div className="text-xs text-[var(--color-text-muted)]">{m.user.email}</div></div>
                            </div>
                            <div className="flex items-center space-x-3">
                                <select
                                    value={m.role}
                                    onChange={(e) => handleUpdateMemberRole(m.userId, e.target.value as 'lead' | 'member')}
                                    className="px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border border-[var(--color-card-border)] bg-white text-[var(--color-text-primary)]"
                                >
                                    <option value="member">{t('team_member')}</option>
                                    <option value="lead">{t('team_lead')}</option>
                                </select>
                                <button onClick={() => handleRemoveMember(m.userId)} className="p-1.5 text-[var(--color-text-muted)] hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                        </div>
                    ))}
                </div>
            </Modal>

            {/* Mailboxes Modal */}
            <Modal isOpen={showMailboxesModal} size="lg" onClose={() => setShowMailboxesModal(false)} title={t('manage_mailboxes') + (selectedTeam ? ` — ${selectedTeam.name}` : '')}>
                <div className="bg-[var(--color-background)]/50 p-4 rounded-lg mb-4 flex items-end space-x-3">
                    <div className="flex-1"><label className="block text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">{t('add_mailbox')}</label>
                        <select value={selectedMailboxId} onChange={e => setSelectedMailboxId(e.target.value)} className={selectCls}>
                            <option value="">{t('select_a_mailbox')}</option>{availableMailboxes.map(m => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
                        </select>
                    </div>
                    <button onClick={handleAddMailbox} disabled={!selectedMailboxId} className="px-3 py-2 bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)] disabled:opacity-50 h-[38px]"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="space-y-2">
                    {selectedTeam?.mailboxes?.map(m => (
                        <div key={m.id} className="flex items-center justify-between p-3 border border-[var(--color-card-border)] rounded-lg hover:bg-[var(--color-background)]/30 transition-colors">
                            <div className="flex items-center space-x-3">
                                <div className="w-9 h-9 rounded-full bg-[var(--color-background)] text-[var(--color-primary)] flex items-center justify-center"><Inbox className="w-4 h-4" /></div>
                                <div><div className="text-sm font-semibold text-[var(--color-text-primary)]">{m.name}</div><div className="text-xs text-[var(--color-text-muted)]">{m.email || t('no_address_configured')}</div></div>
                            </div>
                            <button onClick={() => handleRemoveMailbox(m.id)} className="p-1.5 text-[var(--color-text-muted)] hover:text-red-600 transition-colors"><Trash2 className="w-4 h-4" /></button>
                        </div>
                    ))}
                </div>
            </Modal>

            <Modal isOpen={showRulesModal} size="xl" onClose={() => setShowRulesModal(false)} title={`Manage Team Rules${selectedTeam ? ` — ${selectedTeam.name}` : ''}`}>
                <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="space-y-3">
                        {teamRules.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-[var(--color-card-border)] bg-[var(--color-background)]/30 p-6 text-sm text-[var(--color-text-muted)]">
                                No team rules yet.
                            </div>
                        ) : teamRules.map(rule => (
                            <div key={rule.id} className="rounded-lg border border-[var(--color-card-border)] bg-white p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <Wand2 className="h-4 w-4 text-[var(--color-primary)]" />
                                            <span className="text-sm font-semibold text-[var(--color-text-primary)]">{rule.name}</span>
                                        </div>
                                        <div className="mt-1 text-xs text-[var(--color-text-muted)]">{rule.trigger} · Priority level {rule.priorityLevel}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button type="button" onClick={() => handleEditRule(rule)} className="rounded-lg border border-[var(--color-card-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">Edit</button>
                                        <button type="button" onClick={() => handleDeleteRule(rule.id)} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">Delete</button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <form onSubmit={handleSaveRule} className="rounded-lg border border-[var(--color-card-border)] bg-[var(--color-background)]/40 p-4 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Rule Name</label>
                            <input type="text" required value={ruleForm.name} onChange={e => setRuleForm(prev => ({ ...prev, name: e.target.value }))} className={inputCls} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Trigger</label>
                            <select value={ruleForm.trigger} onChange={e => setRuleForm(prev => ({ ...prev, trigger: e.target.value }))} className={selectCls}>
                                <option value="INCOMING_EMAIL">Incoming email</option>
                                <option value="TICKET_CREATED">Ticket created</option>
                                <option value="TICKET_UPDATED">Ticket updated</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Conditions JSON</label>
                            <textarea rows={5} value={ruleForm.conditions} onChange={e => setRuleForm(prev => ({ ...prev, conditions: e.target.value }))} className={inputCls + ' resize-y'} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Actions JSON</label>
                            <textarea rows={5} value={ruleForm.actions} onChange={e => setRuleForm(prev => ({ ...prev, actions: e.target.value }))} className={inputCls + ' resize-y'} />
                        </div>
                        <div className="flex items-center justify-between">
                            <button type="button" onClick={() => { setEditingRuleId(null); setRuleForm({ name: '', trigger: 'INCOMING_EMAIL', conditions: '{\n  "match": "all"\n}', actions: '{\n  "assignTeam": true\n}' }); }} className="px-3 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-white rounded-lg">Reset</button>
                            <button type="submit" className="px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)]">{editingRuleId ? 'Update Rule' : 'Create Rule'}</button>
                        </div>
                    </form>
                </div>
            </Modal>
        </div>
    );
};

export default TeamsPage;
