import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import AuthLayout from './AuthLayout';
import { Eye, EyeOff } from 'lucide-react';

import api from '../../lib/api';

interface ResetPasswordInputs {
    password: string;
    confirmPassword: string;
}

export default function ResetPassword() {
    const { t } = useTranslation();
    const { register, handleSubmit, formState: { errors }, watch } = useForm<ResetPasswordInputs>();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const token = searchParams.get('token');

    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // UI state
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const onSubmit = async (data: ResetPasswordInputs) => {
        if (!token) {
            setError(t('missing_reset_token', 'Invalid or missing token.'));
            return;
        }

        setIsLoading(true);
        setError(null);
        setMessage(null);

        try {
            const response = await api.post('/auth/reset-password', {
                token,
                password: data.password
            });
            setMessage(response.data.message);
            setTimeout(() => {
                navigate('/login');
            }, 3000);
        } catch (err: any) {
            console.error("Reset Password failed:", err);
            setError(err.response?.data?.message || t('something_went_wrong', 'Something went wrong. Please try again.'));
        } finally {
            setIsLoading(false);
        }
    };

    if (!token) {
        return (
            <AuthLayout>
                <div className="text-center">
                    <p className="text-[#163832] font-semibold text-lg" style={{ fontFamily: 'Inter' }}>
                        {t('missing_reset_token', 'Invalid or missing reset token.')}
                    </p>
                    <Link to="/login" className="mt-4 inline-block text-[#235347] font-medium hover:underline underline-offset-4" style={{ fontFamily: 'Inter' }}>
                        {t('back_to_login', 'Back to Login')}
                    </Link>
                </div>
            </AuthLayout>
        );
    }

    return (
        <AuthLayout>
            <div className="mx-auto w-full max-w-[420px]">
                {message ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0B2B26]/5">
                            <svg className="h-8 w-8 text-[#235347]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h2 className="text-[32px] font-semibold tracking-tight !text-black md:text-[36px]" style={{ fontFamily: 'Inter' }}>
                            {t('password_reset_success_title', 'Password Reset')}
                        </h2>
                        <p className="mt-2 text-[15px] text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                            {message}
                        </p>
                        <div className="mt-8 flex items-center justify-center gap-2 text-[14px] font-medium !text-black" style={{ fontFamily: 'Inter' }}>
                            <svg className="animate-spin h-4 w-4 text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {t('redirecting_to_login', 'Redirecting to login...')}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-5">
                        {/* Heading */}
                        <div className="text-center">
                            <h1 className="text-[32px] font-semibold tracking-tight md:text-[36px]" style={{ fontFamily: 'Inter', color: '#0F172A' }}>
                                {t('reset_password_title', 'Set new password')}
                            </h1>
                            <p className="mt-1 text-[15px] text-[#6B7280]" style={{ fontFamily: 'Inter' }}>
                                Please enter your new password below.
                            </p>
                        </div>

                        {error && (
                            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-center">
                                <p className="text-sm font-medium text-[#991B1B]" style={{ fontFamily: 'Inter' }}>
                                    {error}
                                </p>
                            </div>
                        )}

                        <form className="flex flex-col gap-4 mt-2" onSubmit={handleSubmit(onSubmit)}>
                            <div className="relative">
                                <input
                                    {...register("password", {
                                        required: true,
                                        minLength: { value: 8, message: t('password_min_length', 'Password must be at least 8 characters') }
                                    })}
                                    type={showPassword ? "text" : "password"}
                                    placeholder={t('new_password_label', 'New Password') as string}
                                    className="h-12 w-full appearance-none rounded-xl border border-[#D1D5DB] bg-white !pl-12 !pr-11 py-3 text-[15px] leading-6 text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#9CA3AF] focus:outline-none"
                                    style={{ fontFamily: 'Inter', paddingLeft: '3rem', paddingRight: '2.75rem' }}
                                />
                                <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-key-round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r="1.5" /></svg>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(prev => !prev)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] focus:outline-none auth-eye-button"
                                >
                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                            {errors.password && <span className="text-[#991B1B] text-xs px-2 -mt-2">{errors.password.message as string}</span>}

                            <div className="relative">
                                <input
                                    {...register("confirmPassword", {
                                        required: true,
                                        validate: (val: string) => {
                                            if (watch('password') !== val) {
                                                return t('passwords_do_not_match', 'Your passwords do not match');
                                            }
                                        }
                                    })}
                                    type={showConfirmPassword ? "text" : "password"}
                                    placeholder={t('confirm_password_label', 'Confirm Password') as string}
                                    className="h-12 w-full appearance-none rounded-xl border border-[#D1D5DB] bg-white !pl-12 !pr-11 py-3 text-[15px] leading-6 text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#9CA3AF] focus:outline-none"
                                    style={{ fontFamily: 'Inter', paddingLeft: '3rem', paddingRight: '2.75rem' }}
                                />
                                <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280]">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-key-round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r="1.5" /></svg>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(prev => !prev)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#111827] focus:outline-none auth-eye-button"
                                >
                                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                            </div>
                            {errors.confirmPassword && <span className="text-[#991B1B] text-xs px-2 -mt-2">{errors.confirmPassword.message as string}</span>}

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="h-12 w-full mt-2 rounded-xl bg-[#0B2B26] text-[15px] font-semibold text-white shadow-[0_6px_20px_rgba(11,43,38,0.18)] transition-colors hover:bg-[#163832] disabled:cursor-not-allowed disabled:opacity-70"
                                style={{ fontFamily: 'Inter' }}
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        {t('resetting', 'Resetting...')}
                                    </span>
                                ) : (
                                    t('reset_password_btn', 'Reset Password')
                                )}
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </AuthLayout>
    );
}
