/// <reference types="vite/client" />
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AtSign } from 'lucide-react';
import AuthLayout from './AuthLayout';
import { AUTH_COLORS, AUTH_FONTS } from './theme';
import './styles.css';

import api from '../../lib/api';

interface ForgotPasswordInputs {
    email?: string;
}

export default function ForgotPassword() {
    const { t } = useTranslation();
    const { register, handleSubmit } = useForm<ForgotPasswordInputs>();

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSuccess, setIsSuccess] = useState(false);

    const onForgotSubmit = async (data: ForgotPasswordInputs) => {
        setIsLoading(true);
        setError(null);

        try {
            await api.post('/auth/forgot-password', { email: data.email });
            setIsSuccess(true);
        } catch (err: any) {
            console.error("Forgot password failed:", err);
            setError(err.response?.data?.message || t('auth_reset_failed', 'Failed to send reset email.'));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AuthLayout>
            <div className="mx-auto w-full max-w-[420px]">
                {isSuccess ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                        <div className="mx-auto mb-6 auth-success-icon">
                            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                        <h2 className="auth-form-title" style={{ fontFamily: AUTH_FONTS.sans }}>
                            Check your email
                        </h2>
                        <p className="auth-form-subtitle mt-2" style={{ fontFamily: AUTH_FONTS.sans }}>
                            If an account exists for that email, we have sent password reset instructions.
                        </p>
                        <Link
                            to="/login"
                            className="auth-button-primary mt-8"
                            style={{ fontFamily: AUTH_FONTS.sans, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            Return to login
                        </Link>
                    </div>
                ) : (
                    <div className="flex flex-col gap-5">
                        {/* Heading */}
                        <div className="text-center">
                            <h1
                                className="auth-form-title"
                                style={{ fontFamily: AUTH_FONTS.sans }}
                            >
                                {t('auth_title_forgot', 'Reset Password')}
                            </h1>
                            <p className="auth-form-subtitle mt-1" style={{ fontFamily: AUTH_FONTS.sans }}>
                                {t('auth_sub_forgot', 'Remember your password?')}{' '}
                                <Link to="/login">
                                    {t('auth_link_login', 'Sign in here')}
                                </Link>
                            </p>
                        </div>

                        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onForgotSubmit)}>
                            {error && (
                                <div className="auth-alert-error">
                                    <p className="auth-alert-error-text">
                                        {error}
                                    </p>
                                </div>
                            )}

                            <div className="relative mt-2">
                                <input
                                    {...register("email", { required: true })}
                                    type="email"
                                    required
                                    placeholder="Email address"
                                    className="auth-input auth-input-with-left-icon"
                                    style={{ fontFamily: AUTH_FONTS.sans }}
                                />
                                <div className="auth-input-icon auth-input-icon-left">
                                    <AtSign className="size-5" />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="auth-button-primary mt-2"
                                style={{ fontFamily: AUTH_FONTS.sans }}
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        {t('loading', 'Sending...')}
                                    </span>
                                ) : (
                                    t('auth_link_send_reset', 'Send Reset Link')
                                )}
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </AuthLayout>
    );
}
