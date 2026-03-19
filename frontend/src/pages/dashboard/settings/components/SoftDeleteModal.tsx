import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '../../../../components/ui/Modal';

interface SoftDeleteModalProps {
    isOpen: boolean;
    onClose: () => void;
    userName: string;
    onConfirm: () => void;
}

export default function SoftDeleteModal({ isOpen, onClose, userName, onConfirm }: SoftDeleteModalProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Deactivate User"
            size="sm"
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => { onConfirm(); onClose(); }}
                        className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                        Deactivate User
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800 leading-relaxed">
                        <p className="font-semibold mb-1">Are you sure you want to deactivate {userName}?</p>
                        <p>
                            This user will be deactivated, but their data will be preserved. You can restore them later.
                        </p>
                    </div>
                </div>

                <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/35 p-3">
                    <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                        The user will immediately lose access to the platform. All their threads, messages, and activity history will remain intact for audit purposes.
                    </p>
                </div>
            </div>
        </Modal>
    );
}
