import React from 'react';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => {
    return (
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
            <div>
                <h1 className="text-2xl font-bold text-[var(--color-text-primary)] tracking-tight">
                    {title}
                </h1>
                {subtitle && (
                    <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                        {subtitle}
                    </p>
                )}
            </div>
            {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
        </div>
    );
};

export default PageHeader;
