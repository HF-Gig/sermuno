import React, { useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import { AdaptiveTableRowsSkeleton } from '../../../components/ui/Skeleton';
import api from '../../../lib/api';

type AuditItem = {
    id: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    userId?: string | null;
    createdAt: string;
};

const AuditPage: React.FC = () => {
    const [items, setItems] = useState<AuditItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionFilter, setActionFilter] = useState('');

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            const response = await api.get('/audit-logs', {
                params: {
                    page: 1,
                    limit: 50,
                    ...(actionFilter ? { action: actionFilter } : {}),
                },
            });
            setItems(Array.isArray(response.data?.logs) ? response.data.logs : []);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to load audit logs.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [actionFilter]);

    return (
        <div className="max-w-6xl mx-auto space-y-5">
            <PageHeader title="Audit Log" subtitle="Track organization activity and security-sensitive actions." />

            <div className="flex items-center gap-3">
                <input
                    value={actionFilter}
                    onChange={(event) => setActionFilter(event.target.value)}
                    placeholder="Filter by action"
                    className="rounded-md border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm"
                />
                <button
                    type="button"
                    onClick={load}
                    className="rounded-md border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm"
                >
                    Refresh
                </button>
            </div>

            {error ? (
                <p className="text-sm text-red-600">{error}</p>
            ) : !loading && items.length === 0 ? (
                <EmptyState
                    icon={ScrollText}
                    title="No audit entries found"
                    description="No records matched the current filters."
                />
            ) : (
                <div className="overflow-x-auto rounded-lg border border-[var(--color-card-border)] bg-white">
                    <table className="min-w-full text-sm">
                        <thead className="bg-[var(--color-background)]">
                            <tr>
                                <th className="px-3 py-2 text-left">Time</th>
                                <th className="px-3 py-2 text-left">Action</th>
                                <th className="px-3 py-2 text-left">Entity</th>
                                <th className="px-3 py-2 text-left">Actor</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <AdaptiveTableRowsSkeleton
                                    cols={4}
                                    rowHeight={42}
                                    containerMaxHeight={420}
                                    minRows={6}
                                    maxRows={12}
                                />
                            ) : items.map((item) => (
                                <tr key={item.id} className="border-t border-[var(--color-card-border)]">
                                    <td className="px-3 py-2">{new Date(item.createdAt).toLocaleString()}</td>
                                    <td className="px-3 py-2">{item.action}</td>
                                    <td className="px-3 py-2">{`${item.entityType}${item.entityId ? ` (${item.entityId})` : ''}`}</td>
                                    <td className="px-3 py-2">{item.userId || 'system'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default AuditPage;
