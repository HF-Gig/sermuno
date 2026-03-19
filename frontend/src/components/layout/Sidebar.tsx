import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
    LayoutGrid, Inbox, Calendar, Users, BarChart3,
    X, Shield,
    PanelLeftClose, PanelLeftOpen,
    Zap, FileSignature, Webhook, Download, LayoutTemplate, Lock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTranslation } from 'react-i18next';
import ProfilePopover from './ProfilePopover';
import { resolveAvatarUrl } from '../../lib/api';
import { hasPermission } from '../../hooks/usePermission';

interface SidebarProps {
    isOpen: boolean;
    onClose: () => void;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    forceCollapse?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose, isCollapsed, onToggleCollapse, forceCollapse }) => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isHoverExpanded, setIsHoverExpanded] = useState(false);
    const canAccessRules = hasPermission(user?.permissions, 'rules:view');
    const canAccessSla = hasPermission(user?.permissions, 'sla_policies:view');
    const canAccessSignatures = hasPermission(user?.permissions, 'signatures:view');
    const canAccessTemplates = hasPermission(user?.permissions, 'templates:view');
    const canAccessWebhooks = hasPermission(user?.permissions, 'webhooks:view');
    const canAccessExport = hasPermission(user?.permissions, 'organization:manage');

    const closeMobile = () => { if (window.innerWidth < 768) onClose(); };

    const collapsed = forceCollapse || isCollapsed;
    const visuallyExpanded = !collapsed;
    const sidebarW = visuallyExpanded ? 'w-[260px]' : 'w-16';

    return (
        <>
            {/* Mobile backdrop */}
            <div
                className={`fixed inset-0 bg-[var(--color-primary)]/60 z-40 min-[787px]:hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
            />

            {/* Sidebar */}
            <aside
                className={`fixed inset-y-0 left-0 z-50 flex flex-col ${sidebarW} bg-[var(--color-sidebar-bg)] transition-[width] duration-300 ease-in-out min-[787px]:static transform ${isOpen ? 'translate-x-0' : '-translate-x-full'} min-[787px]:translate-x-0`}
                onMouseEnter={() => { if (collapsed) setIsHoverExpanded(true); }}
                onMouseLeave={() => { setIsHoverExpanded(false); }}
            >

                {/* Logo + Collapse Toggle */}
                <div className="h-[var(--header-height)] flex items-center justify-between px-4 border-b border-[var(--color-sidebar-hover)] shrink-0">
                    <div className="flex items-center gap-2.5 overflow-hidden">
                        <div className="relative w-8 h-8 shrink-0">
                            <div className={`absolute inset-0 w-8 h-8 rounded-lg bg-[var(--color-accent)] flex items-center justify-center text-sm font-bold text-[var(--color-primary)] transition-opacity duration-200 overflow-hidden ${collapsed && isHoverExpanded ? 'opacity-0' : 'opacity-100'}`}>
                                S
                            </div>
                            <button
                                onClick={onToggleCollapse}
                                title="Expand sidebar"
                                className={`hidden min-[787px]:flex absolute inset-0 w-8 h-8 rounded-lg bg-[var(--color-sidebar-hover)] items-center justify-center text-[var(--color-sidebar-text)] transition-opacity duration-200 ${collapsed && isHoverExpanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                            >
                                <PanelLeftOpen className="w-5 h-5" />
                            </button>
                        </div>
                        <span className={`text-lg font-bold text-[var(--color-sidebar-text)] whitespace-nowrap transition-opacity duration-200 ${visuallyExpanded ? 'opacity-100' : 'opacity-0 w-0'}`}>Sermuno</span>
                    </div>
                    <div className="flex items-center gap-1">
                        {!collapsed && (
                            <button
                                onClick={onToggleCollapse}
                                className="hidden min-[787px]:flex p-1 rounded text-[var(--color-sidebar-text-muted)] hover:text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] transition-colors"
                                title="Collapse sidebar"
                            >
                                <PanelLeftClose className="w-5 h-5" />
                            </button>
                        )}
                        <button onClick={onClose} className="min-[787px]:hidden p-1 rounded text-[var(--color-sidebar-text-muted)] hover:text-[var(--color-sidebar-text)]">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5 scrollbar-thin">
                    {/* Main */}
                    <div className="space-y-0.5">
                        <SidebarLabel collapsed={!visuallyExpanded}>{t('sidebar_section_main', 'Main')}</SidebarLabel>
                        <NavItem to="/dashboard" icon={LayoutGrid} label={t('dashboard', 'Dashboard')} collapsed={!visuallyExpanded} onClick={closeMobile} />
                        <NavItem to="/inbox" icon={Inbox} label={t('inbox', 'Inbox')} collapsed={!visuallyExpanded} onClick={closeMobile} />
                        <NavItem to="/calendar" icon={Calendar} label={t('calendar', 'Calendar')} collapsed={!visuallyExpanded} onClick={closeMobile} />
                        <NavItem to="/contacts" icon={Users} label={t('sidebar_crm', 'CRM')} collapsed={!visuallyExpanded} onClick={closeMobile} />
                        <NavItem to="/analytics" icon={BarChart3} label={t('sidebar_analytics', 'Analytics')} collapsed={!visuallyExpanded} onClick={closeMobile} />
                    </div>

                    {(canAccessRules || canAccessSla || canAccessSignatures || canAccessTemplates || canAccessWebhooks || canAccessExport) && (
                        <div className="space-y-0.5">
                            <SidebarLabel collapsed={!visuallyExpanded}>{t('sidebar_section_automation', 'Automation')}</SidebarLabel>
                            {canAccessRules && <NavItem to="/rules" icon={Zap} label={t('sidebar_rules', 'Rules')} collapsed={!visuallyExpanded} onClick={closeMobile} />}
                            {canAccessSla && <NavItem to="/sla" icon={Shield} label={t('sidebar_sla', 'SLA')} collapsed={!visuallyExpanded} onClick={closeMobile} />}
                            {canAccessSignatures && <NavItem to="/signatures" icon={FileSignature} label={t('sidebar_signatures', 'Signatures')} collapsed={!visuallyExpanded} onClick={closeMobile} />}
                            {canAccessTemplates && <NavItem to="/templates" icon={LayoutTemplate} label={t('sidebar_templates', 'Templates')} collapsed={!visuallyExpanded} onClick={closeMobile} />}
                            {canAccessWebhooks && <NavItem to="/webhooks" icon={Webhook} label={t('sidebar_webhooks', 'Webhooks')} collapsed={!visuallyExpanded} onClick={closeMobile} />}
                            {canAccessExport && <NavItem to="/export" icon={Download} label={t('sidebar_export', 'Export & Import')} collapsed={!visuallyExpanded} onClick={closeMobile} />}
                        </div>
                    )}
                </nav>

                {/* Footer — Profile (pinned to bottom) */}
                <div className="mt-auto border-t border-[var(--color-sidebar-hover)] p-2 pb-4 md:pb-2 space-y-1 shrink-0">
                    <button
                        onClick={() => setIsProfileOpen(!isProfileOpen)}
                        className={`w-full flex items-center py-2 rounded-lg hover:bg-[var(--color-sidebar-hover)] transition-colors group ${!visuallyExpanded ? 'justify-center px-0 gap-0' : 'px-3 gap-3'}`}
                        aria-label="Open profile menu"
                    >
                        <div className="w-8 h-8 rounded-full bg-[var(--color-accent)] flex items-center justify-center text-sm font-bold text-[var(--color-primary)] shrink-0 group-hover:ring-2 group-hover:ring-[var(--color-accent)]/50 transition-all overflow-hidden">
                            {resolveAvatarUrl(user?.avatarUrl) ? (
                                <img src={resolveAvatarUrl(user?.avatarUrl)} alt={user?.fullName || 'Profile'} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                            ) : (
                                user?.fullName?.charAt(0) || 'S'
                            )}
                        </div>
                        {visuallyExpanded && (
                            <div className="flex-1 min-w-0 text-left">
                                <div className="text-sm font-medium text-[var(--color-sidebar-text)] truncate">{user?.fullName || 'User'}</div>
                                <div className="text-[11px] text-[var(--color-sidebar-text-muted)] truncate">{user?.email || 'user@example.com'}</div>
                            </div>
                        )}
                    </button>
                    <ProfilePopover isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} isCollapsed={!visuallyExpanded} onCloseSidebar={onClose} />
                </div>
            </aside>
        </>
    );
};

