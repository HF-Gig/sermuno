import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, User } from 'lucide-react';
import api from '../../lib/api';
import AuthLayout from './AuthLayout';

const COMMON_TIMEZONES = [
    'Europe/Amsterdam',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Dubai',
    'Asia/Tokyo',
    'UTC',
];

type InviteStep = 'profile' | 'success';
type InviteRecord = {
    email: string;
    role: string;
    organizationName: string;
    inviterName: string;
    enforceMfa: boolean;
};

const cardInputCls =
    'flex h-11 w-full rounded-md border border-[#235347] bg-white px-3 py-2 text-sm text-[#051F20] placeholder:text-[#0B2B26]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8EB69B] disabled:cursor-not-allowed disabled:opacity-50';

const AcceptInvite: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const params = useParams<{ token?: string }>();
    const token = params.token || searchParams.get('token') || '';

    const [invite, setInvite] = useState<InviteRecord | null>(null);
    const [loadingInvite, setLoadingInvite] = useState(true);
    const [loadingSubmit, setLoadingSubmit] = useState(false);
    const [step, setStep] = useState<InviteStep>('profile');
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const [formData, setFormData] = useState({
        email: '',
        fullName: '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        password: '',
        confirmPassword: '',
    });

    useEffect(() => {
        let cancelled = false;

        const loadInvite = async () => {
            if (!token) {
                setError('Invitation token is missing.');
                setLoadingInvite(false);
                return;
            }

            setLoadingInvite(true);
            setError('');

            try {
                const response = await api.get(`/users/invite/${token}`);
                const inviteRecord = response.data as InviteRecord;
                if (cancelled) return;
                setInvite(inviteRecord);
                setFormData(prev => ({
                    ...prev,
                    email: inviteRecord.email,
                    timezone: COMMON_TIMEZONES.includes(prev.timezone) ? prev.timezone : 'UTC',
                }));
            } catch (err: any) {
                if (cancelled) return;
                setError(err?.response?.data?.message || err?.message || 'Failed to load invitation.');
            } finally {
                if (!cancelled) setLoadingInvite(false);
            }
        };

        loadInvite();
        return () => {
            cancelled = true;
        };
    }, [token]);

    const pageTitle = useMemo(() => {
        if (step === 'success') return 'You\'re all set!';
        return 'Accept Invitation';
    }, [step]);

    const pageSubtitle = useMemo(() => {
        if (step === 'success') return 'Your account is ready to use.';
        return 'Complete your account setup below.';
    }, [step]);

    const updateField = (key: keyof typeof formData, value: string) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    };

    const validateCredentialStep = () => {
        if (!formData.fullName.trim()) return 'Full name is required.';
        if (!formData.password) return 'Password is required.';
        if (formData.password.length < 8) return 'Password must be at least 8 characters.';
        if (formData.password !== formData.confirmPassword) return 'Passwords do not match.';
        return '';
    };

    const finalizeAcceptInvite = async () => {
        if (!invite) return;
        setLoadingSubmit(true);
        setError('');

        const payload = {
            token,
            email: formData.email,
            fullName: formData.fullName.trim(),
            timezone: formData.timezone,
            password: formData.password,
        };

        try {
            await api.post('/auth/accept-invite', payload);
            setStep('success');
        } catch (err: any) {
            setError(err?.response?.data?.message || err?.message || 'Failed to accept invitation.');
        } finally {
            setLoadingSubmit(false);
        }
    };

    const handleCredentialSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const validationError = validateCredentialStep();
        if (validationError) {
            setError(validationError);
            return;
        }
        setError('');

        await finalizeAcceptInvite();
    };

    if (loadingInvite) {
        return (
            <AuthLayout>
                <div className="flex flex-col items-center justify-center space-y-4 py-12">
                    <Loader2 className="w-12 h-12 animate-spin text-[#163832]" />
                    <p className="text-sm font-medium text-[#051F20]" style={{ fontFamily: 'Inter' }}>
                        Loading invitation details...
                    </p>
                </div>
            </AuthLayout>
        );
    }

    if (error && !invite) {
        return (
            <AuthLayout>
                <div className="mb-6 text-left">
                    <h1 className="text-[40px] leading-[1.08] font-semibold tracking-tight" style={{ fontFamily: 'Inter', color: '#0F172A' }}>
                        Invalid Invitation
                    </h1>
                </div>
                <div className="rounded-xl border border-[#8EB69B] bg-[#8EB69B]/20 p-5 text-[#163832] space-y-4">
                    <p className="text-sm font-medium">{error}</p>
                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="w-full h-11 px-4 text-sm font-medium rounded-md bg-[#0B2B26] text-[#ffffff] hover:bg-[#163832] transition-colors"
                        style={{ fontFamily: 'Inter' }}
                    >
                        Go to Sign In
                    </button>
                </div>
            </AuthLayout>
        );
    }

    if (step === 'success') {
        return (
            <AuthLayout>
                <div className="mb-6 text-left">
                    <h1 className="text-[40px] leading-[1.08] font-semibold tracking-tight" style={{ fontFamily: 'Inter', color: '#0F172A' }}>
                        {pageTitle}
                    </h1>
                    <p className="mt-1.5 text-lg leading-[1.25] text-[#4B5563]" style={{ fontFamily: 'Inter' }}>
                        {pageSubtitle}
                    </p>
                </div>

                <div className="space-y-6">
                    <div className="rounded-xl border border-[#235347] bg-[#ffffff]/40 p-5 flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#163832] text-[#ffffff] flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-[#051F20]" style={{ fontFamily: 'Inter' }}>Account setup complete</h3>
                            <p className="text-sm text-[#0B2B26] mt-1" style={{ fontFamily: 'Inter' }}>
                                Your invitation to <span className="font-semibold text-[#163832]">{invite?.organizationName}</span> has been accepted.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="w-full h-11 rounded-md bg-[#0B2B26] text-[#ffffff] text-sm font-medium hover:bg-[#163832] transition-colors"
                        style={{ fontFamily: 'Inter' }}
                    >
                        Continue to Sign In
                    </button>
                </div>
            </AuthLayout>
        )
    }

    return (
        <AuthLayout>
            <div className="mb-6 text-left">
                <h1 className="text-[40px] leading-[1.08] font-semibold tracking-tight" style={{ fontFamily: 'Inter', color: '#0F172A' }}>
                    {pageTitle}
                </h1>
                <p className="mt-1.5 text-lg leading-[1.25] text-[#4B5563]" style={{ fontFamily: 'Inter' }}>
                    {pageSubtitle}
                </p>
            </div>

            {error && (
                <div className="mb-4 bg-[#8EB69B]/20 py-3 px-4 rounded-md border border-[#8EB69B]">
                    <p className="text-sm font-medium text-[#163832] text-left" style={{ fontFamily: 'Inter' }}>
                        {error}
                    </p>
                </div>
            )}

                <div className="rounded-xl border border-[#235347]/30 bg-[#F8FBF9] p-4 mb-6">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-xs text-[#0B2B26] font-semibold uppercase tracking-wider" style={{ fontFamily: 'Inter' }}>Organization</span>
                        <span className="text-sm font-bold text-[#163832]" style={{ fontFamily: 'Inter' }}>{invite?.organizationName}</span>
                    </div>
                    <div className="flex justify-between items-center mb-2 text-sm">
                        <span className="text-[#0B2B26]" style={{ fontFamily: 'Inter' }}>Invited by</span>
                        <span className="font-semibold text-[#163832]" style={{ fontFamily: 'Inter' }}>{invite?.inviterName}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-[#0B2B26]" style={{ fontFamily: 'Inter' }}>Role</span>
                        <span className="font-semibold text-[#163832] capitalize" style={{ fontFamily: 'Inter' }}>{invite?.role}</span>
                </div>
            </div>

            <form onSubmit={handleCredentialSubmit} className="space-y-4">
                <div className="space-y-1">
                    <label className="block text-sm font-medium text-[#051F20]" style={{ fontFamily: 'Inter' }}>Email</label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0B2B26]" />
                        <input
                            type="email"
                            value={formData.email}
                            disabled
                            className={`${cardInputCls} pl-10 bg-gray-100 text-[#0B2B26] opacity-80 cursor-not-allowed`}
                            style={{ paddingLeft: '2.75rem' }}
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="block text-sm font-medium text-[#051F20]" style={{ fontFamily: 'Inter' }}>Full Name</label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0B2B26]" />
                        <input
                            type="text"
                            required
                            value={formData.fullName}
                            onChange={(e) => updateField('fullName', e.target.value)}
                            placeholder="Your full name"
                            className={`${cardInputCls} pl-10`}
                            style={{ paddingLeft: '2.75rem' }}
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="block text-sm font-medium text-[#051F20]" style={{ fontFamily: 'Inter' }}>Timezone</label>
                    <select
                        value={formData.timezone}
                        onChange={(e) => updateField('timezone', e.target.value)}
                        className={`${cardInputCls} appearance-none cursor-pointer`}
                    >
                        {[...COMMON_TIMEZONES, formData.timezone]
                            .filter((value, index, arr) => arr.indexOf(value) === index)
                            .map(timezone => (
                                <option key={timezone} value={timezone}>{timezone}</option>
                            ))}
                    </select>
                </div>

                <div className="space-y-1">
                    <label className="block text-sm font-medium text-[#051F20]" style={{ fontFamily: 'Inter' }}>Password</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0B2B26]" />
                        <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            value={formData.password}
                            onChange={(e) => updateField('password', e.target.value)}
                            placeholder="Create a password"
                            autoComplete="new-password"
                            className={`${cardInputCls} pl-10 pr-10`}
                            style={{ paddingLeft: '2.75rem' }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(prev => !prev)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#0B2B26] hover:text-[#163832] no-global-hover"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="block text-sm font-medium text-[#051F20]" style={{ fontFamily: 'Inter' }}>Confirm Password</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#0B2B26]" />
                        <input
                            type={showConfirmPassword ? 'text' : 'password'}
                            required
                            value={formData.confirmPassword}
                            onChange={(e) => updateField('confirmPassword', e.target.value)}
                            placeholder="Confirm your password"
                            autoComplete="new-password"
                            className={`${cardInputCls} pl-10 pr-10`}
                            style={{ paddingLeft: '2.75rem' }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowConfirmPassword(prev => !prev)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#0B2B26] hover:text-[#163832] no-global-hover"
                            aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                        >
                            {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                    </div>
                </div>

                {invite?.enforceMfa && (
                    <div className="py-2">
                        <p className="text-xs text-[#0B2B26]" style={{ fontFamily: 'Inter' }}>
                            <span className="font-semibold text-[#163832]">Security Notice:</span> This organization enforces MFA. You can accept this invitation now, then enable MFA after signing in.
                        </p>
                    </div>
                )}

                <div className="pt-3">
                    <button
                        type="submit"
                        disabled={loadingSubmit}
                        className="w-full flex items-center justify-center gap-2 h-11 rounded-md bg-[#0B2B26] text-[#ffffff] text-sm font-medium hover:bg-[#163832] transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
                        style={{ fontFamily: 'Inter' }}
                    >
                        {loadingSubmit ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Accept Invitation
                    </button>
                </div>
            </form>
        </AuthLayout>
    );
};

export default AcceptInvite;
