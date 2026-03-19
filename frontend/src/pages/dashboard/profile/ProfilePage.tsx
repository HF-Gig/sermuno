import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { UserCircle2, KeyRound, BadgeCheck, ImagePlus, Upload, Trash2, Eye, EyeOff, Bell, Mail, AlertTriangle, AtSign, Settings as SettingsIcon, UserCheck, Clock3, Activity, CalendarDays } from 'lucide-react';
import api, { resolveAvatarUrl } from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import AvatarCropModal from './components/AvatarCropModal';
import MfaSetup from '../../../components/MfaSetup';

interface UserProfileData {
    fullName: string;
    locale: string;
}

interface ChangePasswordInputs {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
}

interface SessionEntry {
    id: string;
    createdAt: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
    current: boolean;
}

type ProfileTab = 'profile' | 'security' | 'notifications';
type NotificationPreferenceState = {
    enabled: boolean;
    channels: {
        in_app: boolean;
        email: boolean;
        desktop: boolean;
    };
    config: Record<string, any>;
    restrictedChannels?: string[];
};

type QuietHoursState = {
    enabled: boolean;
    startTime: string;
    endTime: string;
    timezone: string;
    channels: string[];
};

const notificationTypeMeta: Record<string, { label: string; desc: string; icon: React.FC<{ className?: string }> }> = {
    new_message: { label: 'New message', desc: 'Per mailbox or all mailboxes with channel selection.', icon: Mail },
    thread_assigned: { label: 'Thread assigned', desc: 'Notify when a thread is assigned to you.', icon: UserCheck },
    mention: { label: 'Mention', desc: 'Notify when someone mentions you in a note.', icon: AtSign },
    sla_warning: { label: 'SLA warning', desc: 'Trigger before a breach using a minutes threshold.', icon: AlertTriangle },
    sla_breach: { label: 'SLA breach', desc: 'Notify immediately when an SLA target breaches.', icon: AlertTriangle },
    thread_reply: { label: 'Thread reply', desc: 'Limit to assigned threads only or all threads.', icon: Mail },
    rule_triggered: { label: 'Rule triggered', desc: 'Enable per rule with channel selection.', icon: Activity },
    contact_activity: { label: 'Contact activity', desc: 'Enable per contact with channel selection.', icon: UserCheck },
    daily_digest: { label: 'Daily digest', desc: 'Send a daily summary at a configured time and timezone.', icon: CalendarDays },
    weekly_report: { label: 'Weekly report', desc: 'Send a weekly report on a chosen day and time.', icon: CalendarDays },
};

const cardClass = 'rounded-2xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)]';
const inputClass = 'w-full rounded-xl border border-[var(--color-input-border)] bg-white px-3 py-2.5 text-sm text-[var(--color-text-primary)] shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20';

