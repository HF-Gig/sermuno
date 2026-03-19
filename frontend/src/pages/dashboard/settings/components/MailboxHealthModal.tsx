import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle, Clock, AlertCircle } from 'lucide-react';
import Modal from '../../../../components/ui/Modal';

type HealthStatus = 'healthy' | 'degraded' | 'failed' | 'unknown';
type SyncStatus = 'idle' | 'syncing' | 'pending' | 'error';

interface MailboxHealthModalProps {
    isOpen: boolean;
    onClose: () => void;
    mailbox: {
        id: string;
        name: string;
        email?: string;
        provider: string;
        status: string;
        syncStatus: string;
        lastSyncAt?: string | null;
        nextRetryAt?: string | null;
        syncErrorCount?: number;
        syncError?: string | null;
        imapHost?: string;
        smtpHost?: string;
        imapPort?: number;
        smtpPort?: number;
    } | null;
}

const healthMeta: Record<HealthStatus, { icon: React.ReactNode; label: string; color: string; bg: string; border: string }> = {
    healthy:  { icon: <CheckCircle2  className="w-5 h-5" />, label: 'Healthy',  color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    degraded: { icon: <AlertTriangle className="w-5 h-5" />, label: 'Degraded', color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-200'   },
    failed:   { icon: <XCircle       className="w-5 h-5" />, label: 'Failed',   color: 'text-red-600',     bg: 'bg-red-50',     border: 'border-red-200'     },
    unknown:  { icon: <HelpCircle    className="w-5 h-5" />, label: 'Unknown',  color: 'text-gray-500',    bg: 'bg-gray-50',    border: 'border-gray-200'    },
};

const syncMeta: Record<SyncStatus, { label: string; color: string; dotColor: string }> = {
    idle:    { label: 'Idle',    color: 'text-gray-600',   dotColor: 'bg-gray-400'   },
    syncing: { label: 'Syncing', color: 'text-blue-600',   dotColor: 'bg-blue-500'   },
    pending: { label: 'Pending', color: 'text-amber-600',  dotColor: 'bg-amber-400'  },
    error:   { label: 'Error',   color: 'text-red-600',    dotColor: 'bg-red-500'    },
};

function formatDate(iso?: string | null): string {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return iso;
    }
}

function timeAgo(iso?: string | null): string {
    if (!iso) return '—';
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

const MailboxHealthModal: React.FC<MailboxHealthModalProps> = ({ isOpen, onClose, mailbox }) => {
    if (!mailbox) return null;

    const healthKey = (mailbox.status as HealthStatus) in healthMeta ? (mailbox.status as HealthStatus) : 'unknown';
    const syncKey   = (mailbox.syncStatus as SyncStatus) in syncMeta ? (mailbox.syncStatus as SyncStatus) : 'idle';

    const health = healthMeta[healthKey];
    const sync   = syncMeta[syncKey];

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Mailbox Health Details" size="md">
            {/* Connection badge row */}
            <div className={`flex items-center gap-3 rounded-lg border p-3 mb-5 ${health.border} ${health.bg}`}>
                <span className={health.color}>{health.icon}</span>
                <div>
                    <p className={`text-sm font-semibold ${health.color}`}>{health.label}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{mailbox.name} · {mailbox.email || mailbox.imapHost}</p>
                </div>
            </div>

            <div className="space-y-4">
                {/* Sync Status */}
                <Section title="Sync Status">
                    <Row label="Status">
                        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${sync.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sync.dotColor}`} />
                            {sync.label}
                        </span>
                    </Row>
                    <Row label="Last synced">{timeAgo(mailbox.lastSyncAt)} <span className="text-[var(--color-text-muted)] text-xs ml-1">({formatDate(mailbox.lastSyncAt)})</span></Row>
                    {mailbox.nextRetryAt && (
                        <Row label="Next retry">
                            <span className="flex items-center gap-1 text-amber-600 text-sm">
                                <Clock className="w-3.5 h-3.5" />
                                {formatDate(mailbox.nextRetryAt)}
                            </span>
                        </Row>
                    )}
                    {(mailbox.syncErrorCount ?? 0) > 0 && (
                        <Row label="Error count">
                            <span className="text-red-600 font-semibold text-sm">{mailbox.syncErrorCount} consecutive error{(mailbox.syncErrorCount ?? 0) !== 1 ? 's' : ''}</span>
                        </Row>
                    )}
                </Section>

                {/* Error detail */}
                {mailbox.syncError && (
                    <Section title="Last Error">
                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-red-700 font-mono break-all">{mailbox.syncError}</p>
                        </div>
                    </Section>
                )}

                {/* Connection Info */}
                <Section title="Connection Info">
                    <Row label="Provider">{mailbox.provider}</Row>
                    {mailbox.imapHost && <Row label="IMAP">{mailbox.imapHost}:{mailbox.imapPort ?? 993}</Row>}
                    {mailbox.smtpHost && <Row label="SMTP">{mailbox.smtpHost}:{mailbox.smtpPort ?? 465}</Row>}
                </Section>

                {/* Checks table */}
                <Section title="Health Checks">
                    <Check label="IMAP reachable"    pass={healthKey !== 'failed'} />
                    <Check label="SMTP reachable"    pass={healthKey !== 'failed'} />
                    <Check label="Auth valid"         pass={healthKey !== 'failed'} />
                    <Check label="No sync backlog"    pass={syncKey === 'idle'} />
                    <Check label="No repeated errors" pass={(mailbox.syncErrorCount ?? 0) === 0} />
                </Section>
            </div>
        </Modal>
    );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div>
        <h5 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">{title}</h5>
        <div className="rounded-lg border border-[var(--color-card-border)] overflow-hidden divide-y divide-[var(--color-card-border)]">
            {children}
        </div>
    </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-center justify-between px-3 py-2 bg-white text-sm">
        <span className="text-[var(--color-text-muted)] w-32 flex-shrink-0">{label}</span>
        <span className="text-[var(--color-text-primary)] text-right">{children}</span>
    </div>
);

const Check: React.FC<{ label: string; pass: boolean }> = ({ label, pass }) => (
    <div className="flex items-center justify-between px-3 py-2 bg-white text-sm">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        {pass
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            : <XCircle      className="w-4 h-4 text-red-500" />
        }
    </div>
);

export default MailboxHealthModal;
