import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import SaasCalendarPicker from '../ui/SaasCalendarPicker';
import api from '../../lib/api';
import {
    formatAttachmentSize,
    summarizeAttachmentUploadFailure,
    uploadAttachmentsForMessage,
} from '../../lib/attachmentUploads';

interface ComposeDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    defaultMailboxId?: string;
}

type MailboxOption = {
    id: string;
    name: string;
    email: string;
};

type RecurrencePreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
type PendingAttachment = {
    id: string;
    file: File;
};

const weekdayByIndex = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const buildRrule = (preset: RecurrencePreset, scheduledFor: Date | null) => {
    if (!scheduledFor || preset === 'none') return null;

    const intervalLine = `INTERVAL=1`;

    if (preset === 'daily') {
        return `FREQ=DAILY;${intervalLine}`;
    }

    if (preset === 'weekdays') {
        return `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;${intervalLine}`;
    }

    if (preset === 'weekly') {
        const weekday = weekdayByIndex[scheduledFor.getDay()] || 'MO';
        return `FREQ=WEEKLY;BYDAY=${weekday};${intervalLine}`;
    }

    const dayOfMonth = Math.min(31, Math.max(1, scheduledFor.getDate()));
    return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth};${intervalLine}`;
};

const ComposeDrawer: React.FC<ComposeDrawerProps> = ({ isOpen, onClose, defaultMailboxId }) => {
    const attachmentInputRef = useRef<HTMLInputElement | null>(null);
    const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
    const [loadingMailboxes, setLoadingMailboxes] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        mailboxId: '',
        to: '',
        subject: '',
        body: '',
    });
    const [isScheduleOpen, setIsScheduleOpen] = useState(false);
    const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
    const [recurrencePreset, setRecurrencePreset] = useState<RecurrencePreset>('none');
    const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);

    useEffect(() => {
        if (isOpen) {
            setFormData({
                mailboxId: defaultMailboxId || '',
                to: '',
                subject: '',
                body: '',
            });
            setIsScheduleOpen(false);
            setScheduledAt(null);
            setRecurrencePreset('none');
            setPendingAttachments([]);
            setError(null);
        }
    }, [isOpen, defaultMailboxId]);

    const detectedTimezone = useMemo(() => {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch {
            return 'UTC';
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const loadMailboxes = async () => {
            setLoadingMailboxes(true);
            try {
                const response = await api.get('/mailboxes');
                const items = Array.isArray(response.data) ? response.data : [];
                const normalized = items
                    .filter((mailbox: any) => mailbox.id && mailbox.email)
                    .map((mailbox: any) => ({
                        id: mailbox.id,
                        name: mailbox.name,
                        email: mailbox.email,
                    }));
                setMailboxes(normalized);
                setFormData((prev) => ({
                    ...prev,
                    mailboxId:
                        (prev.mailboxId && normalized.some((mailbox) => mailbox.id === prev.mailboxId)
                            ? prev.mailboxId
                            : '')
                        || (defaultMailboxId && normalized.some((mailbox) => mailbox.id === defaultMailboxId)
                            ? defaultMailboxId
                            : '')
                        || normalized[0]?.id
                        || '',
                }));
            } catch (err: any) {
                setError(err?.userMessage || err?.response?.data?.message || 'Failed to load mailboxes.');
            } finally {
                setLoadingMailboxes(false);
            }
        };

        loadMailboxes();
    }, [isOpen, defaultMailboxId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleBodyChange = (value: string) => {
        setFormData(prev => ({ ...prev, body: value }));
    };

    const handleAttachmentSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        if (files.length === 0) {
            event.target.value = '';
            return;
        }

        setPendingAttachments((prev) => {
            const next = [...prev];
            const existingKeys = new Set(
                prev.map(({ file }) => `${file.name}:${file.size}:${file.lastModified}`),
            );

            files.forEach((file) => {
                const fileKey = `${file.name}:${file.size}:${file.lastModified}`;
                if (existingKeys.has(fileKey)) return;

                next.push({
                    id:
                        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                            ? crypto.randomUUID()
                            : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    file,
                });
                existingKeys.add(fileKey);
            });

            return next;
        });

        event.target.value = '';
    };

    const removePendingAttachment = (attachmentId: string) => {
        setPendingAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
    };

    const modules = useMemo(() => ({
        toolbar: [
            [{ 'header': [1, 2, false] }],
            ['bold', 'italic', 'underline', 'strike', 'blockquote'],
            [{ 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
            [{ 'align': [] }],
            ['link', 'image'],
            ['clean']
        ],
    }), []);

    const formats = [
        'header',
        'bold', 'italic', 'underline', 'strike', 'blockquote',
        'list', 'indent',
        'align',
        'link',
        'image'
    ];

    const submitCompose = async (scheduledFor?: Date | null, recurrence?: RecurrencePreset) => {
        if (!formData.mailboxId || !formData.to.trim() || !formData.subject.trim()) {
            setError('Mailbox, recipient, and subject are required.');
            return;
        }

        const normalizedRecurrence = recurrence || 'none';
        const rrule = buildRrule(normalizedRecurrence, scheduledFor || null);

        setSubmitting(true);
        setError(null);
        try {
            const response = await api.post('/threads/compose', {
                mailboxId: formData.mailboxId,
                to: [formData.to.trim()],
                subject: formData.subject.trim(),
                bodyHtml: formData.body,
                bodyText: formData.body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
                ...(scheduledFor ? { scheduledAt: scheduledFor.toISOString() } : {}),
                ...(rrule ? { rrule, timezone: detectedTimezone } : {}),
            });

            const createdMessageId = String(response.data?.message?.id || '').trim();
            if (!createdMessageId) {
                throw new Error('Compose response did not include a message id.');
            }

            if (pendingAttachments.length > 0) {
                const { failed } = await uploadAttachmentsForMessage(
                    createdMessageId,
                    pendingAttachments.map((attachment) => attachment.file),
                );

                if (failed.length > 0) {
                    setFormData({
                        mailboxId: defaultMailboxId || '',
                        to: '',
                        subject: '',
                        body: '',
                    });
                    setPendingAttachments([]);
                    setIsScheduleOpen(false);
                    setScheduledAt(null);
                    setRecurrencePreset('none');
                    setError(`Message sent, but ${summarizeAttachmentUploadFailure(failed)}`);
                    return;
                }
            }

            window.dispatchEvent(new CustomEvent('sermuno:compose-sent'));
            onClose();
        } catch (err: any) {
            setError(err?.userMessage || err?.response?.data?.message || 'Failed to send message.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSend = () => submitCompose(null, 'none');

    const handleSchedule = () => {
        if (!scheduledAt) return;
        submitCompose(scheduledAt, recurrencePreset);
    };

    const selectedMailbox = mailboxes.find((mailbox) => mailbox.id === formData.mailboxId);

    return (
        <div className={`fixed inset-0 z-50 flex justify-end overflow-hidden transition-all duration-500 ${isOpen ? 'pointer-events-auto visible' : 'pointer-events-none invisible delay-300'}`}>
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-[var(--color-text-primary)]/35 transition-opacity duration-500 ease-in-out ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            ></div>

            <div
                className={`w-full max-w-2xl h-full bg-white shadow-[var(--shadow-lg)] transform transition-transform duration-500 cubic-bezier(0.32, 0.72, 0, 1) flex flex-col relative z-10 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
                style={{ transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
            >
                <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[var(--color-card-border)] shrink-0">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">New Message</h2>
                    <button
                        onClick={onClose}
                        className="p-1 sm:p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] rounded-full transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar">
                    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                        {error && (
                            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {error}
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <label htmlFor="from" className="block text-sm font-medium text-[var(--color-text-primary)]">From</label>
                            <div className="relative">
                                <select
                                    id="from"
                                    name="mailboxId"
                                    value={formData.mailboxId}
                                    onChange={handleChange}
                                    disabled={loadingMailboxes || mailboxes.length === 0}
                                    className="block w-full px-3 py-2.5 text-base border border-[var(--color-input-border)] focus:outline-none sm:text-sm rounded-lg shadow-sm transition-all bg-white"
                                >
                                    {loadingMailboxes ? <option value="">Loading mailboxes...</option> : null}
                                    {!loadingMailboxes && mailboxes.length === 0 ? <option value="">No mailboxes available</option> : null}
                                    {mailboxes.map((mailbox) => (
                                        <option key={mailbox.id} value={mailbox.id}>{mailbox.name} &lt;{mailbox.email}&gt;</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* To */}
                        <div className="space-y-1.5">
                            <label htmlFor="to" className="block text-sm font-medium text-[var(--color-text-primary)]">To</label>
                            <input
                                type="email"
                                name="to"
                                id="to"
                                value={formData.to}
                                onChange={handleChange}
                                placeholder="Recipient email..."
                                className="block w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none transition-all shadow-sm sm:text-sm"
                            />
                        </div>

                        {/* Subject */}
                        <div className="space-y-1.5">
                            <label htmlFor="subject" className="block text-sm font-medium text-[var(--color-text-primary)]">Subject</label>
                            <input
                                type="text"
                                name="subject"
                                id="subject"
                                value={formData.subject}
                                onChange={handleChange}
                                className="block w-full px-3 py-2.5 border border-[var(--color-input-border)] rounded-lg text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none transition-all shadow-sm sm:text-sm"
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <label className="block text-sm font-medium text-[var(--color-text-primary)]">Attachments</label>
                                <button
                                    type="button"
                                    onClick={() => attachmentInputRef.current?.click()}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-background)]"
                                >
                                    <Paperclip className="h-3.5 w-3.5" />
                                    Add files
                                </button>
                                <input
                                    ref={attachmentInputRef}
                                    data-testid="compose-attachment-input"
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={handleAttachmentSelection}
                                />
                            </div>
                            {pendingAttachments.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                    {pendingAttachments.map((attachment) => (
                                        <div
                                            key={attachment.id}
                                            className="inline-flex max-w-full items-center gap-2 rounded-full border border-[var(--color-card-border)] bg-[var(--color-background)]/40 px-3 py-1.5 text-xs text-[var(--color-text-primary)]"
                                        >
                                            <Paperclip className="h-3 w-3 shrink-0 text-[var(--color-text-muted)]" />
                                            <span className="max-w-[220px] truncate">{attachment.file.name}</span>
                                            {formatAttachmentSize(attachment.file.size) ? (
                                                <span className="shrink-0 text-[var(--color-text-muted)]">
                                                    ({formatAttachmentSize(attachment.file.size)})
                                                </span>
                                            ) : null}
                                            <button
                                                type="button"
                                                onClick={() => removePendingAttachment(attachment.id)}
                                                className="rounded-full p-0.5 text-[var(--color-text-muted)] transition-colors hover:bg-white hover:text-[var(--color-text-primary)]"
                                                aria-label={`Remove ${attachment.file.name}`}
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-[var(--color-text-muted)]">
                                    No attachments selected.
                                </p>
                            )}
                        </div>

                        {/* Body (Editor-like) */}
                        <div className="space-y-1.5 flex-1 flex flex-col min-h-0">
                            <label htmlFor="body" className="block text-sm font-medium text-[var(--color-text-primary)]">Message</label>
                            <div className="compose-quill flex-1 border border-[var(--color-input-border)] rounded-lg bg-white flex flex-col overflow-visible">
                                <ReactQuill
                                    theme="snow"
                                    value={formData.body}
                                    onChange={handleBodyChange}
                                    modules={modules}
                                    formats={formats}
                                    className="h-full flex flex-col"
                                />
                            </div>
                            <style>{`
                                .compose-quill .ql-container.ql-snow {
                                    border: none !important;
                                    flex: 1;
                                    overflow: visible;
                                    font-size: 0.875rem;
                                    font-family: inherit;
                                }
                                .compose-quill .ql-toolbar.ql-snow {
                                    border: none !important;
                                    border-bottom: 1px solid var(--color-card-border) !important;
                                    background-color: var(--color-background);
                                    border-top-left-radius: 0.5rem;
                                    border-top-right-radius: 0.5rem;
                                }
                                .compose-quill .ql-editor {
                                    min-height: 400px;
                                    max-height: min(52vh, 420px);
                                    overflow-y: auto;
                                    word-break: break-word;
                                }
                                .compose-quill .ql-editor:focus-visible {
                                    outline: none;
                                }
                                .compose-quill .ql-tooltip {
                                    left: 0 !important;
                                    right: 0 !important;
                                    width: auto !important;
                                    max-width: calc(100% - 1rem) !important;
                                    margin: 0 0.5rem !important;
                                    box-sizing: border-box;
                                    white-space: normal;
                                    z-index: 30;
                                }
                                .compose-quill .ql-tooltip input[type='text'] {
                                    width: calc(100% - 4.5rem) !important;
                                    min-width: 0;
                                }
                                .compose-quill:focus-within {
                                    border-color: var(--color-input-border);
                                }
                                @media (max-width: 640px) {
                                    .compose-quill .ql-editor {
                                        min-height: 260px;
                                    }
                                    .compose-quill .ql-tooltip {
                                        max-width: calc(100% - 0.75rem) !important;
                                        margin: 0 0.375rem !important;
                                        font-size: 0.8125rem;
                                    }
                                    .compose-quill .ql-tooltip input[type='text'] {
                                        width: calc(100% - 4rem) !important;
                                    }
                                }
                            `}</style>
                        </div>
                    </div>
                </div>

                {/* Footer Toolbar */}
                <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-[var(--color-card-border)] bg-[var(--color-background)]/40 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2">
                        {/* Toolbar moved to Quill */}
                    </div>

                    <div className="relative flex items-center gap-2 sm:gap-3">
                        <button
                            onClick={onClose}
                            className="px-3 sm:px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] rounded-lg transition-colors cursor-pointer"
                        >
                            <span className="sm:hidden">Cancel</span>
                            <span className="hidden sm:inline">Discard</span>
                        </button>
                        <div>
                            <button
                                onClick={() => setIsScheduleOpen(prev => !prev)}
                                className="px-3 sm:px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] border border-[var(--color-card-border)] bg-white hover:bg-[var(--color-background)] rounded-lg transition-colors cursor-pointer"
                            >
                                <span className="sm:hidden">Delay</span>
                                <span className="hidden sm:inline">Schedule</span>
                            </button>
                        </div>
                        {isScheduleOpen && (
                            <div className="absolute right-0 bottom-full mb-2 w-[min(22rem,calc(100vw-2rem))] bg-white border border-[var(--color-card-border)] rounded-2xl shadow-lg z-20 p-3">
                                <label className="block text-xs font-medium text-[var(--color-text-primary)] mb-2">
                                    Schedule send for
                                </label>
                                <SaasCalendarPicker
                                    value={scheduledAt}
                                    onChange={setScheduledAt}
                                    includeTime
                                    minDate={new Date()}
                                />
                                <div className="mt-3">
                                    <label className="mb-1.5 block text-xs font-medium text-[var(--color-text-primary)]">
                                        Repeat
                                    </label>
                                    <select
                                        value={recurrencePreset}
                                        onChange={(event) => setRecurrencePreset(event.target.value as RecurrencePreset)}
                                        className="block w-full rounded-md border border-[var(--color-input-border)] bg-white px-2.5 py-2 text-xs text-[var(--color-text-primary)]"
                                    >
                                        <option value="none">Does not repeat</option>
                                        <option value="daily">Daily</option>
                                        <option value="weekdays">Weekdays</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                    <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                        Timezone: {detectedTimezone}
                                    </p>
                                </div>
                                <div className="mt-3 flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsScheduleOpen(false)}
                                        className="px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSchedule}
                                        disabled={!scheduledAt || submitting}
                                        className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--color-cta-primary)] rounded-md hover:bg-[var(--color-cta-secondary)] disabled:opacity-60"
                                    >
                                        <span className="sm:hidden">Schedule</span>
                                        <span className="hidden sm:inline">Schedule Send</span>
                                    </button>
                                </div>
                            </div>
                        )}
                        <button
                            onClick={handleSend}
                            disabled={submitting || loadingMailboxes || mailboxes.length === 0}
                            className="px-4 sm:px-6 py-2 text-sm font-medium text-white bg-[var(--color-cta-primary)] hover:bg-[var(--color-cta-secondary)] rounded-lg shadow-sm transition-all cursor-pointer"
                        >
                            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                            <span className="sm:hidden">{submitting ? 'Sending...' : 'Send'}</span>
                            <span className="hidden sm:inline">{submitting ? 'Sending...' : 'Send Message'}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ComposeDrawer;
