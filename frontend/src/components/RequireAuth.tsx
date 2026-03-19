import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../lib/api';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user, loading } = useAuth();
    const location = useLocation();
    const [orgEnforceMfa, setOrgEnforceMfa] = React.useState<boolean | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        const loadOrganization = async () => {
            if (!user?.organizationId) {
                setOrgEnforceMfa(false);
                return;
            }
            try {
                const response = await api.get('/organizations/me');
                if (!cancelled) {
                    setOrgEnforceMfa(Boolean(response.data?.enforceMfa));
                }
            } catch {
                if (!cancelled) {
                    setOrgEnforceMfa(false);
                }
            }
        };

        void loadOrganization();
        return () => {
            cancelled = true;
        };
    }, [user?.organizationId]);

    if (loading) {
        return null;
    }

    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    if (user.needsSetup) {
        return <Navigate to="/onboarding" replace />;
    }

    if (user && orgEnforceMfa === null) {
        return null;
    }

    const allowWithoutMfa = location.pathname === '/mfa-setup' || location.pathname === '/settings/profile';
    if (orgEnforceMfa && !user.mfaEnabled && !allowWithoutMfa) {
        return (
            <div className="min-h-screen bg-[var(--color-background)] flex items-center justify-center px-4">
                <div className="w-full max-w-xl rounded-2xl border border-[var(--color-card-border)] bg-white p-6 shadow-sm">
                    <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Enable MFA to Continue</h2>
                    <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                        Your organization requires multi-factor authentication. Enable MFA first to view this page.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <a
                            href="/mfa-setup"
                            className="inline-flex items-center justify-center rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]"
                        >
                            Enable MFA
                        </a>
                        <a
                            href="/settings/profile"
                            className="inline-flex items-center justify-center rounded-lg border border-[var(--color-card-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
                        >
                            Open Profile
                        </a>
                    </div>
                </div>
            </div>
        );
    }

    return <>{children}</>;
};

export default RequireAuth;
