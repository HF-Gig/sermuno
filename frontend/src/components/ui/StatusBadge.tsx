import React from 'react';
import { clsx } from 'clsx';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'primary';

const variantStyles: Record<BadgeVariant, string> = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    error: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-blue-50 text-blue-700 border-blue-200',
    neutral: 'bg-gray-50 text-gray-600 border-gray-200',
    primary: 'bg-[var(--color-background)] text-[var(--color-primary)] border-[var(--color-card-border)]',
};

interface StatusBadgeProps {
    label: string;
    variant?: BadgeVariant;
    dot?: boolean;
    className?: string;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ label, variant = 'neutral', dot, className }) => (
    <span className={clsx('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border', variantStyles[variant], className)}>
        {dot && <span className={clsx('w-1.5 h-1.5 rounded-full bg-current')} />}
        {label}
    </span>
);

export default StatusBadge;
