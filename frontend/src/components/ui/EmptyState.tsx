import React from 'react';
import { LucideIcon, Inbox } from 'lucide-react';

interface EmptyStateProps {
    icon?: LucideIcon;
    title: string;
    description?: string;
    action?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon = Inbox, title, description, action }) => (
    <div className="bg-white rounded-lg border border-[var(--color-card-border)] shadow-[var(--shadow-sm)] p-12 text-center">
        <div className="bg-[var(--color-background)] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Icon className="w-8 h-8 text-[var(--color-accent)]" />
        </div>
        <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-1">{title}</h3>
        {description && <p className="text-sm text-[var(--color-text-muted)] max-w-md mx-auto mb-4">{description}</p>}
        {action && <div className="mt-4">{action}</div>}
    </div>
);

export default EmptyState;
