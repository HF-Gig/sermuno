import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { hasPermission } from '../hooks/usePermission';

interface RequirePermissionProps {
    children: React.ReactNode;
    permission: string;
    redirectTo?: string;
}

const RequirePermission: React.FC<RequirePermissionProps> = ({ children, permission, redirectTo = '/inbox' }) => {
    const { user, loading } = useAuth();
    const location = useLocation();

    if (loading) return null;
    if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
    if (!hasPermission(user.permissions, permission)) return <Navigate to={redirectTo} replace />;

    return <>{children}</>;
};

export default RequirePermission;
