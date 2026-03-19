import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Shield } from 'lucide-react';
import Modal from '../../../../components/ui/Modal';

export type InviteRole = 'admin' | 'manager' | 'user';

type InviteRoleOption = {
    value: InviteRole;
    label: string;
    subtitle: string;
};

const ROLE_OPTIONS: InviteRoleOption[] = [
    { value: 'admin', label: 'Admin', subtitle: 'Level 3' },
    { value: 'manager', label: 'Manager', subtitle: 'Level 2' },
    { value: 'user', label: 'User', subtitle: 'Level 1' },
];

interface InviteUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInvite: (payload: { email: string; role: InviteRole }) => Promise<void>;
}

export default function InviteUserModal({ isOpen, onClose, onInvite }: InviteUserModalProps) {
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<InviteRole>('user');
    const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
    const [openUpward, setOpenUpward] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const menuRef = useRef<HTMLDivElement>(null);

    const activeRole = useMemo(
        () => ROLE_OPTIONS.find(option => option.value === role) ?? ROLE_OPTIONS[2],
        [role]
    );

    useEffect(() => {
        if (!isOpen) return;
        setEmail('');
        setRole('user');
        setError('');
        setLoading(false);
        setIsRoleMenuOpen(false);
    }, [isOpen]);

    useEffect(() => {
        if (!isRoleMenuOpen) return;

        const rect = menuRef.current?.getBoundingClientRect();
        if (rect) {
            const viewportHeight = window.innerHeight;
            const estimatedMenuHeight = 176;
            const spaceBelow = viewportHeight - rect.bottom;
            const spaceAbove = rect.top;
            setOpenUpward(spaceBelow < estimatedMenuHeight && spaceAbove > spaceBelow);
        }

        const handleClickOutside = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) {
                setIsRoleMenuOpen(false);
            }
        };
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsRoleMenuOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isRoleMenuOpen]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setError('');
        setLoading(true);
        try {
            await onInvite({ email, role });
            onClose();
        } catch (err: any) {
            setError(err?.message || 'Failed to send invitation');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => !loading && onClose()}
            title="Invite User"
            size="md"
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] rounded-lg transition-colors disabled:opacity-60"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="invite-user-modal-form"
                        disabled={loading || !email.trim()}
                        className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors disabled:opacity-60"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        {loading ? 'Sending...' : 'Send Invitation'}
                    </button>
                </>
            }
        >
            <form id="invite-user-modal-form" onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {error}
                    </div>
                )}

                <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                        Email
                    </label>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="agent@company.com"
                        className="w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-xl text-sm bg-white text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                        Role
                    </label>
                    <div className="relative" ref={menuRef}>
                        <button
                            type="button"
                            onClick={() => {
                                setOpenUpward(false);
                                setIsRoleMenuOpen(prev => !prev);
                            }}
                            className="w-full flex items-center justify-between rounded-xl border border-[var(--color-card-border)] bg-white px-3 py-2.5 shadow-sm hover:bg-[var(--color-background)]/40 transition-colors"
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                <Shield className="w-4 h-4 text-[var(--color-primary)] shrink-0" />
                                <div className="text-left min-w-0">
                                    <div className="text-sm font-medium text-[var(--color-text-primary)]">{activeRole.label}</div>
                                    <div className="text-xs text-[var(--color-text-muted)]">{activeRole.subtitle}</div>
                                </div>
                            </div>
                            <ChevronDown className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform ${isRoleMenuOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {isRoleMenuOpen && (
                            <div className={`absolute z-20 w-full rounded-xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-lg)] p-1.5 ${openUpward ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
                                {ROLE_OPTIONS.map(option => {
                                    const active = option.value === role;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => {
                                                setRole(option.value);
                                                setIsRoleMenuOpen(false);
                                            }}
                                            className={`w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors ${active
                                                ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]'
                                                : 'hover:bg-[var(--color-background)]/50 text-[var(--color-text-primary)]'}`}
                                        >
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium">{option.label}</div>
                                                <div className="text-xs text-[var(--color-text-muted)]">{option.subtitle}</div>
                                            </div>
                                            {active ? (
                                                <Check className="w-4 h-4 text-[var(--color-primary)] shrink-0" />
                                            ) : (
                                                <span className="w-4 h-4 shrink-0" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </form>
        </Modal>
    );
}
