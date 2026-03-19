import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { resolveAvatarUrl } from '../../lib/api';
import { canManageOrgArea } from '../../lib/rbac';

interface ProfilePopoverProps {
    isOpen: boolean;
    onClose: () => void;
    isCollapsed: boolean;
    onCloseSidebar?: () => void;
}

const ProfilePopover: React.FC<ProfilePopoverProps> = ({ isOpen, onClose, isCollapsed, onCloseSidebar }) => {
    const { t } = useTranslation();
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const ref = useRef<HTMLDivElement>(null);
    const canOpenOrganizationSettings = canManageOrgArea(user?.role);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen, onClose]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const menuItem = "flex items-center gap-3 w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors";

    return (
        <div
            ref={ref}
            className="absolute bottom-16 left-2 z-[60] w-64 bg-white rounded-xl border border-[var(--color-border)] shadow-[var(--shadow-lg)] overflow-hidden"
            style={{ left: isCollapsed ? '4px' : '8px' }}
            role="menu"
            aria-label="User menu"
        >
            {/* User info header */}
            <div className="px-4 py-3 border-b border-[var(--color-border)]/20">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-sm font-bold text-[var(--color-primary)] shrink-0 overflow-hidden">
                        {resolveAvatarUrl(user?.avatarUrl) ? (
                            <img src={resolveAvatarUrl(user?.avatarUrl)} alt={user?.fullName || 'Profile'} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        ) : (
                            user?.fullName?.charAt(0) || 'S'
                        )}
                    </div>
                    <div className="min-w-0">
                        <div className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{user?.fullName || 'User'}</div>
                        <div className="text-xs text-[var(--color-text-muted)] truncate">{user?.email || 'user@example.com'}</div>
                    </div>
                </div>
            </div>

            {/* Menu items */}
            <div className="p-1.5">
                <button onClick={() => { navigate('/settings/profile'); onClose(); onCloseSidebar?.(); }} className={`${menuItem} text-[var(--color-text-primary)] hover:bg-[var(--color-background)]`} role="menuitem">
                    <User className="w-4 h-4 text-[var(--color-text-muted)]" /> {t('my_profile')}
                </button>
                {canOpenOrganizationSettings && (
                    <button onClick={() => { navigate('/settings/organization'); onClose(); onCloseSidebar?.(); }} className={`${menuItem} text-[var(--color-text-primary)] hover:bg-[var(--color-background)]`} role="menuitem">
                        <Settings className="w-4 h-4 text-[var(--color-text-muted)]" /> {t('general_settings', 'Organization')}
                    </button>
                )}
            </div>

            {/* Logout */}
            <div className="p-1.5 border-t border-[var(--color-border)]/20">
                <button onClick={logout} className={`${menuItem} text-red-600 hover:bg-red-50`} role="menuitem">
                    <LogOut className="w-4 h-4" /> {t('logout', 'Sign out')}
                </button>
            </div>
        </div>
    );
};

export default ProfilePopover;
