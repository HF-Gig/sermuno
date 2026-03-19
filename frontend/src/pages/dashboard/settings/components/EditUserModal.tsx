import React, { useEffect, useState } from 'react';
import Modal from '../../../../components/ui/Modal';

const COMMON_TIMEZONES = ['UTC', 'Europe/Amsterdam', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Dubai'];
const LOCALES = [
    { value: 'en', label: 'English' },
    { value: 'nl', label: 'Dutch' },
];
const ROLES = ['ADMIN', 'MANAGER', 'USER'];

interface UserData {
    id: string;
    fullName: string;
    email: string;
    role: string;
    timezone: string;
    locale: string;
}

interface EditUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    user: UserData | null;
    onSave: (user: UserData) => void;
    allowedRoles?: string[];
}

const inputCls = 'w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-xl text-sm bg-white text-[var(--color-text-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:outline-none';
const labelCls = 'block text-sm font-medium text-[var(--color-text-primary)] mb-1.5';

export default function EditUserModal({ isOpen, onClose, user, onSave, allowedRoles = ROLES }: EditUserModalProps) {
    const [form, setForm] = useState<UserData>({ id: '', fullName: '', email: '', role: 'USER', timezone: 'UTC', locale: 'en' });

    useEffect(() => {
        if (isOpen && user) {
            setForm({ ...user });
        }
    }, [isOpen, user]);

    const update = (key: keyof UserData, value: string) => setForm(prev => ({ ...prev, [key]: value }));

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(form);
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Edit User"
            size="md"
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
                        form="edit-user-form"
                        className="px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors"
                    >
                        Save Changes
                    </button>
                </>
            }
        >
            <form id="edit-user-form" onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className={labelCls}>Full Name</label>
                    <input
                        type="text"
                        required
                        value={form.fullName}
                        onChange={(e) => update('fullName', e.target.value)}
                        className={inputCls}
                    />
                </div>

                <div>
                    <label className={labelCls}>Email</label>
                    <input
                        type="email"
                        value={form.email}
                        disabled
                        className={`${inputCls} bg-[var(--color-background)] text-[var(--color-text-muted)] cursor-not-allowed`}
                    />
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">Email cannot be changed after account creation.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Role</label>
                        <select
                            value={form.role}
                            onChange={(e) => update('role', e.target.value)}
                            className={inputCls}
                        >
                            {allowedRoles.map(r => (
                                <option key={r} value={r}>{r}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelCls}>Locale</label>
                        <select
                            value={form.locale}
                            onChange={(e) => update('locale', e.target.value)}
                            className={inputCls}
                        >
                            {LOCALES.map(l => (
                                <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div>
                    <label className={labelCls}>Timezone</label>
                    <select
                        value={form.timezone}
                        onChange={(e) => update('timezone', e.target.value)}
                        className={inputCls}
                    >
                        {COMMON_TIMEZONES.map(tz => (
                            <option key={tz} value={tz}>{tz}</option>
                        ))}
                    </select>
                </div>
            </form>
        </Modal>
    );
}
