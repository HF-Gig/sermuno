import React from 'react';
import Modal from './Modal';

type ConfirmDialogProps = {
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isSubmitting?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
};

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    description,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    isSubmitting = false,
    onCancel,
    onConfirm,
}) => {
    return (
        <Modal
            isOpen={isOpen}
            onClose={() => {
                if (!isSubmitting) onCancel();
            }}
            title={title}
            size="sm"
            footer={(
                <>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isSubmitting}
                        className="rounded-lg px-4 py-2 text-sm text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {cancelLabel}
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isSubmitting}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {isSubmitting ? 'Deleting...' : confirmLabel}
                    </button>
                </>
            )}
        >
            <p className="text-sm text-[var(--color-text-muted)]">{description}</p>
        </Modal>
    );
};

export default ConfirmDialog;

