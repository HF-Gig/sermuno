import React from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '../../../../components/ui/Modal';

interface DeleteMailboxModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    mailboxName: string;
}

export default function DeleteMailboxModal({ isOpen, onClose, onConfirm, mailboxName }: DeleteMailboxModalProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Remove Mailbox"
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
                        onClick={onConfirm}
                        className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                        Remove Mailbox
                    </button>
                </>
            }
        >
            <div className="space-y-3">
                <p className="text-[var(--color-text-primary)]">
                    Remove <strong>{mailboxName}</strong> from your organization?
                </p>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-amber-800">Before you remove this mailbox</p>
                        <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
                            <li>All incoming mail sync will stop immediately</li>
                            <li>Teams assigned to this mailbox will lose access</li>
                            <li>Existing conversations will be preserved in your archive</li>
                        </ul>
                    </div>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                    You can re-add this mailbox at any time with the same credentials.
                </p>
            </div>
        </Modal>
    );
}
