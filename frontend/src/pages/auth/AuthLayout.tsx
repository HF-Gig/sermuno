import React, { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FloatingPaths } from './components/utils';
import { AUTH_COLORS, AUTH_FONTS } from './theme';

interface AuthLayoutProps {
    children: ReactNode;
}

export default function AuthLayout({ children }: AuthLayoutProps) {
    const { t } = useTranslation();

    return (
        <div className="relative min-h-screen bg-white lg:grid lg:grid-cols-2" style={{ fontFamily: AUTH_FONTS.sans }}>
            {/* Left Side - Dark Brand */}
            <div 
                className="relative hidden overflow-hidden lg:flex lg:min-h-screen lg:justify-center lg:px-10 lg:py-12"
                style={{ backgroundColor: AUTH_COLORS.darker, color: AUTH_COLORS.mint }}
            >
                <div className="relative z-20 mx-auto flex h-full w-full max-w-[520px] flex-col items-center justify-center text-center lg:-translate-y-10">
                    <div className="inline-flex justify-center">
                        <Link
                            to="/"
                            className="text-6xl font-bold uppercase tracking-[0.18em] leading-[1.25] transition-colors hover:opacity-80 -translate-y-10"
                            style={{ fontFamily: AUTH_FONTS.sans, color: AUTH_COLORS.mint }}
                        >
                            Sermuno
                        </Link>
                    </div>

                    <div className="mt-8 w-full max-w-[440px]">
                        <p 
                            className="text-[21px] leading-relaxed font-light tracking-wide" 
                            style={{ color: `${AUTH_COLORS.mint}e6` }}
                        >
                            {t('auth_layout_tagline', 'The unified workspace for modern teams. Streamline operations, automate workflows, and accelerate scalable growth.')}
                        </p>
                    </div>
                </div>

                <div className="pointer-events-none absolute inset-0 z-10">
                    <FloatingPaths position={1} />
                    <FloatingPaths position={-1} />
                </div>
            </div>

            {/* Right Side - Light Form */}
            <div 
                className="relative flex min-h-screen items-center justify-center px-6 py-12"
                style={{ backgroundColor: AUTH_COLORS.lightGray, color: AUTH_COLORS.textDark }}
            >
                <Link 
                    to="/" 
                    className="absolute left-6 top-6 inline-flex items-center gap-2 text-sm font-medium transition-colors hover:opacity-70 sm:left-8 sm:top-8 lg:left-10 lg:top-10"
                    style={{ color: AUTH_COLORS.darker }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    {t('auth_home', 'Home')}
                </Link>

                <div className="relative mx-auto flex w-full max-w-[420px] flex-col lg:-translate-y-1">

                    <div className="mb-6 flex items-center justify-center lg:hidden">
                        <Link 
                            to="/" 
                            className="text-4xl font-bold tracking-widest uppercase"
                            style={{ color: AUTH_COLORS.deep, fontFamily: AUTH_FONTS.sans }}
                        >
                            Sermuno
                        </Link>
                    </div>

                    {children}
                </div>
            </div>
        </div>
    );
}
