/**
 * Spiral Background Component - LOCAL COPY
 * Used only within the landing page
 */

import { useMemo } from "react";

type GradientName =
    | "none"
    | "rainbow"
    | "sunset"
    | "ocean"
    | "fire"
    | "neon"
    | "pastel"
    | "grayscale";

type Props = {
    size?: number;
    pulseEffect?: boolean;
    spinEffect?: boolean;
    duration?: number;
    spinDuration?: number;
    color?: string;
    gradient?: GradientName;
    tilt?: boolean;
    glow?: boolean;
    arms?: number;
    turns?: number;
    points?: number;
    dotRadius?: number;
    opacityMax?: number;
};

export default function SpiralBackground({
    size = 1200,
    pulseEffect = true,
    spinEffect = true,
    duration = 4.0,
    spinDuration = 100,
    color = "#ffffff",
    gradient = "none",
    tilt = true,
    glow = true,
    arms = 5,
    turns = 2.5,
    points = 1000,
    dotRadius = 1.5,
    opacityMax = 0.6,
}: Props) {
    const normalizedOpacity = Math.min(1, Math.max(0, opacityMax));
    const minPulseOpacity = Math.max(0.05, normalizedOpacity * 0.25);

    const pathData = useMemo(() => {
        const CENTER = size / 2;
        const MAX_R = CENTER - 10;
        const pointsPerArm = Math.max(24, Math.floor(points / Math.max(1, arms)));
        let d = "";

        for (let a = 0; a < arms; a++) {
            const angleOffset = (Math.PI * 2 * a) / arms;
            
            for (let i = 0; i < pointsPerArm; i++) {
                const fraction = i / (pointsPerArm - 1);
                const r = MAX_R * Math.pow(fraction, 1.4); 
                const theta = angleOffset + fraction * Math.PI * 2 * turns;
                
                const x = CENTER + r * Math.cos(theta);
                const y = CENTER + r * Math.sin(theta);
                
                if (i === 0) {
                    d += `M ${x.toFixed(2)} ${y.toFixed(2)} `;
                } else {
                    d += `L ${x.toFixed(2)} ${y.toFixed(2)} `;
                }
            }
        }
        return d;
    }, [size, arms, turns, points]);

    return (
        <div
            style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                width: "100%",
                height: "100%",
                transform: tilt ? "perspective(1000px) rotateX(65deg) scale(1.8) translateY(-10%)" : "none",
                transformStyle: "preserve-3d",
                pointerEvents: "none",
                overflow: "hidden",
                WebkitMaskImage: "radial-gradient(circle at center, black 30%, transparent 70%)",
                maskImage: "radial-gradient(circle at center, black 30%, transparent 70%)"
            }}
        >
            <svg
                width={size}
                height={size}
                viewBox={`0 0 ${size} ${size}`}
                xmlns="http://www.w3.org/2000/svg"
                style={{ overflow: "visible" }}
            >
                <defs>
                    <style>
                        {`
                            @keyframes spinGallery {
                                from { transform: rotate(0deg); }
                                to { transform: rotate(360deg); }
                            }
                            @keyframes pulseOpacity {
                                0%, 100% { opacity: ${normalizedOpacity}; }
                                50% { opacity: ${minPulseOpacity}; }
                            }
                            .saas-spiral-container {
                                transform-origin: center center;
                                animation: ${spinEffect ? `spinGallery ${spinDuration}s linear infinite` : 'none'};
                            }
                            .saas-spiral-path {
                                fill: none;
                                stroke-width: ${dotRadius};
                                stroke-linecap: round;
                                animation: ${pulseEffect ? `pulseOpacity ${duration}s ease-in-out infinite` : 'none'};
                            }
                        `}
                    </style>

                    {glow && (
                        <filter id="saas-glow" x="-50%" y="-50%" width="200%" height="200%" filterUnits="userSpaceOnUse">
                            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blurLayer" />
                            <feMerge>
                                <feMergeNode in="blurLayer" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    )}
                </defs>

                <g className="saas-spiral-container">
                    <path
                        className="saas-spiral-path"
                        d={pathData}
                        stroke={color}
                        filter={glow ? "url(#saas-glow)" : undefined}
                        opacity={normalizedOpacity}
                    />
                </g>
            </svg>
        </div>
    );
}
