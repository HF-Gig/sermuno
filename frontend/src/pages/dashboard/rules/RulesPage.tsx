import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Pencil, Plus, Power, Trash2, Zap } from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import StatusBadge from '../../../components/ui/StatusBadge';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import api from '../../../lib/api';
import { TablePageSkeleton } from '../../../components/skeletons/TablePageSkeleton';
import { hasPermission } from '../../../hooks/usePermission';
import { useAuth } from '../../../context/AuthContext';

type RuleConditionField = 'from' | 'to' | 'cc' | 'subject' | 'body' | 'has_attachments' | 'attachment_name' | 'attachment_size' | 'date_received' | 'is_reply' | 'header';
type RuleConditionOperator = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'matches_regex' | 'greater_than' | 'less_than' | 'is_true' | 'is_false';
type RuleActionType = 'move_folder' | 'copy_folder' | 'mark_read' | 'mark_unread' | 'mark_flagged' | 'mark_unflagged' | 'delete' | 'archive' | 'assign_to_me' | 'assign_to_user' | 'assign_to_team' | 'add_tag' | 'add_personal_tag' | 'set_status' | 'set_priority' | 'notify' | 'send_webhook';

type RuleConditionNode = {
    id: string;
    type: 'condition';
    field: RuleConditionField;
    operator: RuleConditionOperator;
    value: string;
};

type RuleGroupNode = {
    id: string;
    type: 'group';
    logic: 'AND' | 'OR';
    children: RuleNode[];
};

type RuleNode = RuleConditionNode | RuleGroupNode;

type RuleActionForm = {
    id: string;
    type: RuleActionType;
    value: string;
};

type RuleFormState = {
    name: string;
    isActive: boolean;
    priority: 1 | 2 | 3;
    executionMode: 'merge' | 'override';
    conditions: RuleGroupNode;
    actions: RuleActionForm[];
};

type ResourceOption = { id: string; label: string };

const conditionFieldOptions: Array<{ value: RuleConditionField; label: string }> = [
    { value: 'from', label: 'From' },
    { value: 'to', label: 'To' },
    { value: 'cc', label: 'CC' },
    { value: 'subject', label: 'Subject' },
    { value: 'body', label: 'Body' },
    { value: 'has_attachments', label: 'Has Attachments' },
    { value: 'attachment_name', label: 'Attachment Name' },
    { value: 'attachment_size', label: 'Attachment Size' },
    { value: 'date_received', label: 'Date Received' },
    { value: 'is_reply', label: 'Is Reply' },
    { value: 'header', label: 'Header' },
];

const operatorOptions: Array<{ value: RuleConditionOperator; label: string }> = [
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Not Equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'not_contains', label: 'Not Contains' },
    { value: 'starts_with', label: 'Starts With' },
    { value: 'ends_with', label: 'Ends With' },
    { value: 'matches_regex', label: 'Matches Regex' },
    { value: 'greater_than', label: 'Greater Than' },
    { value: 'less_than', label: 'Less Than' },
    { value: 'is_true', label: 'Is True' },
    { value: 'is_false', label: 'Is False' },
];

const actionOptions: Array<{ value: RuleActionType; label: string; placeholder: string; valueMode: 'none' | 'free-text' | 'folder' | 'user' | 'team' | 'tag' | 'status' | 'priority' | 'webhook' }> = [
    { value: 'move_folder', label: 'Move Folder', placeholder: 'Select folder', valueMode: 'folder' },
    { value: 'copy_folder', label: 'Copy Folder', placeholder: 'Select folder', valueMode: 'folder' },
    { value: 'mark_read', label: 'Mark Read', placeholder: '', valueMode: 'none' },
    { value: 'mark_unread', label: 'Mark Unread', placeholder: '', valueMode: 'none' },
    { value: 'mark_flagged', label: 'Mark Flagged', placeholder: '', valueMode: 'none' },
    { value: 'mark_unflagged', label: 'Mark Unflagged', placeholder: '', valueMode: 'none' },
    { value: 'delete', label: 'Delete', placeholder: '', valueMode: 'none' },
    { value: 'archive', label: 'Archive', placeholder: '', valueMode: 'none' },
    { value: 'assign_to_me', label: 'Assign To Me', placeholder: '', valueMode: 'none' },
    { value: 'assign_to_user', label: 'Assign To User', placeholder: 'Select user', valueMode: 'user' },
    { value: 'assign_to_team', label: 'Assign To Team', placeholder: 'Select team', valueMode: 'team' },
    { value: 'add_tag', label: 'Add Tag', placeholder: 'Select tag', valueMode: 'tag' },
    { value: 'add_personal_tag', label: 'Add Personal Tag', placeholder: 'Personal tag name', valueMode: 'free-text' },
    { value: 'set_status', label: 'Set Status', placeholder: 'Select status', valueMode: 'status' },
    { value: 'set_priority', label: 'Set Priority', placeholder: 'Select priority', valueMode: 'priority' },
    { value: 'notify', label: 'Notify', placeholder: 'Select user', valueMode: 'user' },
    { value: 'send_webhook', label: 'Send Webhook', placeholder: 'Select webhook', valueMode: 'webhook' },
];

