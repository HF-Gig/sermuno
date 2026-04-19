import React, { useState, useEffect } from 'react';
import { Folder, FolderOpen, Inbox, Send, Trash2, AlertCircle, Star } from 'lucide-react';
import Modal from '../../../../components/ui/Modal';
import api from '../../../../lib/api';
import { useAdaptiveRows } from '../../../../hooks/useAdaptiveCount';

interface MailboxFolder {
    id?: string;
    name: string;
    label: string;
    path: string;
    messageCount: number;
    unreadCount: number;
    special?: 'inbox' | 'sent' | 'trash' | 'spam' | 'drafts' | 'starred';
}

const shouldExcludeProviderSystemFolder = (name: string) => {
    const raw = String(name || '').trim().toLowerCase();
    const normalized = raw
        .replace(/[\[\]().]/g, ' ')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return (
        normalized === 'gmail'
        || raw === '[gmail]'
        || raw === '[gmail]/starred'
        || raw === '[gmail]/important'
        || normalized === 'starred'
        || normalized === 'important'
        || normalized === 'flagged emails'
        || normalized.endsWith('/starred')
        || normalized.endsWith('/important')
    );
};

const sanitizeFolderLabel = (name: string, type?: string) => {
    const normalizedType = String(type || '').toLowerCase();
    if (normalizedType === 'inbox') return 'INBOX';
    if (normalizedType === 'sent') return 'Sent Mail';
    if (normalizedType === 'drafts') return 'Drafts';
    if (normalizedType === 'spam') return 'Spam';
    if (normalizedType === 'trash') return 'Trash';
    if (normalizedType === 'archive') return 'Archive';

    const trimmed = String(name || '').trim();
    if (!trimmed) return 'Unknown';
    if (trimmed.startsWith('[Gmail]/')) {
        return trimmed.replace('[Gmail]/', '');
    }
    return trimmed;
};

interface MailboxFoldersModalProps {
    isOpen: boolean;
    onClose: () => void;
    mailbox: { id: string; name: string; email?: string; imapHost?: string } | null;
}

const specialIcons: Record<string, React.ReactNode> = {
    inbox:   <Inbox    className="w-4 h-4" />,
    sent:    <Send     className="w-4 h-4" />,
    trash:   <Trash2   className="w-4 h-4" />,
    spam:    <AlertCircle className="w-4 h-4" />,
    drafts:  <Folder   className="w-4 h-4" />,
    starred: <Star     className="w-4 h-4" />,
};

const specialColors: Record<string, string> = {
    inbox:   'text-blue-500',
    sent:    'text-emerald-500',
    trash:   'text-red-400',
    spam:    'text-amber-500',
    drafts:  'text-gray-400',
    starred: 'text-yellow-500',
};

