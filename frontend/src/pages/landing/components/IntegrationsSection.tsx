import React, { useEffect, useRef } from 'react';

type Integration = { id: number; name: string; icon: React.ReactNode };

const integrations: Integration[] = [
    {
        id: 1,
        name: 'Google Workspace',
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <path d="M20.5 12.2c0-.72-.06-1.4-.19-2.07H12v3.92h4.75c-.21 1.02-.82 1.88-1.76 2.46v2.97h3.18c1.86-1.72 2.93-4.25 2.93-7.28Z" fill="currentColor" />
                <path d="M12 21c2.64 0 4.86-.87 6.47-2.37l-3.18-2.97c-.88.58-2 .93-3.29.93-2.53 0-4.69-1.71-5.47-4.01H3.29v3.03A9.01 9.01 0 0 0 12 21Z" fill="currentColor" fillOpacity="0.88" />
                <path d="M6.53 12.58A5.4 5.4 0 0 1 6.22 11c0-.56.11-1.08.31-1.58V6.39H3.29A9.02 9.02 0 0 0 3 11c0 1.45.35 2.82.97 4.03l2.56-2.45Z" fill="currentColor" fillOpacity="0.76" />
                <path d="M12 5.4c1.43 0 2.71.49 3.72 1.46l2.79-2.8C16.86 2.5 14.64 1.6 12 1.6A9.01 9.01 0 0 0 3.29 6.39l3.24 3.03C7.31 7.12 9.47 5.4 12 5.4Z" fill="currentColor" fillOpacity="0.64" />
            </svg>
        ),
    },
    {
        id: 2,
        name: 'Microsoft 365',
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <rect x="2" y="2" width="9" height="9" rx="1.2" fill="currentColor" />
                <rect x="13" y="2" width="9" height="9" rx="1.2" fill="currentColor" fillOpacity="0.88" />
                <rect x="2" y="13" width="9" height="9" rx="1.2" fill="currentColor" fillOpacity="0.76" />
                <rect x="13" y="13" width="9" height="9" rx="1.2" fill="currentColor" fillOpacity="0.64" />
            </svg>
        ),
    },
    {
        id: 3,
        name: 'Slack',
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <rect x="9.5" y="1.8" width="4" height="8" rx="2" fill="currentColor" />
                <rect x="13.2" y="9.5" width="8" height="4" rx="2" fill="currentColor" fillOpacity="0.88" />
                <rect x="10.5" y="14.2" width="4" height="8" rx="2" fill="currentColor" fillOpacity="0.76" />
                <rect x="1.8" y="10.5" width="8" height="4" rx="2" fill="currentColor" fillOpacity="0.64" />
            </svg>
        ),
    },
    {
        id: 4,
        name: 'SMTP/IMAP',
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <rect x="2.5" y="5" width="19" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
                <path d="m3.5 7.2 8.5 6.1 8.5-6.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        ),
    },
    {
        id: 5,
        name: 'Webhooks',
        icon: (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <path d="M7 7.5a4.5 4.5 0 0 1 7.58-3.22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M17 16.5a4.5 4.5 0 0 1-7.58 3.22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <path d="M16.5 7A4.5 4.5 0 0 1 20 14.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="7" cy="7.5" r="1.7" fill="currentColor" />
                <circle cx="17" cy="16.5" r="1.7" fill="currentColor" fillOpacity="0.8" />
                <circle cx="18.9" cy="13.9" r="1.5" fill="currentColor" fillOpacity="0.6" />
            </svg>
        ),
    },
];

const repeatSets = 8;

const IntegrationsSection = () => {
    const trackRef = useRef<HTMLDivElement>(null);
    const setRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number | null>(null);

    const targetSpeedRef = useRef(1);
    const currentSpeedRef = useRef(1);
    const offsetRef = useRef(0);
    const setWidthRef = useRef(0);

    useEffect(() => {
        const updateSetWidth = () => {
            if (setRef.current) {
                setWidthRef.current = setRef.current.offsetWidth;
            }
        };

        updateSetWidth();

        const resizeObserver = new ResizeObserver(updateSetWidth);
        if (setRef.current) resizeObserver.observe(setRef.current);

        const animate = () => {
            currentSpeedRef.current += (targetSpeedRef.current - currentSpeedRef.current) * 0.05;
            offsetRef.current -= currentSpeedRef.current;

            if (setWidthRef.current > 0 && offsetRef.current <= -setWidthRef.current) {
                offsetRef.current += setWidthRef.current;
            }

            if (trackRef.current) {
                trackRef.current.style.transform = `translate3d(${offsetRef.current}px, 0, 0)`;
            }

            rafRef.current = window.requestAnimationFrame(animate);
        };

        rafRef.current = window.requestAnimationFrame(animate);

        return () => {
            resizeObserver.disconnect();
            if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
        };
    }, []);

    return (
        <section className="integrations-section" id="integrations">
            <div className="integrations-container">
                <p className="integrations-eyebrow" data-reveal>
                    Integrations
                </p>
                <h2 className="integrations-h2" data-reveal data-delay="1">
                    Works with your existing support stack
                </h2>
                <p className="integrations-subtext" data-reveal data-delay="2">
                    Connect your inboxes, CRMs, and workflows without migration headaches.
                </p>
            </div>

            <div
                className="integrations-marquee"
                data-reveal
                data-delay="3"
                onMouseEnter={() => {
                    targetSpeedRef.current = 0;
                }}
                onMouseLeave={() => {
                    targetSpeedRef.current = 1;
                }}
            >
                <div className="integrations-track" ref={trackRef} role="list" aria-label="Sermuno integrations logos">
                    {Array.from({ length: repeatSets }, (_, setIdx) => (
                        <div key={`set-${setIdx}`} className="integrations-set" ref={setIdx === 0 ? setRef : undefined}>
                            {integrations.map((item) => (
                                <span key={`${setIdx}-${item.id}`} className="integration-logo-item" role="listitem">
                                    <span className="integration-logo-wrapper">{item.icon}</span>
                                    <span className="integration-name">{item.name}</span>
                                </span>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default IntegrationsSection;
