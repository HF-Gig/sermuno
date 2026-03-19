import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import TopHeader from '../components/layout/TopHeader';
import { Bell, CalendarPlus, Mail, Menu } from 'lucide-react';
import { clsx } from 'clsx';
import { useNotifications } from '../context/NotificationContext';

const MainLayout: React.FC = () => {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const navigate = useNavigate();
    const [isCollapsed, setIsCollapsed] = useState(() => {
        try { return localStorage.getItem('sermuno_sidebar_collapsed') === 'true'; } catch { return false; }
    });
    const { unreadCount } = useNotifications();
    const unreadLabel = unreadCount > 99 ? '99+' : unreadCount;
    const location = useLocation();
    const isDashboard = location.pathname === '/dashboard' || location.pathname === '/dashboard/';
    const isInbox = location.pathname.startsWith('/inbox');
    const isCalendar = location.pathname.startsWith('/calendar');

    const handleToggleCollapse = () => {
        const next = !isCollapsed;
        setIsCollapsed(next);
        localStorage.setItem('sermuno_sidebar_collapsed', String(next));
    };

    useEffect(() => {
        const handler = (e: Event) => {
            const shouldCollapse = (e as CustomEvent).detail as boolean;
            setIsCollapsed(shouldCollapse);
        };
        window.addEventListener('sermuno:sidebar-collapse', handler);
        return () => window.removeEventListener('sermuno:sidebar-collapse', handler);
    }, []);

    useEffect(() => {
        window.dispatchEvent(new CustomEvent('sermuno:main-sidebar-opened', { detail: isSidebarOpen }));
    }, [isSidebarOpen]);

    useEffect(() => {
        if (isInbox && isSidebarOpen) {
            setIsSidebarOpen(false);
        }
    }, [isInbox, isSidebarOpen]);

    return (
        <div className="flex h-screen overflow-hidden">
            {/* Sidebar */}
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                isCollapsed={isCollapsed}
                onToggleCollapse={handleToggleCollapse}
            />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {/* Mobile + Tablet Header */}
                <div className="min-[787px]:hidden bg-[var(--color-primary)] h-[var(--header-height)] flex items-center justify-between px-3 shrink-0 relative">
                    {isInbox ? (
                        <div className="w-10 h-10" />
                    ) : (
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            className="p-2 text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors"
                            aria-label="Open navigation menu"
                        >
                            <Menu className="w-6 h-6" />
                        </button>
                    )}

                    <div className="absolute left-1/2 -translate-x-1/2 font-bold text-[var(--color-sidebar-text)] truncate max-w-[45%]">
                        Sermuno
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => navigate('/inbox?compose=1')}
                            className="p-2 text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors"
                            aria-label="Compose"
                        >
                            <Mail className="w-5 h-5" />
                        </button>
                        {!isCalendar && (
                            <button
                                onClick={() => navigate('/calendar')}
                                className="p-2 text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors"
                                aria-label="Add event"
                            >
                                <CalendarPlus className="w-5 h-5" />
                            </button>
                        )}
                        <button
                            onClick={() => navigate('/notifications')}
                            className="relative p-2 text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] rounded-lg transition-colors"
                            aria-label="Open notifications"
                        >
                            <Bell className="w-5 h-5" />
                            {unreadCount > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                                    {unreadLabel}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Desktop Top Header */}
                {!isInbox && (
                    <div className="hidden min-[787px]:block">
                        <TopHeader />
                    </div>
                )}

                {/* Page Content */}
                <main
                    className={clsx(
                        'flex-1 bg-[var(--color-content-bg)]',
                        isDashboard ? 'min-[787px]:overflow-hidden overflow-y-auto p-3 min-[787px]:p-4' : isInbox ? 'overflow-hidden p-3 min-[787px]:p-4' : 'overflow-y-auto p-[var(--content-padding)]'
                    )}
                >
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default MainLayout;
