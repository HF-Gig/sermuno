/**
 * Auth-specific utility components
 */

import React from 'react';
import { motion } from 'framer-motion';
import { AUTH_COLORS } from '../theme';

interface FloatingPathsProps {
    position: number;
}

export function FloatingPaths({ position }: FloatingPathsProps) {
    const paths = Array.from({ length: 36 }, (_, i) => ({
        id: i,
        d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position
            } -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position
            } ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position
            } ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
        width: 0.5 + i * 0.03,
    }));

    return (
        <div className="pointer-events-none absolute inset-0">
            <svg
                className="h-full w-full"
                viewBox="0 0 696 316"
                fill="none"
                style={{ color: AUTH_COLORS.mint }}
            >
                <title>Background Paths</title>
                {paths.map((path) => (
                    <motion.path
                        key={path.id}
                        d={path.d}
                        stroke="currentColor"
                        strokeWidth={path.width}
                        strokeOpacity={0.035 + path.id * 0.008}
                        initial={{ pathLength: 0.3, opacity: 0.25 }}
                        animate={{
                            pathLength: 1,
                            opacity: [0.12, 0.3, 0.12],
                            pathOffset: [0, 1, 0],
                        }}
                        transition={{
                            duration: 20 + Math.random() * 10,
                            repeat: Number.POSITIVE_INFINITY,
                            ease: 'linear',
                        }}
                    />
                ))}
            </svg>
        </div>
    );
}

interface AuthSeparatorProps {
    label?: string;
}

export function AuthSeparator({ label = 'OR' }: AuthSeparatorProps) {
    return (
        <div className="relative my-5 flex items-center gap-3">
            <div className="h-px flex-1" style={{ backgroundColor: AUTH_COLORS.gray300 }} />
            <span 
                className="text-xs font-medium uppercase tracking-[0.08em]" 
                style={{ color: AUTH_COLORS.gray500 }}
            >
                {label}
            </span>
            <div className="h-px flex-1" style={{ backgroundColor: AUTH_COLORS.gray300 }} />
        </div>
    );
}

export const GoogleIcon = (props: React.ComponentProps<'svg'>) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
        <path d="M12.479,14.265v-3.279h11.049c0.108,0.571,0.164,1.247,0.164,1.979c0,2.46-0.672,5.502-2.84,7.669 C18.744,22.829,16.051,24,12.483,24C5.869,24,0.308,18.613,0.308,12S5.869,0,12.483,0c3.659,0,6.265,1.436,8.223,3.307L18.392,5.62 c-1.404-1.317-3.307-2.341-5.913-2.341C7.65,3.279,3.873,7.171,3.873,12s3.777,8.721,8.606,8.721c3.132,0,4.916-1.258,6.059-2.401 c0.927-0.927,1.537-2.251,1.777-4.059L12.479,14.265z" />
    </svg>
);

export const MicrosoftIcon = (props: React.ComponentProps<'svg'>) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21" fill="currentColor" {...props}>
        <path fill="#f25022" d="M1 1h9v9H1z" />
        <path fill="#7fba00" d="M11 1h9v9h-9z" />
        <path fill="#00a4ef" d="M1 11h9v9H1z" />
        <path fill="#ffb900" d="M11 11h9v9h-9z" />
    </svg>
);
