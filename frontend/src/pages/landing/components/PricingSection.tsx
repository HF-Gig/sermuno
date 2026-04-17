import React from 'react';
import { Link } from 'react-router-dom';

type Plan = {
    name: 'Starter' | 'Professional' | 'Enterprise';
    price: string;
    cadence: string;
    description: string;
    features: string[];
    cta: string;
    href: string;
    featured?: boolean;
};

const plans: Plan[] = [
    {
        name: 'Starter',
        price: '€24.99',
        cadence: '/month',
        description: 'Core inbox workflows for growing support teams.',
        features: [
            'Up to 5 shared inboxes',
            'Assignment and status routing',
            'Templates and team signatures',
            'Basic SLA notifications',
        ],
        cta: 'Get Started',
        href: '/signup',
    },
    {
        name: 'Professional',
        price: '€29.99',
        cadence: '/month',
        description: 'Advanced operations for high-volume customer support.',
        features: [
            'Unlimited shared inboxes',
            'Automation rules and escalations',
            'SLA policies and alerts',
            'Advanced analytics and exports',
        ],
        cta: 'Get Started',
        href: '/signup',
        featured: true,
    },
    {
        name: 'Enterprise',
        price: 'Custom',
        cadence: '',
        description: 'Security, governance, and dedicated rollout support.',
        features: [
            'SSO and advanced permissions',
            'Custom data retention policies',
            'Priority support channel',
            'Dedicated onboarding specialist',
        ],
        cta: 'Contact Sales',
        href: '/signup',
    },
];

const Checkmark = () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="m2.4 7.4 2.7 2.9 6-6" stroke="var(--c-mint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const PricingSection = () => {
    return (
        <section className="pricing-section" id="pricing">
            <div className="pricing-container">
                <div className="pricing-header-wrap">
                    <p className="pricing-eyebrow" data-reveal>
                        Pricing
                    </p>
                    <h2 className="pricing-h2" data-reveal data-delay="1">
                        Plans that scale with your support operation
                    </h2>
                    <p className="pricing-subtext" data-reveal data-delay="2">
                        Start lean, then unlock advanced controls and reporting as your team grows.
                    </p>
                </div>

                <div className="pricing-grid">
                    {plans.map((plan, idx) => (
                        <article key={plan.name} className={`pricing-card ${plan.featured ? 'featured' : ''}`} data-reveal data-delay={Math.min(idx + 1, 3).toString()}>
                            {plan.featured && <span className="pricing-badge">Most Popular</span>}

                            <div className="pricing-plan-top">
                                <h3 className="pricing-plan-name">{plan.name}</h3>
                                <p className="pricing-plan-desc">{plan.description}</p>
                                <div className="pricing-price-row">
                                    <span className="pricing-price">{plan.price}</span>
                                    <span className="pricing-cadence">{plan.cadence}</span>
                                </div>
                            </div>

                            <ul className="pricing-features" aria-label={`${plan.name} features`}>
                                {plan.features.map((item) => (
                                    <li key={item} className="pricing-feature-item">
                                        <span className="pricing-checkmark"><Checkmark /></span>
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>

                            <Link to={plan.href} className={plan.featured ? 'pricing-btn-primary' : 'pricing-btn-ghost'}>
                                {plan.cta}
                            </Link>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default PricingSection;
