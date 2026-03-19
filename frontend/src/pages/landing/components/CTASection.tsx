import React from 'react';
import { Link } from 'react-router-dom';
import { useLenis } from 'lenis/react';

const CTASection = () => {
    const lenis = useLenis();

    const handleViewPricing = (e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        const targetElement = document.getElementById('pricing');
        if (!targetElement) return;

        const headerOffset = 80;
        const elementPosition = targetElement.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.scrollY - headerOffset;

        if (lenis) {
            lenis.scrollTo(offsetPosition, {
                duration: 1.1,
                immediate: false,
            });
            return;
        }

        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    };

    return (
        <section className="cta-section">
            <div className="cta-section-wrapper">
                <div className="cta-background-geometry" aria-hidden="true">
                    <svg className="geometry-shape shape-1" viewBox="0 0 800 520" fill="none">
                        <path d="M20 500 420 20 780 500Z" fill="currentColor" />
                    </svg>
                    <svg className="geometry-shape shape-2" viewBox="0 0 800 520" fill="none">
                        <path d="M120 460C240 340 350 290 500 290c118 0 203-36 272-128" stroke="currentColor" strokeWidth="2" />
                        <path d="M80 386c112-94 225-132 358-132 126 0 214-34 304-130" stroke="currentColor" strokeWidth="2" />
                        <path d="M42 320c104-70 220-96 338-96 136 0 242-44 356-152" stroke="currentColor" strokeWidth="2" />
                    </svg>
                    <svg className="geometry-shape shape-3" viewBox="0 0 520 260" fill="none">
                        <path d="M72 178 262 68l186 108-186 108L72 178Z" fill="currentColor" />
                        <path d="M130 178 262 102l132 76-132 76-132-76Z" fill="currentColor" opacity="0.72" />
                    </svg>
                </div>

                <div className="cta-content-top">
                    <p className="cta-eyebrow" data-reveal>READY TO START?</p>
                    <h2 className="cta-h2" data-reveal data-delay="1">
                        Move from inbox chaos to operational clarity.
                    </h2>
                </div>

                <div className="cta-content-bottom" data-reveal data-delay="2">
                    <p className="cta-subtext">
                        Launch Sermuno with your team, centralize shared inbox workflows, and resolve customer issues with measurable speed.
                    </p>

                    <div className="cta-actions">
                        <Link to="/signup" className="btn-primary">
                            Try for Free
                        </Link>
                        <a href="#pricing" className="btn-ghost" onClick={handleViewPricing}>
                            View Pricing
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default CTASection;
