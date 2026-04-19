import React, { useEffect, useState } from 'react';
import { ArrowLeft, Building2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import { InlineSkeleton } from '../../../components/ui/Skeleton';
import api from '../../../lib/api';

type CompanyRecord = {
    id: string;
    tenantId: string;
    name: string;
    primaryDomain?: string | null;
    additionalDomains?: string[];
    customFields?: Record<string, unknown>;
    contactCount?: number;
    threadCount?: number;
};

const CompanyDetailPage: React.FC = () => {
    const navigate = useNavigate();
    const { companyId = '' } = useParams();
    const [loading, setLoading] = useState(true);
    const [companyDetail, setCompanyDetail] = useState<CompanyRecord | null>(null);

    useEffect(() => {
        if (!companyId) {
            setCompanyDetail(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        void api
            .get(`/companies/${companyId}`)
            .then((res) => setCompanyDetail(res.data))
            .catch(() => setCompanyDetail(null))
            .finally(() => setLoading(false));
    }, [companyId]);

    return (
        <div className="mx-auto max-w-[1280px] space-y-6">
            <PageHeader
                title="Company Details"
                subtitle="Full company profile, domains, and metadata."
                actions={(
                    <button
                        type="button"
                        onClick={() => navigate('/contacts?tab=companies')}
                        className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-card-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-text-primary)]"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to CRM
                    </button>
                )}
            />

            <section className="rounded-2xl border border-[var(--color-card-border)] bg-white p-5 shadow-[var(--shadow-sm)] min-w-0">
                {loading ? (
                    <div className="space-y-5">
                        <InlineSkeleton className="h-7 w-32" />
                        <div className="space-y-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3"><InlineSkeleton className="h-4 w-full" /></div>)}</div>
                    </div>
                ) : companyDetail ? (
                    <div className="space-y-5">
                        <div>
                            <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{companyDetail.name}</h2>
                            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{companyDetail.primaryDomain || '--'}</p>
                        </div>

                        <DetailBlock title="Fields" rows={[
                            ['ID', companyDetail.id],
                            ['Tenant ID', companyDetail.tenantId],
                            ['Primary Domain', companyDetail.primaryDomain || '--'],
                            ['Additional Domains', (companyDetail.additionalDomains || []).join(', ') || '--'],
                            ['Contact Count', String(companyDetail.contactCount || 0)],
                            ['Thread Count', String(companyDetail.threadCount || 0)],
                        ]} />
                        <JsonBlock title="Custom Fields" value={companyDetail.customFields || {}} />
                    </div>
                ) : (
                    <EmptyState icon={Building2} title="Company not found" description="The selected company could not be loaded." />
                )}
            </section>
        </div>
    );
};

const DetailBlock: React.FC<{ title: string; rows: Array<[string, string]>; emptyLabel?: string }> = ({ title, rows, emptyLabel }) => (
    <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        {rows.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">{emptyLabel || '--'}</p> : <div className="space-y-2">{rows.map(([label, value], index) => <div key={`${title}-${label}-${index}`} className="rounded-xl border border-[var(--color-card-border)] px-3 py-3 text-sm"><div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div><div className="mt-1 break-words text-[var(--color-text-primary)]">{value || '--'}</div></div>)}</div>}
    </div>
);

const JsonBlock: React.FC<{ title: string; value: unknown }> = ({ title, value }) => (
    <div>
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <pre className="overflow-x-auto rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/20 p-3 text-xs text-[var(--color-text-primary)]">{JSON.stringify(value, null, 2)}</pre>
    </div>
);

export default CompanyDetailPage;