const MailboxFoldersModal: React.FC<MailboxFoldersModalProps> = ({ isOpen, onClose, mailbox }) => {
    const [loading, setLoading] = useState(false);
    const [folders, setFolders] = useState<MailboxFolder[]>([]);
    const [error, setError] = useState<string | null>(null);
    const folderSkeletonRows = useAdaptiveRows({
        rowHeight: 52,
        minRows: 3,
        maxRows: 8,
        viewportOffset: 360,
    });

    useEffect(() => {
        if (!isOpen || !mailbox) return;
        setLoading(true);
        setError(null);
        api.get(`/mailboxes/${mailbox.id}/folders`)
            .then((response) => {
                const data = Array.isArray(response.data) ? response.data : [];
                const visible = data.filter((folder: any) => !shouldExcludeProviderSystemFolder(folder?.name || ''));
                setFolders(visible.map((folder: any) => ({
                    id: folder.id,
                    name: folder.name,
                    label: sanitizeFolderLabel(folder.name, folder.type),
                    path: folder.path || folder.name,
                    messageCount: Number(folder.messageCount ?? 0),
                    unreadCount: Number(folder.unreadCount ?? 0),
                    special: folder.type === 'inbox' ? 'inbox'
                        : folder.type === 'sent' ? 'sent'
                            : folder.type === 'trash' ? 'trash'
                                : folder.type === 'spam' ? 'spam'
                                    : folder.type === 'drafts' ? 'drafts'
                                        : folder.name.toLowerCase().includes('inbox') ? 'inbox'
                                            : folder.name.toLowerCase().includes('sent') ? 'sent'
                                                : folder.name.toLowerCase().includes('trash') ? 'trash'
                                                    : folder.name.toLowerCase().includes('spam') ? 'spam'
                                                        : folder.name.toLowerCase().includes('draft') ? 'drafts'
                                                            : undefined,
                })));
            })
            .catch((err) => {
                console.error('Failed to load mailbox folders:', err);
                setError(err?.userMessage || err?.response?.data?.message || 'Failed to load folders.');
                setFolders([]);
            })
            .finally(() => setLoading(false));
    }, [isOpen, mailbox]);

    if (!mailbox) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Mailbox Folders" size="md">
            <div className="mb-4">
                <p className="text-sm text-[var(--color-text-muted)]">
                    Folders synced via IMAP for <span className="font-medium text-[var(--color-text-primary)]">{mailbox.email || mailbox.imapHost}</span>
                </p>
            </div>

            {loading ? (
                <div className="animate-pulse space-y-3 rounded-lg border border-[var(--color-card-border)] overflow-hidden">
                    <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-3 py-2 bg-[var(--color-background)]">
                        <div className="h-3 w-20 rounded-full bg-white" />
                        <div className="h-3 w-12 rounded-full bg-white" />
                        <div className="h-3 w-10 rounded-full bg-white" />
                    </div>
                    {Array.from({ length: folderSkeletonRows }).map((_, index) => (
                        <div key={index} className="grid grid-cols-[1fr_auto_auto] gap-4 px-3 py-3 border-t border-[var(--color-card-border)] bg-white">
                            <div className="flex items-center gap-2">
                                <div className="h-4 w-4 rounded bg-[var(--color-background)]" />
                                <div className="h-4 w-32 rounded-full bg-[var(--color-background)]" />
                            </div>
                            <div className="h-4 w-10 rounded-full bg-[var(--color-background)] justify-self-end" />
                            <div className="h-4 w-8 rounded-full bg-[var(--color-background)] justify-self-end" />
                        </div>
                    ))}
                </div>
            ) : error ? (
                <div className="text-center py-10">
                    <p className="text-sm text-[var(--color-text-muted)]">{error}</p>
                </div>
            ) : folders.length === 0 ? (
                <div className="text-center py-10">
                    <p className="text-sm text-[var(--color-text-muted)]">No folders found.</p>
                </div>
            ) : (
                <div className="rounded-lg border border-[var(--color-card-border)] overflow-hidden divide-y divide-[var(--color-card-border)]">
                    {/* Header */}
                    <div className="grid grid-cols-[1fr_auto_auto] gap-4 px-3 py-2 bg-[var(--color-background)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                        <span>Folder</span>
                        <span className="w-16 text-right">Messages</span>
                        <span className="w-14 text-right">Unread</span>
                    </div>
                    {folders.map(folder => {
                        const icon   = folder.special ? specialIcons[folder.special] : <FolderOpen className="w-4 h-4" />;
                        const color  = folder.special ? specialColors[folder.special] : 'text-[var(--color-text-muted)]';
                        const isNested = folder.path.includes('/') && !folder.path.startsWith('[');
                        return (
                            <div key={folder.path}
                                className="grid grid-cols-[1fr_auto_auto] gap-4 px-3 py-2.5 bg-white hover:bg-[var(--color-background)]/50 transition-colors items-center"
                            >
                                <div className={`flex items-center gap-2 ${isNested ? 'pl-5' : ''}`}>
                                    <span className={color}>{icon}</span>
                                    <span className="text-sm text-[var(--color-text-primary)] font-medium">{folder.label}</span>
                                </div>
                                <span className="w-16 text-right text-sm text-[var(--color-text-muted)]">
                                    {folder.messageCount.toLocaleString()}
                                </span>
                                <span className={`w-14 text-right text-sm font-semibold ${folder.unreadCount > 0 ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] opacity-40'}`}>
                                    {folder.unreadCount > 0 ? folder.unreadCount : '—'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Modal>
    );
};

export default MailboxFoldersModal;
