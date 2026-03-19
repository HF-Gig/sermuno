import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
};

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer, size = 'md' }) => {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-[var(--color-text-primary)]/30"
                onClick={onClose}
            />

            {/* Panel */}
            <div className={`relative w-full ${sizeClasses[size]} bg-white rounded-xl border border-[var(--color-card-border)] shadow-[var(--shadow-lg)] animate-in`}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-card-border)]">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-background)] transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--color-card-border)]">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;
