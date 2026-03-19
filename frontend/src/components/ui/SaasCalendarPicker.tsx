import React from 'react';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { format } from 'date-fns';

interface SaasCalendarPickerProps {
    value: Date | null;
    onChange: (value: Date | null) => void;
    includeTime?: boolean;
    minDate?: Date;
}

function setTimeParts(base: Date, hour12: number, minute: number, meridiem: 'AM' | 'PM') {
    const next = new Date(base);
    let hours = hour12 % 12;
    if (meridiem === 'PM') hours += 12;
    next.setHours(hours, minute, 0, 0);
    return next;
}

export default function SaasCalendarPicker({
    value,
    onChange,
    includeTime = false,
    minDate
}: SaasCalendarPickerProps) {
    const selected = value ?? undefined;

    const displayHour24 = value?.getHours() ?? 9;
    const meridiem: 'AM' | 'PM' = displayHour24 >= 12 ? 'PM' : 'AM';
    const hour12 = ((displayHour24 + 11) % 12) + 1;
    const minute = value?.getMinutes() ?? 0;

    const handleDaySelect = (date?: Date) => {
        if (!date) {
            onChange(null);
            return;
        }

        if (!includeTime) {
            onChange(date);
            return;
        }

        const next = setTimeParts(
            date,
            hour12,
            minute,
            meridiem
        );
        onChange(next);
    };

    const handleTimeChange = (updates: { hour12?: number; minute?: number; meridiem?: 'AM' | 'PM' }) => {
        const base = value ? new Date(value) : new Date();
        const next = setTimeParts(
            base,
            updates.hour12 ?? hour12,
            updates.minute ?? minute,
            updates.meridiem ?? meridiem
        );
        onChange(next);
    };

    return (
        <div className="w-full rounded-xl border border-[var(--color-card-border)] bg-white p-3">
            <LocalizationProvider dateAdapter={AdapterDateFns}>
                <DateCalendar
                    value={selected ?? null}
                    onChange={(newValue) => handleDaySelect(newValue ?? undefined)}
                    minDate={minDate}
                    showDaysOutsideCurrentMonth
                    reduceAnimations
                    openTo="day"
                    views={['year', 'month', 'day']}
                    sx={{
                        width: '100%',
                        maxWidth: '17.25rem',
                        margin: 0,
                        backgroundColor: '#FFFFFF',
                        padding: 0,
                        '& .MuiPickersCalendarHeader-root': {
                            paddingLeft: '2px',
                            paddingRight: '2px',
                            marginTop: 0,
                            marginBottom: '6px',
                        },
                        '& .MuiPickersCalendarHeader-labelContainer': {
                            borderRadius: '0.5rem',
                            padding: '2px 6px',
                            marginRight: '4px',
                        },
                        '& .MuiPickersCalendarHeader-labelContainer:hover': {
                            backgroundColor: '#ffffff',
                        },
                        '& .MuiPickersCalendarHeader-label': {
                            color: '#051F20',
                            fontFamily: 'var(--font-headline)',
                            fontSize: '0.95rem',
                            fontWeight: 700,
                            textTransform: 'none',
                        },
                        '& .MuiPickersCalendarHeader-switchViewButton': {
                            color: '#051F20',
                            padding: '4px',
                            marginLeft: '2px',
                        },
                        '& .MuiPickersCalendarHeader-switchViewButton:hover': {
                            backgroundColor: '#ffffff',
                        },
                        '& .MuiPickersArrowSwitcher-root': {
                            gap: '6px',
                        },
                        '& .MuiPickersArrowSwitcher-button': {
                            border: '1px solid #235347',
                            borderRadius: '0.5rem',
                            color: '#051F20',
                            backgroundColor: '#FFFFFF',
                            width: '2rem',
                            height: '2rem',
                            minWidth: '2rem',
                            padding: '4px',
                        },
                        '& .MuiPickersArrowSwitcher-button:hover': {
                            backgroundColor: '#ffffff',
                        },
                        '& .MuiPickersArrowSwitcher-button > svg': {
                            fontSize: '1rem',
                        },
                        '& .MuiDayCalendar-header': {
                            justifyContent: 'space-between',
                            marginBottom: '4px',
                        },
                        '& .MuiDayCalendar-weekDayLabel': {
                            width: '2.25rem',
                            height: '2rem',
                            margin: 0,
                            color: '#0B2B26',
                            fontFamily: 'var(--font-ui)',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                        },
                        '& .MuiDayCalendar-weekContainer': {
                            justifyContent: 'space-between',
                            margin: 0,
                        },
                        '& .MuiPickersDay-root': {
                            width: '2.25rem',
                            height: '2.25rem',
                            margin: 0,
                            borderRadius: '0.5rem',
                            color: '#051F20',
                            fontFamily: 'var(--font-body)',
                            fontSize: '0.875rem',
                            fontWeight: 500,
                        },
                        '& .MuiPickersDay-root:hover': {
                            backgroundColor: '#ffffff',
                        },
                        '& .MuiPickersDay-root.Mui-selected': {
                            backgroundColor: '#163832',
                            color: '#FFFFFF',
                        },
                        '& .MuiPickersDay-root.Mui-selected:hover': {
                            backgroundColor: '#235347',
                        },
                        '& .MuiPickersDay-root.MuiPickersDay-today:not(.Mui-selected)': {
                            border: '1px solid transparent',
                            backgroundColor: 'transparent',
                            color: '#051F20',
                        },
                        '& .MuiPickersDay-root.Mui-disabled': {
                            opacity: 0.4,
                            color: '#0B2B26',
                        },
                        '& .MuiPickersFadeTransitionGroup-root': {
                            minHeight: '12.75rem',
                        },
                        '& .MuiMonthCalendar-root, & .MuiYearCalendar-root': {
                            width: '100%',
                        },
                        '& .MuiYearCalendar-root': {
                            scrollbarWidth: 'none',
                            msOverflowStyle: 'none',
                        },
                        '& .MuiYearCalendar-root::-webkit-scrollbar': {
                            width: 0,
                            height: 0,
                            display: 'none',
                        },
                        '& .MuiMonthCalendar-button, & .MuiYearCalendar-button': {
                            color: '#051F20',
                            fontFamily: 'var(--font-ui)',
                            borderRadius: '0.5rem',
                        },
                        '& .MuiMonthCalendar-button:hover, & .MuiYearCalendar-button:hover': {
                            backgroundColor: '#ffffff',
                        },
                        '& .MuiMonthCalendar-button.Mui-selected, & .MuiYearCalendar-button.Mui-selected': {
                            backgroundColor: '#163832',
                            color: '#FFFFFF',
                        },
                    }}
                />
            </LocalizationProvider>

            <div className="mt-2 flex items-center justify-between border-t border-[var(--color-card-border)] pt-2">
                <button
                    type="button"
                    onClick={() => onChange(null)}
                    className="text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    style={{ fontFamily: 'var(--font-ui)' }}
                >
                    Clear
                </button>
                <button
                    type="button"
                    onClick={() => handleDaySelect(new Date())}
                    className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                    style={{ fontFamily: 'var(--font-ui)' }}
                >
                    Today
                </button>
            </div>

            {includeTime && (
                <div className="mt-3 pt-3 border-t border-[var(--color-card-border)] space-y-2">
                    <label className="block text-xs font-medium text-[var(--color-text-muted)]" style={{ fontFamily: 'var(--font-ui)' }}>
                        Time
                    </label>
                    <div className="grid grid-cols-[1fr_auto_1fr_1fr] gap-2 items-center">
                        <select
                            value={String(hour12)}
                            onChange={(e) => handleTimeChange({ hour12: Number(e.target.value) })}
                            className="rounded-lg border border-[var(--color-input-border)] bg-white px-2 py-2 text-sm text-[var(--color-text-primary)]"
                            style={{ fontFamily: 'var(--font-ui)' }}
                        >
                            {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                                <option key={h} value={h}>{h.toString().padStart(2, '0')}</option>
                            ))}
                        </select>
                        <span className="text-sm text-[var(--color-text-muted)] text-center" style={{ fontFamily: 'var(--font-ui)' }}>:</span>
                        <select
                            value={String(minute)}
                            onChange={(e) => handleTimeChange({ minute: Number(e.target.value) })}
                            className="rounded-lg border border-[var(--color-input-border)] bg-white px-2 py-2 text-sm text-[var(--color-text-primary)]"
                            style={{ fontFamily: 'var(--font-ui)' }}
                        >
                            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
                                <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                            ))}
                        </select>
                        <select
                            value={meridiem}
                            onChange={(e) => handleTimeChange({ meridiem: e.target.value as 'AM' | 'PM' })}
                            className="rounded-lg border border-[var(--color-input-border)] bg-white px-2 py-2 text-sm text-[var(--color-text-primary)]"
                            style={{ fontFamily: 'var(--font-ui)' }}
                        >
                            <option value="AM">AM</option>
                            <option value="PM">PM</option>
                        </select>
                    </div>

                    {value && (
                        <p className="text-[11px] text-[var(--color-text-muted)]">
                            {format(value, 'PPP p')}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
