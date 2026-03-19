import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../../../../components/ui/Modal';

export interface TeamRecord {
    id: string;
    name: string;
    description: string;
    memberCount: number;
    mailboxCount: number;
    workloadCount?: number;
    members: string[];
    leadId?: string;
    linkedMailboxIds?: string[];
    createdAt?: string;
    status?: 'active' | 'deleted';
    teamRole?: 'lead' | 'member' | 'none';
}

interface TeamModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (team: TeamRecord) => void;
    team: TeamRecord | null;
    users: Array<{ id: string; fullName: string; isActive?: boolean }>;
}

const inputCls = 'w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-xl text-sm bg-white text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none';
const labelCls = 'block text-sm font-medium text-[var(--color-text-primary)] mb-1.5';

const EMPTY_TEAM: TeamRecord = {
    id: '',
    name: '',
    description: '',
    memberCount: 0,
    mailboxCount: 1,
    members: [],
    leadId: '',
};

export default function TeamModal({ isOpen, onClose, onSave, team, users }: TeamModalProps) {
    const [form, setForm] = useState<TeamRecord>(EMPTY_TEAM);

    useEffect(() => {
        if (!isOpen) return;
        if (team) {
            setForm({ ...team, leadId: team.leadId || '' });
            return;
        }
        setForm({ ...EMPTY_TEAM, id: `team-${Date.now()}` });
    }, [isOpen, team]);

    const activeUsers = useMemo(() => users.filter(u => u.isActive !== false), [users]);

    const toggleMember = (userId: string) => {
        setForm(prev => {
            const exists = prev.members.includes(userId);
            const nextMembers = exists ? prev.members.filter(id => id !== userId) : [...prev.members, userId];
            const nextLead = nextMembers.includes(prev.leadId || '') ? prev.leadId : '';
            return { ...prev, members: nextMembers, leadId: nextLead };
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = form.name.trim();
        if (!trimmedName) return;
        const payload: TeamRecord = {
            ...form,
            id: form.id || `team-${Date.now()}`,
            name: trimmedName,
            description: form.description.trim(),
            memberCount: form.members.length,
            leadId: form.leadId || undefined,
        };
        onSave(payload);
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={team ? 'Edit Team' : 'Create Team'}
            size="lg"
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="team-form"
                        className="px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors"
                    >
                        {team ? 'Save Changes' : 'Create Team'}
                    </button>
                </>
            }
        >
            <form id="team-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className={labelCls}>Team Name</label>
                    <input
                        type="text"
                        required
                        value={form.name}
                        onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                        className={inputCls}
                        placeholder="Support"
                    />
                </div>

                <div>
                    <label className={labelCls}>Description</label>
                    <textarea
                        rows={3}
                        value={form.description ?? ''}
                        onChange={(e) => setForm(prev => ({ ...prev, description: e.target.value }))}
                        className={`${inputCls} resize-y min-h-[88px]`}
                        placeholder="Customer support team"
                    />
                </div>

                <div>
                    <label className={labelCls}>Members</label>
                    <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/30 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                        {activeUsers.map(user => (
                            <label
                                key={user.id}
                                className="flex items-center gap-2 rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 cursor-pointer hover:bg-[var(--color-background)]/40 transition-colors"
                            >
                                <input
                                    type="checkbox"
                                    checked={form.members.includes(user.id)}
                                    onChange={() => toggleMember(user.id)}
                                    className="rounded border-[var(--color-card-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                                />
                                <span className="text-sm text-[var(--color-text-primary)]">{user.fullName}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Team Lead</label>
                        <select
                            value={form.leadId || ''}
                            onChange={(e) => setForm(prev => ({ ...prev, leadId: e.target.value }))}
                            className={inputCls}
                            disabled={form.members.length === 0}
                        >
                            <option value="">None</option>
                            {activeUsers
                                .filter(user => form.members.includes(user.id))
                                .map(user => (
                                    <option key={user.id} value={user.id}>{user.fullName}</option>
                                ))}
                        </select>
                    </div>

                    <div>
                        <label className={labelCls}>Mailbox Count</label>
                        <input
                            type="number"
                            min={0}
                            value={form.mailboxCount}
                            onChange={(e) => setForm(prev => ({ ...prev, mailboxCount: Math.max(0, Number(e.target.value) || 0) }))}
                            className={inputCls}
                        />
                    </div>
                </div>
            </form>
        </Modal>
    );
}