const statusOptions: ResourceOption[] = [
    { id: 'NEW', label: 'New' },
    { id: 'OPEN', label: 'Open' },
    { id: 'PENDING', label: 'Pending' },
    { id: 'CLOSED', label: 'Closed' },
    { id: 'TRASH', label: 'Trash' },
];

const threadPriorityOptions: ResourceOption[] = [
    { id: 'LOW', label: 'Low' },
    { id: 'NORMAL', label: 'Normal' },
    { id: 'HIGH', label: 'High' },
    { id: 'URGENT', label: 'Urgent' },
];

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createCondition = (): RuleConditionNode => ({
    id: createId(),
    type: 'condition',
    field: 'subject',
    operator: 'contains',
    value: '',
});

const createGroup = (): RuleGroupNode => ({
    id: createId(),
    type: 'group',
    logic: 'AND',
    children: [createCondition()],
});

const createAction = (): RuleActionForm => ({
    id: createId(),
    type: 'add_tag',
    value: '',
});

const createForm = (): RuleFormState => ({
    name: '',
    isActive: true,
    priority: 3,
    executionMode: 'merge',
    conditions: createGroup(),
    actions: [createAction()],
});

const normalizeActionType = (type?: string): RuleActionType => {
    if (type === 'assign_user') return 'assign_to_user';
    if (type === 'assign_team') return 'assign_to_team';
    return (type as RuleActionType) || 'add_tag';
};

const buildNodeFromApi = (input: any): RuleGroupNode => {
    if (!input || typeof input !== 'object') return createGroup();
    const rawChildren = Array.isArray(input.conditions) ? input.conditions : [];

    return {
        id: createId(),
        type: 'group',
        logic: input.operator === 'OR' ? 'OR' : 'AND',
        children: rawChildren.length > 0
            ? rawChildren.map((child: any) => (Array.isArray(child?.conditions)
                ? buildNodeFromApi(child)
                : {
                    id: createId(),
                    type: 'condition',
                    field: child?.field || 'subject',
                    operator: child?.operator || 'contains',
                    value: String(child?.value || ''),
                }))
            : [createCondition()],
    };
};

const normalizeForm = (rule: any): RuleFormState => ({
    name: rule.name || '',
    isActive: Boolean(rule.isActive),
    priority: Number(rule.priority || 3) as 1 | 2 | 3,
    executionMode: rule.executionMode === 'override' ? 'override' : 'merge',
    conditions: buildNodeFromApi(rule.conditions),
    actions: Array.isArray(rule.actions) && rule.actions.length > 0
        ? rule.actions.map((action: any) => ({ id: createId(), type: normalizeActionType(action.type), value: String(action.value || action.targetUserId || action.targetTeamId || action.tagId || action.status || action.priority || action.folderId || '') }))
        : [createAction()],
});

const serializeGroup = (group: RuleGroupNode): Record<string, unknown> => ({
    operator: group.logic,
    conditions: group.children.map((child) => child.type === 'group'
        ? serializeGroup(child)
        : {
            field: child.field,
            operator: child.operator,
            value: child.value,
        }),
});

const summarizeGroup = (group: RuleGroupNode): string => group.children.map((child) => {
    if (child.type === 'group') return `(${summarizeGroup(child)})`;
    return `${child.field} ${child.operator} ${child.value || '[value]'}`;
}).join(` ${group.logic} `);

const summarizeActions = (actions: RuleActionForm[], resources: ResourceMaps): string => actions.map((action) => {
    const option = actionOptions.find((entry) => entry.value === action.type);
    if (!option) return action.type;
    if (!action.value) return option.label;

    const resolved = resolveOptionLabel(option.valueMode, action.value, resources);
    return `${option.label}: ${resolved}`;
}).join(' | ');

