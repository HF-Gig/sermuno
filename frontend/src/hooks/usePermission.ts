import { useAuth } from '../context/AuthContext';

export const hasPermission = (permissions: string[] | undefined, permission: string) => {
    if (!permission) return true;
    if (!permissions) return false;
    return permissions.includes('*') || permissions.includes(permission);
};

export const usePermission = (permission: string) => {
    const { user } = useAuth();
    return hasPermission(user?.permissions, permission);
};