export default function ProfilePage() {
    const { t, i18n } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const { user, updateUser } = useAuth();

    const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [avatarDraftFile, setAvatarDraftFile] = useState<File | null>(null);
    const [isAvatarDragOver, setIsAvatarDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [passwordMessage, setPasswordMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
    const [sessions, setSessions] = useState<SessionEntry[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [sessionActionId, setSessionActionId] = useState<string | null>(null);
    const [sessionsMessage, setSessionsMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

    const [notificationPreferences, setNotificationPreferences] = useState<Record<string, NotificationPreferenceState>>({});
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const [notificationSaveLoading, setNotificationSaveLoading] = useState(false);
    const [quietHoursState, setQuietHoursState] = useState<QuietHoursState>({
        enabled: false,
        startTime: '22:00',
        endTime: '07:00',
        timezone: 'UTC',
        channels: ['email', 'desktop'],
    });

    const tabParam = searchParams.get('tab');
    const activeTab: ProfileTab = tabParam === 'security' || tabParam === 'notifications' ? tabParam : 'profile';
    const setActiveTab = (tab: ProfileTab) => {
        const next = new URLSearchParams(searchParams);
        next.set('tab', tab);
        setSearchParams(next, { replace: true });
    };

    const updateNotificationPreference = (notificationType: string, channel: 'in_app' | 'email' | 'desktop', value: boolean) => {
        setNotificationPreferences((prev) => ({
            ...prev,
            [notificationType]: {
                ...prev[notificationType],
                channels: {
                    ...prev[notificationType]?.channels,
                    [channel]: value,
                },
            },
        }));

        if (channel === 'desktop' && value && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().catch(() => undefined);
        }
    };

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting },
        reset,
        setValue
    } = useForm<UserProfileData>({
        defaultValues: {
            fullName: user?.fullName || '',
            locale: user?.locale || 'en'
        }
    });

    useEffect(() => {
        if (!user) return;
        setValue('fullName', user.fullName);
        setValue('locale', user.locale || 'en');
    }, [user, setValue]);

    const {
        register: registerPassword,
        handleSubmit: handlePasswordSubmit,
        reset: resetPasswordForm,
        watch: watchPasswordForm,
        formState: { errors: passwordErrors, isSubmitting: isChangingPassword }
    } = useForm<ChangePasswordInputs>({
        defaultValues: {
            currentPassword: '',
            newPassword: '',
            confirmPassword: ''
        }
    });

    const watchedNewPassword = watchPasswordForm('newPassword');

    const formatDate = (value: string) => {
        try {
            return new Date(value).toLocaleString();
        } catch {
            return value;
        }
    };

    const loadSessions = async () => {
        setSessionsLoading(true);
        setSessionsMessage(null);
        try {
            const refreshToken = localStorage.getItem('refreshToken');
            const response = await api.get('/auth/sessions', {
                headers: refreshToken ? { 'x-refresh-token': refreshToken } : undefined,
            });
            setSessions(Array.isArray(response.data) ? response.data : []);
        } catch (error: any) {
            console.error('Failed to load sessions:', error);
            setSessionsMessage({ text: error?.response?.data?.message || 'Failed to load sessions.', type: 'error' });
        } finally {
            setSessionsLoading(false);
        }
    };

    const revokeSession = async (sessionId: string) => {
        setSessionActionId(sessionId);
        setSessionsMessage(null);
        try {
            await api.delete('/auth/sessions', { data: { sessionId } });
            setSessions((prev) => prev.filter((session) => session.id !== sessionId));
            setSessionsMessage({ text: 'Session revoked successfully.', type: 'success' });
        } catch (error: any) {
            console.error('Failed to revoke session:', error);
            setSessionsMessage({ text: error?.response?.data?.message || 'Failed to revoke session.', type: 'error' });
        } finally {
            setSessionActionId(null);
        }
    };

    useEffect(() => {
        if (activeTab !== 'security') return;
        loadSessions();
    }, [activeTab]);

    const loadNotificationPreferences = async () => {
        setNotificationsLoading(true);
        try {
            const response = await api.get('/notifications/settings');
            const preferences = response.data?.preferences || {};
            const quietHours = response.data?.quietHours || {};
            setNotificationPreferences(preferences);
            setQuietHoursState({
                enabled: Boolean(quietHours.enabled),
                startTime: quietHours.startTime || quietHours.start || '22:00',
                endTime: quietHours.endTime || quietHours.end || '07:00',
                timezone: quietHours.timezone || 'UTC',
                channels: Array.isArray(quietHours.channels) ? quietHours.channels : ['email', 'desktop'],
            });
        } catch (error: any) {
            setMessage({ text: error?.response?.data?.message || 'Failed to load notification preferences.', type: 'error' });
        } finally {
            setNotificationsLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab !== 'notifications') return;
        loadNotificationPreferences();
    }, [activeTab]);

    const updateNotificationEnabled = (notificationType: string, value: boolean) => {
        setNotificationPreferences((prev) => ({
            ...prev,
            [notificationType]: {
                ...prev[notificationType],
                enabled: value,
            },
        }));
    };

    const updateNotificationConfig = (notificationType: string, patch: Record<string, unknown>) => {
        setNotificationPreferences((prev) => ({
            ...prev,
            [notificationType]: {
                ...prev[notificationType],
                config: {
                    ...(prev[notificationType]?.config || {}),
                    ...patch,
                },
            },
        }));
    };

    const saveNotificationPreferences = async () => {
        setNotificationSaveLoading(true);
        setMessage(null);
        try {
            await api.patch('/notifications/settings', { preferences: notificationPreferences });
            await api.patch('/notifications/quiet-hours', {
                enabled: quietHoursState.enabled,
                startTime: quietHoursState.startTime,
                endTime: quietHoursState.endTime,
                timezone: quietHoursState.timezone,
                channels: quietHoursState.channels,
            });
            setMessage({ text: 'Notification preferences updated.', type: 'success' });
            await loadNotificationPreferences();
        } catch (error: any) {
            setMessage({ text: error?.response?.data?.message || 'Failed to update notification preferences.', type: 'error' });
        } finally {
            setNotificationSaveLoading(false);
        }
    };

    const initials = useMemo(() => {
        if (!user?.fullName) return 'S';
        return user.fullName.trim().charAt(0).toUpperCase() || 'S';
    }, [user?.fullName]);

    const applyLanguage = (lang?: string) => {
        const nextLang = lang || 'en';
        i18n.changeLanguage(nextLang);
        document.documentElement.lang = nextLang;
    };


    const onChangePassword = async (data: ChangePasswordInputs) => {
        setPasswordMessage(null);

        try {
            await api.post('/auth/change-password', {
                currentPassword: data.currentPassword,
                newPassword: data.newPassword,
            });

            resetPasswordForm();
            setPasswordMessage({ text: 'Password changed successfully.', type: 'success' });
        } catch (error: any) {
            setPasswordMessage({ text: error?.response?.data?.message || 'Failed to change password.', type: 'error' });
        }
    };


    const onSubmit = async (data: UserProfileData) => {
        setMessage(null);

        try {
            const payload: Record<string, string> = {
                fullName: data.fullName,
                locale: data.locale
            };
            if (data.password) payload.password = data.password;

            const response = await api.patch('/users/me', payload);
            const nextUser = user ? { ...user, ...response.data, fullName: data.fullName, locale: data.locale } : response.data;
            if (nextUser) updateUser(nextUser);
            applyLanguage(data.locale);
            reset({ fullName: data.fullName, locale: data.locale, password: '', confirmPassword: '' });
            setMessage({ text: t('profile_updated_successfully'), type: 'success' });
        } catch (error) {
            console.error(error);
            setMessage({ text: t('failed_to_update_profile'), type: 'error' });
        }
    };

    const applyAvatar = async (avatarUrl: string | undefined) => {
        if (!user) return;
        try {
            const response = await api.patch('/users/me', { avatarUrl: avatarUrl ?? null });
            const nextUser = { ...user, ...response.data, avatarUrl: response.data.avatarUrl };
            updateUser(nextUser);
            setMessage({ text: t('profile_avatar_updated'), type: 'success' });
        } catch (err) {
            console.error('Failed to save avatar:', err);
            // Optimistically update UI even if backend fails
            updateUser({ ...user, avatarUrl });
            setMessage({ text: t('profile_avatar_updated'), type: 'success' });
        }
    };

    const handleAvatarFile = (file?: File | null) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setMessage({ text: t('profile_avatar_invalid_file'), type: 'error' });
            return;
        }
        setAvatarDraftFile(file);
    };

    return (
        <div className="max-w-5xl mx-auto py-2 md:py-4 space-y-6">
            <section className={`${cardClass} p-5 md:p-6`}>
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-4">
                        <div className="h-14 w-14 rounded-2xl bg-[var(--color-accent)] text-[var(--color-primary)] flex items-center justify-center text-lg font-extrabold shadow-sm overflow-hidden">
                            {resolveAvatarUrl(user?.avatarUrl) ? (
                                <img src={resolveAvatarUrl(user?.avatarUrl)} alt={user?.fullName || 'Profile'} className="h-full w-full object-cover" />
                            ) : (
                                initials
                            )}
                        </div>
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold text-[var(--color-text-primary)]">{t('my_profile', 'My Profile')}</h1>
                            <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{t('profile_page_subtitle')}</p>
                        </div>
                    </div>
                </div>

                <div className="mt-5 inline-flex rounded-xl bg-[var(--color-background)] p-1 border border-[var(--color-card-border)]">
                    <TabButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')}>
                        {t('profile_tab_profile', 'Profile')}
                    </TabButton>
                    <TabButton active={activeTab === 'security'} onClick={() => setActiveTab('security')}>
                        {t('profile_tab_security', 'Security')}
                    </TabButton>
                    <TabButton active={activeTab === 'notifications'} onClick={() => setActiveTab('notifications')}>
                        {t('profile_tab_notifications', 'Notification Preferences')}
                    </TabButton>
                </div>
            </section>

            {message && (
                <div className={`${cardClass} p-4 ${message.type === 'success' ? 'bg-[var(--color-background)]' : 'bg-red-50 border-red-200'}`}>
                    <p className={`text-sm font-medium ${message.type === 'success' ? 'text-[var(--color-primary)]' : 'text-red-700'}`}>{message.text}</p>
                </div>
            )}

            {activeTab === 'profile' && (
                <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-6 items-start">
                    <section className={`${cardClass} p-5 md:p-6`}>
                        <div className="flex items-center gap-2 mb-5">
                            <UserCircle2 className="h-5 w-5 text-[var(--color-primary)]" />
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]">{t('profile_details_title')}</h2>
                        </div>

                        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('full_name')}</label>
                                    <input type="text" {...register('fullName', { required: t('full_name_is_required') })} className={inputClass} />
                                    {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName.message}</p>}
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('email')}</label>
                                    <input type="email" value={user?.email || ''} readOnly disabled className={`${inputClass} bg-[var(--color-background)] text-[var(--color-text-muted)] cursor-not-allowed`} />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('role')}</label>
                                    <div className="h-[42px] px-3 rounded-xl border border-[var(--color-card-border)] bg-[var(--color-background)] flex items-center justify-between">
                                        <span className="text-sm font-medium text-[var(--color-text-primary)]">{user?.role || 'USER'}</span>
                                        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--color-primary)]">
                                            <BadgeCheck className="h-3.5 w-3.5" />
                                            {t('active')}
                                        </span>
                                    </div>
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">{t('default_language')}</label>
                                    <select
                                        {...register('locale', {
                                            onChange: (event) => {
                                                const newLang = event.target.value || 'en';
                                                applyLanguage(newLang);
                                            }
                                        })}
                                        className={inputClass}
                                    >
                                        <option value="en">English</option>
                                        <option value="nl">Dutch</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex justify-end pt-1">
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="inline-flex items-center rounded-xl bg-[var(--color-cta-primary)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-cta-secondary)] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isSubmitting ? t('saving...') : t('save_changes')}
                                </button>
                            </div>
                        </form>
                    </section>

                    <section className={`${cardClass} p-5 md:p-6`}>
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]">{t('profile_photo_title')}</h2>
                            {user?.avatarUrl && (
                                <button
                                    type="button"
                                    onClick={() => applyAvatar(undefined)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-card-border)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {t('profile_remove_photo')}
                                </button>
                            )}
                        </div>

                        <p className="text-xs text-[var(--color-text-muted)] mb-4">{t('profile_photo_help')}</p>

                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleAvatarFile(e.target.files?.[0])} />

                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => fileInputRef.current?.click()}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    fileInputRef.current?.click();
                                }
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setIsAvatarDragOver(true);
                            }}
                            onDragLeave={() => setIsAvatarDragOver(false)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setIsAvatarDragOver(false);
                                handleAvatarFile(e.dataTransfer.files?.[0]);
                            }}
                            className={`rounded-2xl border-2 border-dashed p-4 transition-colors cursor-pointer min-h-[430px] flex items-center ${isAvatarDragOver ? 'border-[var(--color-primary)] bg-[var(--color-background)]' : 'border-[var(--color-card-border)] bg-[var(--color-background)]/40 hover:bg-[var(--color-background)]'}`}
                        >
                            <div className="w-full flex flex-col items-center text-center">
                                <div className="h-32 w-32 rounded-full overflow-hidden bg-white border border-[var(--color-card-border)] shadow-sm flex items-center justify-center">
                                    {resolveAvatarUrl(user?.avatarUrl) ? (
                                        <img src={resolveAvatarUrl(user?.avatarUrl)} alt={user?.fullName || 'Profile avatar'} className="h-full w-full object-cover" />
                                    ) : (
                                        <span className="text-3xl font-extrabold text-[var(--color-primary)]">{initials}</span>
                                    )}
                                </div>

                                <div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-white border border-[var(--color-card-border)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)]">
                                    <Upload className="h-4 w-4 text-[var(--color-primary)]" />
                                    {t('profile_upload_photo')}
                                </div>

                                <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                                    <ImagePlus className="h-3.5 w-3.5" />
                                    <span>{t('profile_drag_drop_photo')}</span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            )}

            {activeTab === 'security' && (
                <div className="space-y-6">
                    <MfaSetup embedded />

                    <section className={`${cardClass} p-5 md:p-6`}>
                        <div className="flex items-center gap-2 mb-5">
                            <KeyRound className="h-5 w-5 text-[var(--color-primary)]" />
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]">Change Password</h2>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)] mb-4">
                            Update your password to keep your account secure.
                        </p>

                        <form onSubmit={handlePasswordSubmit(onChangePassword)} className="space-y-5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="md:col-span-2">
                                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Current Password</label>
                                    <div className="relative">
                                        <input type={showCurrentPassword ? 'text' : 'password'} {...registerPassword('currentPassword', { required: 'Current password is required.' })} className={`${inputClass} pr-10`} />
                                        <button type="button" onClick={() => setShowCurrentPassword(prev => !prev)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                                            {showCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {passwordErrors.currentPassword && <p className="mt-1 text-xs text-red-600">{passwordErrors.currentPassword.message}</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">New Password</label>
                                    <div className="relative">
                                        <input type={showNewPassword ? 'text' : 'password'} {...registerPassword('newPassword', { required: 'New password is required.', minLength: { value: 8, message: 'Password must be at least 8 characters.' } })} className={`${inputClass} pr-10`} />
                                        <button type="button" onClick={() => setShowNewPassword(prev => !prev)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                                            {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {passwordErrors.newPassword && <p className="mt-1 text-xs text-red-600">{passwordErrors.newPassword.message}</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Confirm New Password</label>
                                    <div className="relative">
                                        <input type={showConfirmPassword ? 'text' : 'password'} {...registerPassword('confirmPassword', { validate: (value) => value === watchedNewPassword || 'Passwords do not match.' })} className={`${inputClass} pr-10`} />
                                        <button type="button" onClick={() => setShowConfirmPassword(prev => !prev)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]">
                                            {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </button>
                                    </div>
                                    {passwordErrors.confirmPassword && <p className="mt-1 text-xs text-red-600">{passwordErrors.confirmPassword.message}</p>}
                                </div>
                            </div>

                            {passwordMessage && <div className={`rounded-xl border px-4 py-3 text-sm ${passwordMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{passwordMessage.text}</div>}

                            <div className="flex justify-end">
                                <button type="submit" disabled={isChangingPassword} className="inline-flex items-center rounded-xl bg-[var(--color-cta-primary)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-cta-secondary)] disabled:cursor-not-allowed disabled:opacity-60">
                                    {isChangingPassword ? 'Saving...' : 'Save Password'}
                                </button>
                            </div>
                        </form>
                    </section>

                    <section className={`${cardClass} p-5 md:p-6`}>
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <h2 className="text-base font-bold text-[var(--color-text-primary)]">Active Sessions</h2>
                            <button
                                type="button"
                                onClick={loadSessions}
                                disabled={sessionsLoading}
                                className="inline-flex items-center rounded-lg border border-[var(--color-card-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {sessionsLoading ? 'Refreshing...' : 'Refresh'}
                            </button>
                        </div>

                        {sessionsMessage && <div className={`mb-3 rounded-xl border px-4 py-3 text-sm ${sessionsMessage.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{sessionsMessage.text}</div>}

                        {sessionsLoading ? (
                            <p className="text-sm text-[var(--color-text-muted)]">Loading sessions...</p>
                        ) : sessions.length === 0 ? (
                            <p className="text-sm text-[var(--color-text-muted)]">No active sessions found.</p>
                        ) : (
                            <div className="space-y-3">
                                {sessions.map((session) => (
                                    <div key={session.id} className="rounded-xl border border-[var(--color-card-border)] bg-white p-4">
                                        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                                            <div className="space-y-1">
                                                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                                                    {session.current ? 'Current device' : 'Active device'}
                                                </p>
                                                <p className="text-xs text-[var(--color-text-muted)]">IP: {session.ipAddress || 'Unknown'}</p>
                                                <p className="text-xs text-[var(--color-text-muted)] truncate">Agent: {session.userAgent || 'Unknown'}</p>
                                                <p className="text-xs text-[var(--color-text-muted)]">Created: {formatDate(session.createdAt)}</p>
                                                <p className="text-xs text-[var(--color-text-muted)]">Expires: {formatDate(session.expiresAt)}</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => revokeSession(session.id)}
                                                disabled={session.current || sessionActionId === session.id}
                                                className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {session.current ? 'Current session' : sessionActionId === session.id ? 'Revoking...' : 'Revoke'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                </div>
            )}

            {activeTab === 'notifications' && (
                <section className={`${cardClass} p-5 md:p-6`}>
                    <div className="flex items-center gap-2 mb-5">
                        <Bell className="h-5 w-5 text-[var(--color-primary)]" />
                        <h2 className="text-base font-bold text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-ui)' }}>
                            {t('profile_tab_notifications', 'Notification Preferences')}
                        </h2>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mb-4" style={{ fontFamily: 'var(--font-body)' }}>
                        Choose how you want to receive updates for key thread and SLA events.
                    </p>
                    {notificationsLoading ? (
                        <div className="space-y-3">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <div key={index} className="rounded-xl border border-[var(--color-card-border)] bg-white p-4">
                                    <div className="h-4 w-40 rounded bg-[var(--color-background)] animate-pulse" />
                                    <div className="mt-2 h-3 w-72 rounded bg-[var(--color-background)] animate-pulse" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <>
                            <div className="space-y-3">
                                {Object.entries(notificationTypeMeta).map(([type, meta]) => {
                                    const pref = notificationPreferences[type] || {
                                        enabled: true,
                                        channels: { in_app: true, email: true, desktop: false },
                                        config: {},
                                        restrictedChannels: [],
                                    };
                                    const Icon = meta.icon;
                                    const restricted = new Set(pref.restrictedChannels || []);

                                    return (
                                        <div key={type} className="rounded-xl border border-[var(--color-card-border)] bg-white p-4 space-y-3">
                                            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                                <div className="flex items-start gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-[var(--color-background)] flex items-center justify-center shrink-0">
                                                        <Icon className="w-4 h-4 text-[var(--color-primary)]" />
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-[var(--color-text-primary)]" style={{ fontFamily: 'var(--font-ui)' }}>{meta.label}</p>
                                                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5" style={{ fontFamily: 'var(--font-body)' }}>{meta.desc}</p>
                                                    </div>
                                                </div>
                                                <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                                                    <input type="checkbox" checked={pref.enabled} onChange={(event) => updateNotificationEnabled(type, event.target.checked)} className="w-4 h-4 rounded border-[var(--color-card-border)] text-[var(--color-primary)]" />
                                                    Enabled
                                                </label>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                                {(['in_app', 'email', 'desktop'] as const).map((channel) => (
                                                    <label key={channel} className={`flex items-center gap-2 text-xs ${restricted.has(channel) ? 'text-[var(--color-text-muted)] opacity-60' : 'text-[var(--color-text-primary)]'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={pref.channels?.[channel] ?? false}
                                                            disabled={restricted.has(channel)}
                                                            onChange={(event) => updateNotificationPreference(type, channel, event.target.checked)}
                                                            className="w-4 h-4 rounded border-[var(--color-card-border)] text-[var(--color-primary)]"
                                                        />
                                                        {channel.replace('_', ' ')}
                                                    </label>
                                                ))}
                                            </div>

                                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                                {type === 'new_message' && (
                                                    <>
                                                        <div>
                                                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Mailbox Scope</label>
                                                            <select value={String(pref.config?.scope || 'all_mailboxes')} onChange={(event) => updateNotificationConfig(type, { scope: event.target.value })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm">
                                                                <option value="all_mailboxes">All mailboxes</option>
                                                                <option value="per_mailbox">Per mailbox</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Mailbox IDs (comma separated)</label>
                                                            <input value={Array.isArray(pref.config?.mailboxIds) ? pref.config.mailboxIds.join(', ') : ''} onChange={(event) => updateNotificationConfig(type, { mailboxIds: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                                        </div>
                                                    </>
                                                )}
                                                {type === 'sla_warning' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Minutes before breach</label>
                                                        <input type="number" value={Number(pref.config?.minutesBeforeBreach || 30)} onChange={(event) => updateNotificationConfig(type, { minutesBeforeBreach: Number(event.target.value || 0) })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                                    </div>
                                                )}
                                                {type === 'thread_reply' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Scope</label>
                                                        <select value={String(pref.config?.scope || 'assigned_threads_only')} onChange={(event) => updateNotificationConfig(type, { scope: event.target.value })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm">
                                                            <option value="assigned_threads_only">Assigned threads only</option>
                                                            <option value="all_threads">All threads</option>
                                                        </select>
                                                    </div>
                                                )}
                                                {type === 'rule_triggered' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Rule IDs (comma separated)</label>
                                                        <input value={Array.isArray(pref.config?.ruleIds) ? pref.config.ruleIds.join(', ') : ''} onChange={(event) => updateNotificationConfig(type, { ruleIds: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                                    </div>
                                                )}
                                                {type === 'contact_activity' && (
                                                    <div>
                                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Contact IDs (comma separated)</label>
                                                        <input value={Array.isArray(pref.config?.contactIds) ? pref.config.contactIds.join(', ') : ''} onChange={(event) => updateNotificationConfig(type, { contactIds: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                                    </div>
                                                )}
                                                {type === 'daily_digest' && (
                                                    <>
                                                        <div>
                                                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Time</label>
                                                            <input type="time" value={String(pref.config?.time || '09:00')} onChange={(event) => updateNotificationConfig(type, { time: event.target.value })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Timezone</label>
                                                            <input value={String(pref.config?.timezone || 'UTC')} onChange={(event) => updateNotificationConfig(type, { timezone: event.target.value })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                                        </div>
                                                        <label className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                                                            <input type="checkbox" checked={Boolean(pref.config?.includeStatistics ?? true)} onChange={(event) => updateNotificationConfig(type, { includeStatistics: event.target.checked })} className="w-4 h-4 rounded border-[var(--color-card-border)] text-[var(--color-primary)]" />
                                                            Include statistics
                                                        </label>
                                                    </>
                                                )}
                                                {type === 'weekly_report' && (
                                                    <>
                                                        <div>
                                                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Day</label>
                                                            <select value={String(pref.config?.day || 'monday')} onChange={(event) => updateNotificationConfig(type, { day: event.target.value })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm">
                                                                <option value="monday">monday</option>
                                                                <option value="friday">friday</option>
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Time</label>
                                                            <input type="time" value={String(pref.config?.time || '09:00')} onChange={(event) => updateNotificationConfig(type, { time: event.target.value })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Timezone</label>
                                                            <input value={String(pref.config?.timezone || 'UTC')} onChange={(event) => updateNotificationConfig(type, { timezone: event.target.value })} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div className="mt-6 rounded-xl border border-[var(--color-card-border)] bg-white p-4 space-y-4">
                                <div className="flex items-center gap-2">
                                    <Clock3 className="h-4 w-4 text-[var(--color-primary)]" />
                                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Quiet Hours</h3>
                                </div>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)] md:col-span-2">
                                        <input type="checkbox" checked={quietHoursState.enabled} onChange={(event) => setQuietHoursState((prev) => ({ ...prev, enabled: event.target.checked }))} className="w-4 h-4 rounded border-[var(--color-card-border)] text-[var(--color-primary)]" />
                                        Enable quiet hours
                                    </label>
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Start</label>
                                        <input type="time" value={quietHoursState.startTime} onChange={(event) => setQuietHoursState((prev) => ({ ...prev, startTime: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">End</label>
                                        <input type="time" value={quietHoursState.endTime} onChange={(event) => setQuietHoursState((prev) => ({ ...prev, endTime: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Timezone</label>
                                        <input value={quietHoursState.timezone} onChange={(event) => setQuietHoursState((prev) => ({ ...prev, timezone: event.target.value }))} className="w-full rounded-lg border border-[var(--color-card-border)] px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Channels</label>
                                        <div className="flex flex-wrap gap-3 rounded-lg border border-[var(--color-card-border)] px-3 py-2">
                                            {['email', 'desktop'].map((channel) => (
                                                <label key={channel} className="flex items-center gap-2 text-xs text-[var(--color-text-primary)]">
                                                    <input type="checkbox" checked={quietHoursState.channels.includes(channel)} onChange={(event) => setQuietHoursState((prev) => ({ ...prev, channels: event.target.checked ? [...new Set([...prev.channels, channel])] : prev.channels.filter((item) => item !== channel) }))} className="w-4 h-4 rounded border-[var(--color-card-border)] text-[var(--color-primary)]" />
                                                    {channel}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-5 flex justify-end">
                                <button type="button" onClick={saveNotificationPreferences} disabled={notificationSaveLoading} className="inline-flex items-center rounded-xl bg-[var(--color-cta-primary)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-cta-secondary)] disabled:cursor-not-allowed disabled:opacity-60">
                                    {notificationSaveLoading ? 'Saving...' : 'Save Notification Preferences'}
                                </button>
                            </div>
                        </>
                    )}
                </section>
            )}

            {avatarDraftFile && (
                <AvatarCropModal
                    file={avatarDraftFile}
                    onClose={() => setAvatarDraftFile(null)}
                    onApply={(avatarUrl) => {
                        applyAvatar(avatarUrl);
                        setAvatarDraftFile(null);
                    }}
                />
            )}
        </div>
    );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${active
                ? 'bg-white text-[var(--color-text-primary)] shadow-sm border border-[var(--color-card-border)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
        >
            {children}
        </button>
    );
}
