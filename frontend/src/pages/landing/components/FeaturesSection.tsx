import { useEffect, useState, type MouseEvent } from 'react';

type Feature = {
    key: string;
    label: string;
    title: string;
    body: string;
    large?: boolean;
};

const features: Feature[] = [
    {
        key: 'orchestration',
        label: 'Orchestration',
        title: 'Centralize every customer thread in one command center',
        body: 'Merge support inboxes, escalate by policy, and route ownership automatically without losing account context.',
        large: true,
    },
    {
        key: 'sla',
        label: 'SLA',
        title: 'SLA guardrails',
        body: 'Get proactive breach alerts before deadlines slip.',
    },
    {
        key: 'automation',
        label: 'Automation',
        title: 'Rules engine',
        body: 'Trigger assignment, tags, and priority from intent.',
    },
    {
        key: 'collaboration',
        label: 'Collaboration',
        title: 'Internal notes',
        body: 'Resolve complex issues with teammate context inline.',
    },
    {
        key: 'analytics',
        label: 'Analytics',
        title: 'Team insights',
        body: 'Track volume, response quality, and staffing coverage.',
    },
];

const FeaturesSection = () => {
    const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);

    useEffect(() => {
        const media = window.matchMedia('(max-width: 768px)');
        const listener = () => setIsMobile(media.matches);
        media.addEventListener('change', listener);
        return () => media.removeEventListener('change', listener);
    }, []);

    const onCardMove = (event: MouseEvent<HTMLElement>) => {
        if (isMobile) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        event.currentTarget.style.setProperty('--mouse-x', `${x}px`);
        event.currentTarget.style.setProperty('--mouse-y', `${y}px`);
    };

    return (
        <section className="features-section" id="features">
            <div className="features-container">
                <div className="features-header">
                    <p className="features-eyebrow" data-reveal>
                        Features
                    </p>
                    <h2 className="features-h2" data-reveal data-delay="1">
                        Built for high-volume support teams
                    </h2>
                    <p className="features-subtext" data-reveal data-delay="2">
                        A modern operations layer for ownership, automation, and real-time service performance.
                    </p>
                </div>

                <div className="features-bento-grid">
                    {features.map((feature, idx) => (
                        <article
                            key={feature.key}
                            className={`feature-card bento-card ${feature.large ? 'bento-card-large' : ''}`}
                            onMouseMove={onCardMove}
                            data-reveal
                            data-delay={Math.min(idx + 1, 5).toString()}
                        >
                            <p className="feature-label">{feature.label}</p>
                            <h3 className="feature-title">{feature.title}</h3>
                            <p className="feature-body">{feature.body}</p>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default FeaturesSection;