const resolveOptionLabel = (mode: string, value: string, resources: ResourceMaps): string => {
    if (!value) return '--';
    if (mode === 'folder') return resources.folders.find((item) => item.id === value)?.label || value;
    if (mode === 'user') return resources.users.find((item) => item.id === value)?.label || value;
    if (mode === 'team') return resources.teams.find((item) => item.id === value)?.label || value;
    if (mode === 'tag') return resources.tags.find((item) => item.id === value)?.label || value;
    if (mode === 'status') return statusOptions.find((item) => item.id === value)?.label || value;
    if (mode === 'priority') return threadPriorityOptions.find((item) => item.id === value)?.label || value;
    if (mode === 'webhook') return resources.webhooks.find((item) => item.id === value)?.label || value;
    return value;
};

type ResourceMaps = {
    users: ResourceOption[];
    teams: ResourceOption[];
    tags: ResourceOption[];
    folders: ResourceOption[];
    webhooks: ResourceOption[];
};

const RulesPage: React.FC = () => {
    const { t } = useTranslation();
    const { user } = useAuth();
    const canCreate = hasPermission(user?.permissions, 'rules:create');
    const canManage = hasPermission(user?.permissions, 'rules:manage');
    const canDelete = hasPermission(user?.permissions, 'rules:delete');
    const canViewWebhooks = hasPermission(user?.permissions, 'webhooks:view');

    const [rules, setRules] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
    const [deleteSubmitting, setDeleteSubmitting] = useState(false);
    const [form, setForm] = useState<RuleFormState>(createForm());
    const [formError, setFormError] = useState('');
    const [resources, setResources] = useState<ResourceMaps>({ users: [], teams: [], tags: [], folders: [], webhooks: [] });

    const loadRules = async () => {
        setLoading(true);
        try {
            const [rulesResponse, usersResponse, teamsResponse, tagsResponse, mailboxesResponse, webhooksResponse] = await Promise.all([
                api.get('/rules'),
                api.get('/users').catch(() => ({ data: [] })),
                api.get('/teams').catch(() => ({ data: [] })),
                api.get('/tags').catch(() => ({ data: [] })),
                api.get('/mailboxes').catch(() => ({ data: [] })),
                canViewWebhooks ? api.get('/webhooks').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
            ]);

            const mailboxFolders = Array.isArray(mailboxesResponse.data)
                ? mailboxesResponse.data.flatMap((mailbox: any) => Array.isArray(mailbox.folders)
                    ? mailbox.folders.map((folder: any) => ({ id: folder.id, label: `${mailbox.name} / ${folder.name}` }))
                    : [])
                : [];

            setRules(Array.isArray(rulesResponse.data) ? rulesResponse.data : []);
            setResources({
                users: Array.isArray(usersResponse.data) ? usersResponse.data.map((entry: any) => ({ id: entry.id, label: entry.fullName || entry.email })) : [],
                teams: Array.isArray(teamsResponse.data) ? teamsResponse.data.map((entry: any) => ({ id: entry.id, label: entry.name })) : [],
                tags: Array.isArray(tagsResponse.data) ? tagsResponse.data.map((entry: any) => ({ id: entry.id, label: entry.name })) : [],
                folders: mailboxFolders,
                webhooks: Array.isArray(webhooksResponse.data) ? webhooksResponse.data.map((entry: any) => ({ id: entry.id, label: entry.url })) : [],
            });
            setError(null);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to load rules.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadRules();
    }, [canViewWebhooks]);

    const openCreate = () => {
        setEditingRuleId(null);
        setForm(createForm());
        setFormError('');
        setIsModalOpen(true);
    };

    const openEdit = (rule: any) => {
        setEditingRuleId(rule.id);
        setForm(normalizeForm(rule));
        setFormError('');
        setIsModalOpen(true);
    };

    const updateGroup = (node: RuleNode, targetId: string, updater: (group: RuleGroupNode) => RuleGroupNode): RuleNode => {
        if (node.type !== 'group') return node;
        if (node.id === targetId) return updater(node);
        return { ...node, children: node.children.map((child) => updateGroup(child, targetId, updater)) };
    };

    const updateCondition = (node: RuleNode, targetId: string, patch: Partial<RuleConditionNode>): RuleNode => {
        if (node.type === 'condition') return node.id === targetId ? { ...node, ...patch } : node;
        return { ...node, children: node.children.map((child) => updateCondition(child, targetId, patch)) };
    };

    const removeNode = (node: RuleNode, targetId: string): RuleNode => {
        if (node.type !== 'group') return node;
        const nextChildren = node.children
            .filter((child) => child.id !== targetId)
            .map((child) => child.type === 'group' ? removeNode(child, targetId) : child);
        return { ...node, children: nextChildren.length > 0 ? nextChildren : [createCondition()] };
    };

    const saveRule = async () => {
        if (!form.name.trim()) {
            setFormError('Rule name is required.');
            return;
        }

        const payload = {
            name: form.name.trim(),
            isActive: form.isActive,
            priority: form.priority,
            conditionLogic: form.conditions.logic,
            executionMode: form.executionMode,
            conditions: serializeGroup(form.conditions),
            actions: form.actions.map((action) => toApiAction(action)),
        };

        try {
            if (editingRuleId) {
                const response = await api.patch(`/rules/${editingRuleId}`, payload);
                setRules((prev) => prev.map((entry) => entry.id === editingRuleId ? response.data : entry));
            } else {
                const response = await api.post('/rules', payload);
                setRules((prev) => [response.data, ...prev]);
            }
            setIsModalOpen(false);
        } catch (err: any) {
            setFormError(err?.response?.data?.message || 'Failed to save rule.');
        }
    };

    const toggleActive = async (rule: any) => {
        try {
            const response = await api.patch(`/rules/${rule.id}`, { isActive: !rule.isActive });
            setRules((prev) => prev.map((entry) => entry.id === rule.id ? response.data : entry));
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to update rule status.');
        }
    };

    const deleteRule = async (id: string) => {
        setDeleteSubmitting(true);
        try {
            await api.delete(`/rules/${id}`);
            setRules((prev) => prev.filter((entry) => entry.id !== id));
            setDeleteConfirm(null);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to delete rule.');
        } finally {
            setDeleteSubmitting(false);
        }
    };

    const rows = useMemo(() => rules.map((rule) => {
        const conditions = buildNodeFromApi(rule.conditions);
        const actions = Array.isArray(rule.actions) ? rule.actions.map((action: any) => ({ id: createId(), type: normalizeActionType(action.type), value: String(action.value || action.targetUserId || action.targetTeamId || action.tagId || action.status || action.priority || action.folderId || '') })) : [];
        return {
            ...rule,
            conditionsSummary: summarizeGroup(conditions),
            actionsSummary: summarizeActions(actions, resources),
        };
    }), [resources, rules]);

    if (loading) {
        return (
            <div className="max-w-7xl mx-auto space-y-6">
                <PageHeader
                    title={t('sidebar_rules', 'Rules')}
                    subtitle="Manage nested rule conditions, mailbox actions, user actions, priorities, and execution modes."
                    actions={canCreate ? (
                        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                            <Plus className="w-4 h-4" /> {t('rules_new', 'New Rule')}
                        </button>
                    ) : null}
                />
                <div className="rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                    <TablePageSkeleton cols={7} showHeader={false} />
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            <PageHeader
                title={t('sidebar_rules', 'Rules')}
                subtitle="Manage nested rule conditions, mailbox actions, user actions, priorities, and execution modes."
                actions={canCreate ? (
                    <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">
                        <Plus className="w-4 h-4" /> {t('rules_new', 'New Rule')}
                    </button>
                ) : null}
            />

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            {rows.length === 0 ? (
                <EmptyState icon={Zap} title="No rules configured" description="Create rules with nested condition groups, mailbox actions, user actions, and execution controls." />
            ) : (
                <>
                    <div className="space-y-3 lg:hidden">
                        {rows.map((rule) => (
                            <section key={rule.id} className="rounded-2xl border border-[var(--color-card-border)] bg-white p-4 shadow-[var(--shadow-sm)]">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-base font-semibold text-[var(--color-text-primary)]">{rule.name}</div>
                                        <div className="mt-1"><StatusBadge label={rule.isActive ? 'Active' : 'Inactive'} variant={rule.isActive ? 'success' : 'neutral'} /></div>
                                    </div>
                                    <button type="button" onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)} className="rounded-lg border border-[var(--color-card-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)]">
                                        {expandedId === rule.id ? 'Hide' : 'Details'}
                                    </button>
                                </div>
                                <div className="mt-3 grid gap-2 text-xs text-[var(--color-text-muted)]">
                                    <div><span className="font-semibold text-[var(--color-text-primary)]">Priority:</span> {rule.priority}</div>
                                    <div><span className="font-semibold text-[var(--color-text-primary)]">Execution:</span> {rule.executionMode || 'merge'}</div>
                                    <div><span className="font-semibold text-[var(--color-text-primary)]">Triggered:</span> {Number(rule.timesTriggered || 0).toLocaleString()}</div>
                                    <div><span className="font-semibold text-[var(--color-text-primary)]">Last Triggered:</span> {rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).toLocaleString() : '--'}</div>
                                </div>
                                {expandedId === rule.id && (
                                    <div className="mt-4 space-y-3">
                                        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/25 p-3 text-sm">
                                            <div className="mb-1 font-semibold text-[var(--color-text-primary)]">Conditions</div>
                                            <div className="text-[var(--color-text-muted)] whitespace-pre-wrap break-words">{rule.conditionsSummary}</div>
                                        </div>
                                        <div className="rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)]/25 p-3 text-sm">
                                            <div className="mb-1 font-semibold text-[var(--color-text-primary)]">Actions</div>
                                            <div className="text-[var(--color-text-muted)] whitespace-pre-wrap break-words">{rule.actionsSummary}</div>
                                        </div>
                                        <div className="flex justify-end gap-2">
                                            {canManage && <button type="button" onClick={() => void toggleActive(rule)} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm">{rule.isActive ? 'Deactivate' : 'Activate'}</button>}
                                            {canManage && <button type="button" onClick={() => openEdit(rule)} className="rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm">Edit</button>}
                                            {canDelete && <button type="button" onClick={() => setDeleteConfirm({ id: rule.id, name: rule.name || 'this rule' })} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600">Delete</button>}
                                        </div>
                                    </div>
                                )}
                            </section>
                        ))}
                    </div>

                    <div className="hidden lg:block rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[1320px] text-left">
                                <thead>
                                    <tr className="border-b border-[var(--color-card-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                                        <th className="px-4 py-3">Rule Name</th>
                                        <th className="px-4 py-3">Conditions</th>
                                        <th className="px-4 py-3">Actions</th>
                                        <th className="px-4 py-3">Priority Level</th>
                                        <th className="px-4 py-3">Execution Mode</th>
                                        <th className="px-4 py-3">Times Triggered</th>
                                        <th className="px-4 py-3">Last Triggered</th>
                                        <th className="px-4 py-3 text-right">Manage</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((rule) => (
                                        <tr key={rule.id} className="border-b border-[var(--color-card-border)]/70 align-top text-sm hover:bg-[var(--color-background)]/35">
                                            <td className="px-4 py-3">
                                                <button type="button" onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)} className="flex items-start gap-3 text-left">
                                                    {expandedId === rule.id ? <ChevronDown className="mt-0.5 h-4 w-4 text-[var(--color-text-muted)]" /> : <ChevronRight className="mt-0.5 h-4 w-4 text-[var(--color-text-muted)]" />}
                                                    <div>
                                                        <div className="font-medium text-[var(--color-text-primary)]">{rule.name}</div>
                                                        <div className="mt-1"><StatusBadge label={rule.isActive ? 'Active' : 'Inactive'} variant={rule.isActive ? 'success' : 'neutral'} /></div>
                                                    </div>
                                                </button>
                                            </td>
                                            <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] max-w-[320px] whitespace-pre-wrap break-words">{rule.conditionsSummary}</td>
                                            <td className="px-4 py-3 text-xs text-[var(--color-text-muted)] max-w-[320px] whitespace-pre-wrap break-words">{rule.actionsSummary}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{rule.priority}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)] capitalize">{rule.executionMode || 'merge'}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{Number(rule.timesTriggered || 0).toLocaleString()}</td>
                                            <td className="px-4 py-3 text-[var(--color-text-muted)]">{rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).toLocaleString() : '--'}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-1">
                                                    {canManage && <button type="button" onClick={() => void toggleActive(rule)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Power className="h-4 w-4" /></button>}
                                                    {canManage && <button type="button" onClick={() => openEdit(rule)} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-background)]"><Pencil className="h-4 w-4" /></button>}
                                                    {canDelete && <button type="button" onClick={() => setDeleteConfirm({ id: rule.id, name: rule.name || 'this rule' })} className="rounded-lg p-2 text-[var(--color-text-muted)] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingRuleId ? 'Edit Rule' : 'Create Rule'} size="lg">
                <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Rule Name</label>
                            <input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Priority Level</label>
                            <select value={form.priority} onChange={(event) => setForm((prev) => ({ ...prev, priority: Number(event.target.value) as 1 | 2 | 3 }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                                <option value={1}>1 = User</option>
                                <option value={2}>2 = Team</option>
                                <option value={3}>3 = Mailbox</option>
                            </select>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Execution Mode</label>
                            <select value={form.executionMode} onChange={(event) => setForm((prev) => ({ ...prev, executionMode: event.target.value as 'merge' | 'override' }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                                <option value="merge">merge</option>
                                <option value="override">override</option>
                            </select>
                        </div>
                        <label className="flex items-center gap-2 pt-8 text-sm text-[var(--color-text-primary)]">
                            <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))} />
                            Active
                        </label>
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Conditions</h3>
                            <span className="text-xs text-[var(--color-text-muted)]">AND groups, OR groups, unlimited nesting depth</span>
                        </div>
                        <RuleGroupEditor
                            group={form.conditions}
                            onChange={(nextGroup) => setForm((prev) => ({ ...prev, conditions: nextGroup }))}
                            updateGroup={updateGroup}
                            updateCondition={updateCondition}
                            removeNode={removeNode}
                        />
                    </div>

                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Actions</h3>
                            <button type="button" onClick={() => setForm((prev) => ({ ...prev, actions: [...prev.actions, createAction()] }))} className="text-sm font-medium text-[var(--color-primary)]">+ Add action</button>
                        </div>
                        {form.actions.map((action) => (
                            <RuleActionEditor
                                key={action.id}
                                action={action}
                                resources={resources}
                                onChange={(nextAction) => setForm((prev) => ({ ...prev, actions: prev.actions.map((entry) => entry.id === action.id ? nextAction : entry) }))}
                                onRemove={() => setForm((prev) => ({ ...prev, actions: prev.actions.length === 1 ? prev.actions : prev.actions.filter((entry) => entry.id !== action.id) }))}
                            />
                        ))}
                    </div>

                    {formError && <div className="text-sm text-red-600">{formError}</div>}

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">Cancel</button>
                        <button type="button" onClick={() => void saveRule()} className="rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-cta-secondary)]">Save Rule</button>
                    </div>
                </div>
            </Modal>
            <ConfirmDialog
                isOpen={Boolean(deleteConfirm)}
                title="Delete Rule"
                description={deleteConfirm ? `Are you sure you want to delete "${deleteConfirm.name}"?` : ''}
                confirmLabel="Delete"
                isSubmitting={deleteSubmitting}
                onCancel={() => setDeleteConfirm(null)}
                onConfirm={() => {
                    if (deleteConfirm) {
                        void deleteRule(deleteConfirm.id);
                    }
                }}
            />
        </div>
    );
};

type RuleGroupEditorProps = {
    group: RuleGroupNode;
    onChange: (group: RuleGroupNode) => void;
    updateGroup: (node: RuleNode, targetId: string, updater: (group: RuleGroupNode) => RuleGroupNode) => RuleNode;
    updateCondition: (node: RuleNode, targetId: string, patch: Partial<RuleConditionNode>) => RuleNode;
    removeNode: (node: RuleNode, targetId: string) => RuleNode;
};

const RuleGroupEditor: React.FC<RuleGroupEditorProps> = ({ group, onChange, updateGroup, updateCondition, removeNode }) => (
    <div className="space-y-3 rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)]/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                Logic
                <select value={group.logic} onChange={(event) => onChange({ ...group, logic: event.target.value as 'AND' | 'OR' })} className="rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-1.5 text-sm">
                    <option value="AND">AND</option>
                    <option value="OR">OR</option>
                </select>
            </div>
            <div className="flex items-center gap-3 text-sm">
                <button type="button" onClick={() => onChange({ ...group, children: [...group.children, createCondition()] })} className="font-medium text-[var(--color-primary)]">+ Condition</button>
                <button type="button" onClick={() => onChange({ ...group, children: [...group.children, createGroup()] })} className="font-medium text-[var(--color-primary)]">+ Group</button>
            </div>
        </div>

        <div className="space-y-3">
            {group.children.map((child) => child.type === 'group' ? (
                <div key={child.id} className="rounded-xl border border-[var(--color-card-border)] bg-white p-3">
                    <div className="mb-3 flex justify-end">
                        <button type="button" onClick={() => onChange(removeNode(group, child.id) as RuleGroupNode)} className="text-xs font-medium text-red-600">Remove group</button>
                    </div>
                    <RuleGroupEditor
                        group={child}
                        onChange={(nextChild) => onChange(updateGroup(group, child.id, () => nextChild) as RuleGroupNode)}
                        updateGroup={updateGroup}
                        updateCondition={updateCondition}
                        removeNode={removeNode}
                    />
                </div>
            ) : (
                <div key={child.id} className="grid gap-3 rounded-xl border border-[var(--color-card-border)] bg-white p-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
                    <select value={child.field} onChange={(event) => onChange(updateCondition(group, child.id, { field: event.target.value as RuleConditionField }) as RuleGroupNode)} className="min-w-0 rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                        {conditionFieldOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <select value={child.operator} onChange={(event) => onChange(updateCondition(group, child.id, { operator: event.target.value as RuleConditionOperator }) as RuleGroupNode)} className="min-w-0 rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                        {operatorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <input value={child.value} onChange={(event) => onChange(updateCondition(group, child.id, { value: event.target.value }) as RuleGroupNode)} placeholder="Value" className="min-w-0 rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                    <button type="button" onClick={() => onChange(removeNode(group, child.id) as RuleGroupNode)} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm text-red-600 hover:bg-red-50 xl:w-auto">Remove</button>
                </div>
            ))}
        </div>
    </div>
);

type RuleActionEditorProps = {
    action: RuleActionForm;
    resources: ResourceMaps;
    onChange: (action: RuleActionForm) => void;
    onRemove: () => void;
};

const RuleActionEditor: React.FC<RuleActionEditorProps> = ({ action, resources, onChange, onRemove }) => {
    const selectedAction = actionOptions.find((option) => option.value === action.type) || actionOptions[0];
    const options = getValueOptions(selectedAction.valueMode, resources);

    return (
        <div className="grid gap-3 rounded-xl border border-[var(--color-card-border)] p-3 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
            <select value={action.type} onChange={(event) => onChange({ ...action, type: event.target.value as RuleActionType, value: '' })} className="min-w-0 rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                {actionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {selectedAction.valueMode === 'none' ? (
                <div className="rounded-lg border border-dashed border-[var(--color-card-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">No extra value required.</div>
            ) : options.length > 0 ? (
                <select value={action.value} onChange={(event) => onChange({ ...action, value: event.target.value })} className="min-w-0 rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                    <option value="">{selectedAction.placeholder}</option>
                    {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
            ) : (
                <input value={action.value} onChange={(event) => onChange({ ...action, value: event.target.value })} placeholder={selectedAction.placeholder} className="min-w-0 rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
            )}
            <button type="button" onClick={onRemove} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm text-red-600 hover:bg-red-50 lg:w-auto">Remove</button>
        </div>
    );
};

const getValueOptions = (mode: string, resources: ResourceMaps): ResourceOption[] => {
    if (mode === 'folder') return resources.folders;
    if (mode === 'user') return resources.users;
    if (mode === 'team') return resources.teams;
    if (mode === 'tag') return resources.tags;
    if (mode === 'status') return statusOptions;
    if (mode === 'priority') return threadPriorityOptions;
    if (mode === 'webhook') return resources.webhooks;
    return [];
};

const toApiAction = (action: RuleActionForm) => {
    const selectedAction = actionOptions.find((option) => option.value === action.type);
    const base: Record<string, unknown> = { type: action.type, value: action.value || undefined };

    if (!selectedAction || selectedAction.valueMode === 'none') {
        delete base.value;
        return base;
    }

    if (selectedAction.valueMode === 'user') {
        if (action.type === 'notify') {
            return { ...base, targetUserId: action.value || undefined };
        }
        return { ...base, targetUserId: action.value || undefined };
    }
    if (selectedAction.valueMode === 'team') return { ...base, targetTeamId: action.value || undefined };
    if (selectedAction.valueMode === 'tag') return { ...base, tagId: action.value || undefined };
    if (selectedAction.valueMode === 'folder') return { ...base, folderId: action.value || undefined };
    if (selectedAction.valueMode === 'status') return { ...base, status: action.value || undefined };
    if (selectedAction.valueMode === 'priority') return { ...base, priority: action.value || undefined };
    return base;
};

export default RulesPage;

