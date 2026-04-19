import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Calendar as CalendarIcon,
    CalendarDays,
    CalendarPlus,
    ChevronLeft,
    ChevronRight,
    Clock3,
    List,
    Loader2,
    MapPin,
    PanelsTopLeft,
    Pencil,
    Send,
    Trash2,
    Users,
    Video,
} from 'lucide-react';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import StatusBadge from '../../../components/ui/StatusBadge';
import { InlineSkeleton } from '../../../components/ui/Skeleton';
import api from '../../../lib/api';
import { useWebSocket } from '../../../context/WebSocketContext';
import { useAuth } from '../../../context/AuthContext';
import { hasPermission } from '../../../hooks/usePermission';

type EventAttendee = {
    id?: string;
    email: string;
    name?: string | null;
    rsvpStatus?: string;
};

type CalendarEvent = {
    id: string;
    title: string;
    description?: string | null;
    startTime: string;
    endTime: string;
    timezone?: string | null;
    location?: string | null;
    provider?: string | null;
    meetingProvider?: string | null;
    meetingLink?: string | null;
    attendees?: EventAttendee[];
};

type CalendarViewMode = 'day' | 'week' | 'month' | 'list';

type CalendarFormState = {
    title: string;
    description: string;
    startTime: string;
    endTime: string;
    timezone: string;
    attendeeEmails: string;
    meetingProvider: '' | 'google_meet' | 'microsoft_teams' | 'zoom';
};

const weekDayLabels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const toInputDateTime = (date: Date) => {
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return local.toISOString().slice(0, 16);
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());

const startOfWeek = (date: Date) => {
    const result = startOfDay(date);
    result.setDate(result.getDate() - result.getDay());
    return result;
};

const endOfWeek = (date: Date) => {
    const result = startOfWeek(date);
    result.setDate(result.getDate() + 6);
    return endOfDay(result);
};

const startOfMonthGrid = (date: Date) => {
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
    return startOfWeek(firstOfMonth);
};

const isSameDay = (left: Date, right: Date) => (
    left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
);

const isDateWithinRange = (target: Date, start: Date, end: Date) => target.getTime() >= start.getTime() && target.getTime() <= end.getTime();

const formatTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const createForm = (baseDate?: Date): CalendarFormState => {
    const start = baseDate ? new Date(baseDate) : new Date(Date.now() + 3600000);
    if (baseDate) start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 3600000);

    return {
        title: '',
        description: '',
        startTime: toInputDateTime(start),
        endTime: toInputDateTime(end),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        attendeeEmails: '',
        meetingProvider: '',
    };
};

const providerLabel = (event: CalendarEvent) => {
    const value = event.provider || event.meetingProvider || '';
    if (value === 'google') return 'Google';
    if (value === 'microsoft') return 'Microsoft';
    if (value === 'caldav') return 'CalDAV';
    if (value === 'google_meet') return 'Google Meet';
    if (value === 'microsoft_teams') return 'Microsoft Teams';
    if (value === 'zoom') return 'Zoom';
    return 'Manual';
};

const eventAccentClasses = [
    'bg-[#e8efff] text-[#35518b] border-[#d7e3ff]',
    'bg-[#edf4ec] text-[#2f5a44] border-[#d8e7d8]',
    'bg-[#f6edf9] text-[#65427b] border-[#eadcf4]',
    'bg-[#fef3e8] text-[#8a5622] border-[#f7dec1]',
    'bg-[#eef1f7] text-[#46526b] border-[#dce3ef]',
];