/* --- Sub-components --- */

const SidebarLabel: React.FC<{ children: React.ReactNode; collapsed: boolean }> = ({ children, collapsed }) => {
    if (collapsed) return <div className="h-px bg-[var(--color-sidebar-hover)] mx-2 my-2" />;
    return <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-sidebar-text-muted)]/60">{children}</p>;
};

interface NavItemProps {
    to: string;
    icon: React.FC<{ className?: string }>;
    label: string;
    badge?: number;
    collapsed?: boolean;
    onClick?: () => void;
    comingSoon?: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon: Icon, label, badge, collapsed, onClick, comingSoon }) => {
    const baseClass = `flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${collapsed ? 'justify-center px-0 gap-0' : 'gap-3 px-3'}`;

    if (comingSoon) {
        return (
            <button
                type="button"
                onClick={onClick}
                title={collapsed ? `${label} (Coming Soon)` : undefined}
                aria-disabled="true"
                className={`${baseClass} w-full text-left text-[var(--color-sidebar-text-muted)]/65 hover:bg-[var(--color-sidebar-hover)]/40 cursor-not-allowed`}
            >
                <Icon className="w-5 h-5 shrink-0 opacity-80" />
                {!collapsed && <span className="flex-1">{label}</span>}
                {!collapsed && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-sidebar-hover)] bg-[var(--color-sidebar-hover)]/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-sidebar-text-muted)]">
                        <Lock className="w-3 h-3" />
                        Soon
                    </span>
                )}
            </button>
        );
    }

    return (
        <NavLink
            to={to}
            onClick={onClick}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
                `${baseClass} ${isActive
                    ? 'bg-[var(--color-sidebar-active-bg)] text-[var(--color-sidebar-text)]'
                    : 'text-[var(--color-sidebar-text-muted)] hover:bg-[var(--color-sidebar-hover)] hover:text-[var(--color-sidebar-text)]'
                }`
            }
        >
            <Icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span className="flex-1">{label}</span>}
            {!collapsed && badge !== undefined && (
                <span className="bg-[var(--color-accent)]/20 text-[var(--color-accent)] text-xs font-semibold px-2 py-0.5 rounded-full">{badge}</span>
            )}
        </NavLink>
    );
};

export default Sidebar;
