import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import Modal from './Modal';

interface UpgradeBlockerModalProps {
    isOpen: boolean;
    onClose: () => void;
    resourceName?: string;
}

export default function UpgradeBlockerModal({ isOpen, onClose, resourceName }: UpgradeBlockerModalProps) {
    const navigate = useNavigate();

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Plan Limit Reached"
            size="sm"
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] rounded-lg transition-colors"
                    >
                        Maybe Later
                    </button>
                    <button
                        type="button"
                        onClick={() => { onClose(); navigate('/billing/plans'); }}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[var(--color-cta-primary)] text-white rounded-lg hover:bg-[var(--color-cta-secondary)] transition-colors"
                    >
                        <Sparkles className="w-4 h-4" />
                        Upgrade Plan
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                <div className="flex flex-col items-center text-center py-3">
                    <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mb-4">
                        <Sparkles className="w-7 h-7 text-amber-600" />
                    </div>
                    <h3 className="text-lg font-bold text-[var(--color-text-primary)] mb-2">
                        You&apos;ve reached your limit
                    </h3>
                    <p className="text-sm text-[var(--color-text-muted)] leading-relaxed max-w-xs">
                        Please upgrade to the <span className="font-semibold text-[var(--color-text-primary)]">Professional</span> plan to add more {resourceName || 'resources'}.
                    </p>
                </div>

                <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/35 p-3 text-center">
                    <p className="text-xs text-[var(--color-text-muted)]">
                        Professional plans include higher limits for users, mailboxes, storage, and access to advanced features.
                    </p>
                </div>
            </div>
        </Modal>
    );
}
