import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '../../lib/api';
import { useAuth } from '../../context/AuthContext';

export default function OnboardingPage() {
    const navigate = useNavigate();
    const { user, updateUser } = useAuth();
    const [organizationName, setOrganizationName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (!user.needsSetup) {
        return <Navigate to="/dashboard" replace />;
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const normalizedName = organizationName.trim();

        if (!normalizedName) {
            setError('Organization name is required.');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            await api.post('/organizations/setup', {
                name: normalizedName,
            });

            const meResponse = await api.get('/auth/me');
            updateUser(meResponse.data);

            navigate('/dashboard', { replace: true });
        } catch (err: any) {
            setError(err?.response?.data?.message || 'Failed to complete organization setup.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#f4efe7] px-6 py-10 text-[#102019]">
            <div className="mx-auto flex min-h-[80vh] max-w-xl items-center justify-center">
                <div className="w-full rounded-[28px] border border-[#d7cbb8] bg-white p-8 shadow-[0_24px_60px_rgba(16,32,25,0.08)] md:p-10">
                    <div className="mb-8">
                        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-[#8a6f47]">
                            One last step
                        </p>
                        <h1 className="text-3xl font-semibold tracking-tight text-[#102019]">
                            What is the name of your organization?
                        </h1>
                        <p className="mt-3 text-sm leading-6 text-[#55635a]">
                            Finish setup to unlock your workspace. You must create your organization before accessing the dashboard.
                        </p>
                    </div>

                    <form className="space-y-5" onSubmit={handleSubmit}>
                        <div>
                            <label className="mb-2 block text-sm font-medium text-[#223229]" htmlFor="organizationName">
                                Organization name
                            </label>
                            <input
                                id="organizationName"
                                type="text"
                                value={organizationName}
                                onChange={(event) => setOrganizationName(event.target.value)}
                                placeholder="Acme Support"
                                autoFocus
                                className="h-12 w-full rounded-xl border border-[#d7cbb8] px-4 text-sm text-[#102019] outline-none transition focus:border-[#8a6f47]"
                            />
                        </div>

                        {error && (
                            <div className="rounded-xl border border-[#efc6c1] bg-[#fff2f1] px-4 py-3 text-sm text-[#9f2d20]">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="h-12 w-full rounded-xl bg-[#163832] text-sm font-semibold text-white transition hover:bg-[#102b27] disabled:cursor-not-allowed disabled:opacity-70"
                        >
                            {isSubmitting ? 'Creating organization...' : 'Continue to dashboard'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