const eventAccentClass = (eventId: string) => {
    const hash = Array.from(eventId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return eventAccentClasses[hash % eventAccentClasses.length];
};

const CalendarPage: React.FC = () => {
    const { socket } = useWebSocket();
    const { user } = useAuth();
    const canCreate = hasPermission(user?.permissions, 'calendar:create');
    const canManage = hasPermission(user?.permissions, 'calendar:manage');

    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [inviteStatus, setInviteStatus] = useState('');
    const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
    const [currentDate, setCurrentDate] = useState(startOfDay(new Date()));
    const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
    const [form, setForm] = useState<CalendarFormState>(createForm());
    const [formError, setFormError] = useState('');
    const [isSavingEvent, setIsSavingEvent] = useState(false);
    const [isSendingInvite, setIsSendingInvite] = useState(false);
    const [isDeletingEvent, setIsDeletingEvent] = useState(false);

    const syncGoogleCalendar = useCallback(async () => {
        if (!canManage) return;
        try {
            const integrations = await api.get('/integrations/status');
            if (integrations.data?.google?.connected) {
                await api.post('/calendar/sync/google', {});
            }
        } catch (err) {
            console.error('Failed to sync Google calendar', err);
        }
    }, [canManage]);

    const load = useCallback(async (background = false, syncExternal = false) => {
        if (!background) setLoading(true);
        setError('');
        try {
            if (syncExternal) {
                await syncGoogleCalendar();
            }
            const response = await api.get('/calendar/events');
            setEvents(Array.isArray(response.data) ? response.data : []);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to load calendar events.');
        } finally {
            setLoading(false);
        }
    }, [syncGoogleCalendar]);

    useEffect(() => {
        void load(false, true);
    }, [load]);

    useEffect(() => {
        if (!socket) return;
        const refresh = () => { void load(true, false); };
        socket.on('calendar:event_updated', refresh);
        socket.on('calendar:rsvp_received', refresh);
        socket.on('calendar:meeting_created', refresh);
        return () => {
            socket.off('calendar:event_updated', refresh);
            socket.off('calendar:rsvp_received', refresh);
            socket.off('calendar:meeting_created', refresh);
        };
    }, [load, socket]);

    useEffect(() => {
        if (!canManage) return undefined;
        const interval = window.setInterval(() => {
            void load(true, true);
        }, 5 * 60 * 1000);
        return () => window.clearInterval(interval);
    }, [canManage, load]);

    const normalizedEvents = useMemo(() => events
        .map((event) => ({
            ...event,
            startDate: new Date(event.startTime),
            endDate: new Date(event.endTime),
            attendeeList: (event.attendees || []).map((attendee) => attendee.email).join(', ') || '--',
            rsvpStatus: (event.attendees || []).map((attendee) => `${attendee.email}: ${attendee.rsvpStatus || 'needs_action'}`).join(' | ') || '--',
            displayMeetingLink: event.meetingLink || event.location || '--',
        }))
        .sort((left, right) => left.startDate.getTime() - right.startDate.getTime()), [events]);

    const monthTitle = useMemo(() => currentDate.toLocaleDateString([], { month: 'long', year: 'numeric' }), [currentDate]);

    const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(currentDate), index)), [currentDate]);

    const monthCells = useMemo(() => {
        const start = startOfMonthGrid(currentDate);
        return Array.from({ length: 42 }, (_, index) => addDays(start, index));
    }, [currentDate]);

    const visibleRange = useMemo(() => {
        if (viewMode === 'day') {
            return { start: startOfDay(currentDate), end: endOfDay(currentDate) };
        }
        if (viewMode === 'week') {
            return { start: startOfWeek(currentDate), end: endOfWeek(currentDate) };
        }
        return { start: monthCells[0], end: endOfDay(monthCells[monthCells.length - 1]) };
    }, [currentDate, monthCells, viewMode]);

    const visibleEvents = useMemo(() => normalizedEvents.filter((event) => isDateWithinRange(event.startDate, visibleRange.start, visibleRange.end)), [normalizedEvents, visibleRange]);

    const dayEventsMap = useMemo(() => {
        const map = new Map<string, typeof visibleEvents>();
        visibleEvents.forEach((event) => {
            const key = startOfDay(event.startDate).toISOString();
            const current = map.get(key) || [];
            current.push(event);
            map.set(key, current);
        });
        return map;
    }, [visibleEvents]);

    const selectedDayEvents = useMemo(() => {
        const key = startOfDay(currentDate).toISOString();
        return dayEventsMap.get(key) || [];
    }, [currentDate, dayEventsMap]);

    const monthEventCount = useMemo(() => normalizedEvents.filter((event) => event.startDate.getMonth() === currentDate.getMonth() && event.startDate.getFullYear() === currentDate.getFullYear()).length, [currentDate, normalizedEvents]);

    const viewOptions: Array<{ mode: CalendarViewMode; label: string; icon: React.ElementType }> = [
        { mode: 'month', label: 'Monthly', icon: CalendarDays },
        { mode: 'week', label: 'Weekly', icon: PanelsTopLeft },
        { mode: 'day', label: 'Daily', icon: List },
        { mode: 'list', label: 'List', icon: CalendarIcon },
    ];

    const periodButtonLabel = useMemo(() => {
        const today = startOfDay(new Date());
        if (viewMode === 'day') {
            return isSameDay(currentDate, today)
                ? 'Today'
                : currentDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
        if (viewMode === 'week') {
            const weekStart = startOfWeek(currentDate);
            const weekEnd = endOfWeek(currentDate);
            const todayInWeek = isDateWithinRange(today, weekStart, weekEnd);
            return todayInWeek
                ? 'Today'
                : `${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
        }
        if (viewMode === 'month') {
            return currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear()
                ? 'Today'
                : currentDate.toLocaleDateString([], { month: 'short', year: 'numeric' });
        }
        return currentDate.toLocaleDateString([], { month: 'short', year: 'numeric' });
    }, [currentDate, viewMode]);

    const changePeriod = (direction: -1 | 1) => {
        if (viewMode === 'day') {
            setCurrentDate((prev) => addDays(prev, direction));
            return;
        }
        if (viewMode === 'week') {
            setCurrentDate((prev) => addDays(prev, direction * 7));
            return;
        }
        setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + direction, 1));
    };

    const openCreate = (targetDate?: Date) => {
        setEditingEvent(null);
        setForm(createForm(targetDate));
        setFormError('');
        setInviteStatus('');
        setIsModalOpen(true);
    };

    const openEdit = (event: CalendarEvent) => {
        setEditingEvent(event);
        setSelectedEvent(null);
        setForm({
            title: event.title || '',
            description: event.description || '',
            startTime: toInputDateTime(new Date(event.startTime)),
            endTime: toInputDateTime(new Date(event.endTime)),
            timezone: event.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            attendeeEmails: (event.attendees || []).map((attendee) => attendee.email).join(', '),
            meetingProvider: (event.meetingProvider as CalendarFormState['meetingProvider']) || '',
        });
        setFormError('');
        setInviteStatus('');
        setIsModalOpen(true);
    };

    const saveEvent = async () => {
        if (isSavingEvent) return;
        if (!form.title.trim()) {
            setFormError('Event title is required.');
            return;
        }
        const attendees = form.attendeeEmails
            .split(',')
            .map((email) => email.trim())
            .filter(Boolean)
            .map((email) => ({ email }));

        const payload = {
            title: form.title.trim(),
            description: form.description.trim() || null,
            startTime: new Date(form.startTime).toISOString(),
            endTime: new Date(form.endTime).toISOString(),
            timezone: form.timezone.trim() || 'UTC',
            attendees,
            meetingProvider: form.meetingProvider || undefined,
        };

        setIsSavingEvent(true);
        try {
            if (editingEvent) {
                await api.patch(`/calendar/events/${editingEvent.id}`, payload);
            } else {
                await api.post('/calendar/events', payload);
            }
            setIsModalOpen(false);
            await load(true);
        } catch (err: any) {
            setFormError(err?.response?.data?.message || 'Failed to save event.');
        } finally {
            setIsSavingEvent(false);
        }
    };

    const deleteEvent = async (eventId: string) => {
        if (isDeletingEvent) return;
        setIsDeletingEvent(true);
        try {
            await api.delete(`/calendar/events/${eventId}`);
            setSelectedEvent(null);
            await load(true);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to delete event.');
        } finally {
            setIsDeletingEvent(false);
        }
    };

    const sendInvite = async (eventId: string) => {
        if (isSendingInvite) return;
        setIsSendingInvite(true);
        setInviteStatus('');
        try {
            const response = await api.post('/calendar/invite', { eventId });
            const sent = Number(response.data?.sent || 0);
            const failed = Number(response.data?.failed || 0);
            if (failed > 0) {
                setInviteStatus(`Invites sent to ${sent} attendee(s). ${failed} failed.`);
            } else {
                setInviteStatus(`Invite sent to ${sent} attendee(s).`);
            }
            await load(true);
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to send invite.');
        } finally {
            setIsSendingInvite(false);
        }
    };

    return (
        <div className="mx-auto max-w-[1280px] space-y-6">
            <div className="grid gap-6 xl:grid-cols-[156px_minmax(0,1fr)] xl:items-start">
                <aside className="xl:pt-[72px]">
                    <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-3 shadow-[var(--shadow-sm)]">
                        <div className="space-y-1.5">
                            {viewOptions.map(({ mode, label, icon: Icon }) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setViewMode(mode)}
                                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${viewMode === mode
                                        ? 'bg-[var(--color-cta-primary)] text-white shadow-[var(--shadow-sm)]'
                                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-background)]'
                                    }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    {label}
                                </button>
                            ))}
                        </div>
                        {canCreate && (
                            <button type="button" disabled={isSavingEvent} onClick={() => openCreate(currentDate)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-cta-primary)] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-cta-secondary)] disabled:cursor-not-allowed disabled:opacity-60">
                                <CalendarPlus className="h-4 w-4 shrink-0" /> <span className="whitespace-nowrap">Create Event</span>
                            </button>
                        )}
                    </div>
                </aside>

                <div className="min-w-0 space-y-4">
                    <div className="grid items-start gap-4 xl:grid-cols-[1fr_auto] xl:gap-6">
                        <div className="text-center xl:pl-[96px]">
                            <h1 className="text-4xl font-semibold tracking-tight text-[var(--color-text-primary)]">{monthTitle}</h1>
                            <p className="mt-2 inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-text-muted)]/60" />
                                {loading ? <InlineSkeleton className="h-4 w-40" /> : `${monthEventCount} event${monthEventCount === 1 ? '' : 's'} scheduled this month`}
                            </p>
                        </div>
                        <div className="flex justify-center xl:justify-end">
                            <div className="inline-flex items-center gap-2 self-start rounded-2xl border border-[var(--color-card-border)] bg-white p-1 shadow-[var(--shadow-sm)]">
                            <button type="button" onClick={() => changePeriod(-1)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => setCurrentDate(startOfDay(new Date()))} className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
                                {periodButtonLabel}
                            </button>
                            <button type="button" onClick={() => changePeriod(1)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:bg-[var(--color-background)]">
                                <ChevronRight className="h-4 w-4" />
                            </button>
                            </div>
                        </div>
                    </div>

                    {inviteStatus && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{inviteStatus}</div>}
                    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

                    {!loading && normalizedEvents.length === 0 ? (
                        <EmptyState icon={CalendarIcon} title="No calendar events" description="Create an event with attendees and a meeting provider to start managing invites and RSVP activity." />
                    ) : (
                        <section className="overflow-hidden rounded-[28px] border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)]">

                            {viewMode === 'month' && (
                                <div>
                                    <div className="grid grid-cols-7 border-b border-[var(--color-card-border)] bg-[#fbfbfd]">
                                        {weekDayLabels.map((label) => (
                                            <div key={label} className="px-3 py-4 text-center text-[11px] font-semibold tracking-[0.18em] text-[var(--color-text-muted)]">{label}</div>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-7">
                                        {monthCells.map((date) => {
                                            const dayKey = startOfDay(date).toISOString();
                                            const dayEvents = dayEventsMap.get(dayKey) || [];
                                            const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                                            const isToday = isSameDay(date, new Date());
                                            return (
                                                <button
                                                    key={dayKey}
                                                    type="button"
                                                    onClick={() => {
                                                        setCurrentDate(date);
                                                        if (dayEvents.length === 1) setSelectedEvent(dayEvents[0]);
                                                    }}
                                                    className={`min-h-[138px] border-b border-r border-[var(--color-card-border)] px-4 py-4 text-left transition-colors hover:bg-[#fafbff] ${!isCurrentMonth ? 'bg-[#fafafa]' : 'bg-white'}`}
                                                >
                                                    <div className={`text-sm font-medium ${isToday ? 'inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-[var(--color-cta-primary)] px-2 text-white' : isCurrentMonth ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                                                        {date.getDate()}
                                                    </div>
                                                    <div className="mt-3 space-y-2">
                                                        {dayEvents.slice(0, 2).map((event) => (
                                                            <div
                                                                key={event.id}
                                                                onClick={(evt) => {
                                                                    evt.stopPropagation();
                                                                    setSelectedEvent(event);
                                                                }}
                                                                className={`rounded-lg border px-2.5 py-2 text-left text-xs shadow-none ${eventAccentClass(event.id)}`}
                                                            >
                                                                <div className="line-clamp-2 font-medium">{event.title}</div>
                                                                <div className="mt-1 text-[10px] opacity-80">{formatTime(event.startTime)}{viewMode === 'month' ? '' : ` - ${formatTime(event.endTime)}`}</div>
                                                            </div>
                                                        ))}
                                                        {dayEvents.length > 2 && <div className="text-xs text-[var(--color-text-muted)]">+{dayEvents.length - 2} more</div>}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {viewMode === 'week' && (
                                <div className="grid grid-cols-1 gap-px bg-[var(--color-card-border)] sm:grid-cols-7">
                                    {weekDates.map((date) => {
                                        const dayKey = startOfDay(date).toISOString();
                                        const dayEvents = dayEventsMap.get(dayKey) || [];
                                        const isToday = isSameDay(date, new Date());
                                        return (
                                            <div key={dayKey} className="min-h-[320px] bg-white p-4">
                                                <div className="mb-4">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">{date.toLocaleDateString([], { weekday: 'short' })}</div>
                                                    <div className={`mt-2 inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-base font-semibold ${isToday ? 'bg-[var(--color-cta-primary)] text-white' : 'text-[var(--color-text-primary)]'}`}>{date.getDate()}</div>
                                                </div>
                                                <div className="space-y-2">
                                                    {dayEvents.length === 0 ? (
                                                        <div className="rounded-xl border border-dashed border-[var(--color-card-border)] px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">No events</div>
                                                    ) : dayEvents.map((event) => (
                                                        <button
                                                            key={event.id}
                                                            type="button"
                                                            onClick={() => setSelectedEvent(event)}
                                                            className={`w-full rounded-xl border px-3 py-3 text-left ${eventAccentClass(event.id)}`}
                                                        >
                                                            <div className="line-clamp-2 text-sm font-semibold">{event.title}</div>
                                                            <div className="mt-1 text-[11px] opacity-80">{formatTime(event.startTime)} - {formatTime(event.endTime)}</div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {viewMode === 'day' && (
                                <div className="px-4 py-5 sm:px-6">
                                    <div className="mb-4 flex items-center justify-between rounded-2xl border border-[var(--color-card-border)] bg-[#fbfbfd] px-4 py-4">
                                        <div>
                                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">Selected Day</div>
                                            <div className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">{currentDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                                        </div>
                                        {canCreate && <button type="button" disabled={isSavingEvent} onClick={() => openCreate(currentDate)} className="rounded-xl bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-cta-secondary)] disabled:cursor-not-allowed disabled:opacity-60">Create Event</button>}
                                    </div>
                                    <div className="space-y-3">
                                        {selectedDayEvents.length === 0 ? (
                                            <div className="rounded-2xl border border-dashed border-[var(--color-card-border)] bg-white px-6 py-14 text-center text-sm text-[var(--color-text-muted)]">
                                                No events scheduled for this day.
                                            </div>
                                        ) : selectedDayEvents.map((event) => (
                                            <button
                                                key={event.id}
                                                type="button"
                                                onClick={() => setSelectedEvent(event)}
                                                className="w-full rounded-2xl border border-[var(--color-card-border)] bg-white px-5 py-4 text-left transition-colors hover:bg-[#fafbff]"
                                            >
                                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                                    <div>
                                                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">{formatTime(event.startTime)} - {formatTime(event.endTime)}</div>
                                                        <h3 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">{event.title}</h3>
                                                        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{event.description || providerLabel(event)}</p>
                                                    </div>
                                                    <StatusBadge label={providerLabel(event)} variant="info" />
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {viewMode === 'list' && (
                                <div className="px-4 py-5 sm:px-6">
                                    <div className="space-y-3">
                                        {visibleEvents.length === 0 ? (
                                            <div className="rounded-2xl border border-dashed border-[var(--color-card-border)] bg-white px-6 py-14 text-center text-sm text-[var(--color-text-muted)]">
                                                No events found for this period.
                                            </div>
                                        ) : visibleEvents.map((event) => (
                                            <button
                                                key={event.id}
                                                type="button"
                                                onClick={() => setSelectedEvent(event)}
                                                className="w-full rounded-2xl border border-[var(--color-card-border)] bg-white px-5 py-4 text-left transition-colors hover:bg-[#fafbff]"
                                            >
                                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                    <div className="min-w-0 space-y-2">
                                                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-text-muted)]">
                                                            <span>{new Date(event.startTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                                                            <span>-</span>
                                                            <span>{formatTime(event.startTime)} - {formatTime(event.endTime)}</span>
                                                        </div>
                                                        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{event.title}</h3>
                                                        <p className="text-sm text-[var(--color-text-muted)] line-clamp-2">{event.description || 'No description provided.'}</p>
                                                        <div className="flex flex-wrap gap-2 pt-1">
                                                            <StatusBadge label={providerLabel(event)} variant="info" />
                                                            {event.attendees?.length ? <StatusBadge label={`${event.attendees.length} attendee${event.attendees.length === 1 ? '' : 's'}`} variant="neutral" /> : null}
                                                        </div>
                                                    </div>
                                                    <div className="text-sm text-[var(--color-text-muted)] lg:text-right">
                                                        <div>{event.timezone || 'UTC'}</div>
                                                        <div className="mt-1 line-clamp-2 max-w-[260px] break-words">{event.displayMeetingLink !== '--' ? event.displayMeetingLink : 'No meeting link'}</div>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </section>
                    )}
                </div>
            </div>

            <Modal isOpen={Boolean(selectedEvent)} onClose={() => setSelectedEvent(null)} title={selectedEvent?.title || 'Event Details'} size="lg">
                {selectedEvent && (
                    <div className="space-y-5">
                        <div className="rounded-2xl border border-[var(--color-card-border)] bg-[var(--color-background)]/25 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge label={providerLabel(selectedEvent)} variant="info" />
                                {selectedEvent.meetingLink && <StatusBadge label="Meeting Ready" variant="success" />}
                            </div>
                            <p className="mt-3 text-sm leading-7 text-[var(--color-text-muted)]">{selectedEvent.description || 'No description provided.'}</p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            <DetailCard icon={Clock3} label="Start" value={new Date(selectedEvent.startTime).toLocaleString()} />
                            <DetailCard icon={Clock3} label="End" value={new Date(selectedEvent.endTime).toLocaleString()} />
                            <DetailCard icon={CalendarIcon} label="Timezone" value={selectedEvent.timezone || 'UTC'} />
                            <DetailCard icon={MapPin} label="Location" value={selectedEvent.location || '--'} />
                        </div>

                        <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-4">
                            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                                <Users className="h-4 w-4" /> Attendees
                            </div>
                            <div className="space-y-2">
                                {(selectedEvent.attendees || []).length === 0 ? (
                                    <p className="text-sm text-[var(--color-text-muted)]">No attendees added.</p>
                                ) : (selectedEvent.attendees || []).map((attendee) => (
                                    <div key={`${selectedEvent.id}-${attendee.email}`} className="flex flex-col gap-1 rounded-xl border border-[var(--color-card-border)] px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                                        <span className="text-[var(--color-text-primary)]">{attendee.email}</span>
                                        <span className="text-[var(--color-text-muted)] capitalize">{attendee.rsvpStatus || 'needs_action'}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {selectedEvent.meetingLink && (
                            <a href={selectedEvent.meetingLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-card-border)] bg-white px-4 py-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]">
                                <Video className="h-4 w-4" /> Open Meeting Link
                            </a>
                        )}

                        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            {canCreate && (
                                <button
                                    type="button"
                                    disabled={isSendingInvite || isDeletingEvent}
                                    onClick={() => void sendInvite(selectedEvent.id)}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-card-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSendingInvite ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                    {isSendingInvite ? 'Sending...' : 'Send Invite'}
                                </button>
                            )}
                            {canManage && <button type="button" disabled={isSendingInvite || isDeletingEvent} onClick={() => openEdit(selectedEvent)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-card-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60"><Pencil className="h-4 w-4" /> Edit</button>}
                            {canManage && (
                                <button
                                    type="button"
                                    disabled={isDeletingEvent || isSendingInvite}
                                    onClick={() => void deleteEvent(selectedEvent.id)}
                                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isDeletingEvent ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                    {isDeletingEvent ? 'Deleting...' : 'Delete'}
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </Modal>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingEvent ? 'Update Event' : 'Create Event'} size="lg">
                <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="md:col-span-2">
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Event Title</label>
                            <input value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Event Description</label>
                            <textarea value={form.description} onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))} className="min-h-24 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Start Time</label>
                            <input type="datetime-local" value={form.startTime} onChange={(event) => setForm((prev) => ({ ...prev, startTime: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">End Time</label>
                            <input type="datetime-local" value={form.endTime} onChange={(event) => setForm((prev) => ({ ...prev, endTime: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Timezone</label>
                            <input value={form.timezone} onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Meeting Provider</label>
                            <select value={form.meetingProvider} onChange={(event) => setForm((prev) => ({ ...prev, meetingProvider: event.target.value as CalendarFormState['meetingProvider'] }))} className="w-full rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-2 text-sm">
                                <option value="">No provider</option>
                                <option value="google_meet">Google Meet</option>
                                <option value="microsoft_teams">Microsoft Teams</option>
                                <option value="zoom">Zoom</option>
                            </select>
                        </div>
                        <div className="md:col-span-2">
                            <label className="mb-1.5 block text-sm font-medium text-[var(--color-text-primary)]">Attendees (emails)</label>
                            <textarea value={form.attendeeEmails} onChange={(event) => setForm((prev) => ({ ...prev, attendeeEmails: event.target.value }))} placeholder="email1@example.com, email2@example.com" className="min-h-20 w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                        </div>
                    </div>

                    {formError && <div className="text-sm text-red-600">{formError}</div>}

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button type="button" disabled={isSavingEvent} onClick={() => setIsModalOpen(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60">Cancel</button>
                        <button type="button" disabled={isSavingEvent} onClick={() => void saveEvent()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--color-cta-primary)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60">
                            {isSavingEvent ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {isSavingEvent ? (editingEvent ? 'Updating...' : 'Creating...') : (editingEvent ? 'Update Event' : 'Create Event')}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

const DetailCard: React.FC<{ icon: React.ElementType; label: string; value: string }> = ({ icon: Icon, label, value }) => (
    <div className="rounded-2xl border border-[var(--color-card-border)] bg-white p-4">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            <Icon className="h-4 w-4" /> {label}
        </div>
        <div className="mt-2 text-sm text-[var(--color-text-primary)] break-words">{value}</div>
    </div>
);

export default CalendarPage;
