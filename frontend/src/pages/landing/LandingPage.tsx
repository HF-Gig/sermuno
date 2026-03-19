import React, { useEffect, useState } from 'react';
import { ReactLenis } from 'lenis/react';
import './styles.css';

import {
    Navigation,
    HeroSection,
    ProblemSection,
    FeaturesSection,
    IntegrationsSection,
    UseCasesSection,
    PricingSection,
    CTASection,
    Footer,
    Modals,
    FAQSection,
} from './components';

class ParallaxLayer {
    el: HTMLElement;
    speed: number;
    y: number;

    constructor(el: HTMLElement, speed: number) {
        this.el = el;
        this.speed = speed;
        this.y = 0;
    }

    update(scrollY: number) {
        this.y = scrollY * this.speed;
        // Preserve existing transform rules (e.g. translateX centering).
        this.el.style.setProperty('translate', `0 ${this.y}px`);
    }
}

const LandingPage = () => {
    const [activeModal, setActiveModal] = useState<string | null>(null);

    useEffect(() => {
        if (activeModal) {
            document.documentElement.style.overflow = 'hidden';
            document.body.style.overflow = 'hidden';

            const preventScroll = (event: Event) => {
                event.preventDefault();
            };

            const preventKeys = (event: KeyboardEvent) => {
                const blocked = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '];
                if (blocked.includes(event.key)) event.preventDefault();
            };

            window.addEventListener('wheel', preventScroll, { passive: false });
            window.addEventListener('touchmove', preventScroll, { passive: false });
            window.addEventListener('keydown', preventKeys, { passive: false });

            return () => {
                window.removeEventListener('wheel', preventScroll);
                window.removeEventListener('touchmove', preventScroll);
                window.removeEventListener('keydown', preventKeys);
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
            };
        }

        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';

        return () => {
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
        };
    }, [activeModal]);

    useEffect(() => {
        // Universal scroll reveal - fire once, unobserve immediately.
        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    revealObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -50px 0px' });

        document.querySelectorAll('[data-reveal]').forEach((el) => revealObserver.observe(el));

        // Lightweight parallax - runs on scroll, GPU composited via transform.
        const layers: ParallaxLayer[] = [];
        document.querySelectorAll('[data-parallax]').forEach((el) => {
            layers.push(new ParallaxLayer(el as HTMLElement, parseFloat((el as HTMLElement).dataset.parallax || '0.2')));
        });

        let ticking = false;
        const handleScroll = () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    const scrollY = window.pageYOffset;
                    layers.forEach((layer) => layer.update(scrollY));
                    ticking = false;
                });
                ticking = true;
            }
        };

        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            revealObserver.disconnect();
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    return (
        <ReactLenis
            root
            options={{
                lerp: 0.1,
                duration: 1.5,
                smoothWheel: true,
                smoothTouch: false,
            }}
        >
            <div className="landing-wrapper">
                <Navigation />
                <HeroSection />
                <IntegrationsSection />
                <ProblemSection />
                <FeaturesSection />
                <UseCasesSection />
                <div id="pricing">
                    <PricingSection />
                </div>
                <FAQSection />
                <CTASection />
                <Footer onOpenModal={setActiveModal} />
            </div>
            {/* Rendered outside landing-wrapper so position:fixed modal escapes contain:paint */}
            <div className="landing-modal-portal">
                <Modals activeModal={activeModal} onClose={() => setActiveModal(null)} />
            </div>
        </ReactLenis>
    );
};

export default LandingPage;
