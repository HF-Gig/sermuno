import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useLenis } from 'lenis/react';

const Navigation = () => {
    const lenis = useLenis();
    const [scrolled, setScrolled] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 60);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const smoothScrollTo = (top: number, duration = 700) => {
        if (lenis) {
            lenis.scrollTo(top, {
                duration: 1.1,
                immediate: false,
            });
            return;
        }

        const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReduced) {
            window.scrollTo(0, top);
            return;
        }

        const startTop = window.scrollY;
        const distance = top - startTop;
        let startTime: number | null = null;

        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

        const step = (timestamp: number) => {
            if (startTime === null) startTime = timestamp;
            const elapsed = timestamp - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeOutCubic(progress);

            window.scrollTo(0, startTop + distance * eased);

            if (progress < 1) {
                window.requestAnimationFrame(step);
            }
        };

        window.requestAnimationFrame(step);
    };

    const handleScroll = (e: React.MouseEvent<HTMLAnchorElement>, targetId: string) => {
        e.preventDefault();
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
            const headerOffset = 80;
            const elementPosition = targetElement.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.scrollY - headerOffset;
            smoothScrollTo(offsetPosition);
        }
    };

    const toggleMobileMenu = () => {
        setMobileMenuOpen(prev => {
            document.body.style.overflow = prev ? '' : 'hidden';
            return !prev;
        });
    };

    const handleMobileNavClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
        e.preventDefault();
        // Close menu first, then scroll after animation frame
        document.body.style.overflow = '';
        setMobileMenuOpen(false);
        requestAnimationFrame(() => {
            const targetElement = document.getElementById(id);

            if (targetElement) {
                const headerOffset = 80;
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.scrollY - headerOffset;
                smoothScrollTo(offsetPosition);
            }
        });
    };

    const navLinks = [
        { label: 'Features', id: 'features' },
        { label: 'Integrations', id: 'integrations' },
        { label: 'Pricing', id: 'pricing' }
    ];

    return (
        <>
            <nav id="navbar" className={scrolled ? 'scrolled' : ''}>
                <div className="nav-inner container">
                    <Link to="/" className="nav-logo">SERMUNO</Link>

                    {/* Desktop Nav */}
                    <div className="nav-links">
                        {navLinks.map((link) => (
                            <a
                                key={link.label}
                                href={`#${link.id}`}
                                onClick={(e) => handleScroll(e, link.id)}
                                className="nav-link"
                            >
                                {link.label}
                            </a>
                        ))}
                    </div>

                    <div className="nav-actions">
                        <Link to="/login" className="nav-signin">Sign In</Link>
                        <Link to="/signup" className="btn-primary" style={{ padding: '8px 18px', fontSize: '13px' }}>Try for Free</Link>
                    </div>

                    {/* Mobile Menu Toggle */}
                    <button className="mobile-menu-btn" onClick={toggleMobileMenu} aria-label="Toggle menu">
                        {mobileMenuOpen ? <X size={24} color="var(--c-mint)" /> : <Menu size={24} color="var(--c-mint)" />}
                    </button>
                </div>
            </nav>

            {/* Mobile Menu Overlay */}
            <div className={`mobile-menu-overlay ${mobileMenuOpen ? 'open' : ''}`}>
                <div className="mobile-menu-content">
                    {navLinks.map((link) => (
                        <a
                            key={link.label}
                            href={`#${link.id}`}
                            onClick={(e) => handleMobileNavClick(e, link.id)}
                            className="mobile-nav-link"
                        >
                            {link.label}
                        </a>
                    ))}
                    <div className="mobile-nav-divider"></div>
                    <Link to="/login" className="mobile-nav-link" onClick={toggleMobileMenu}>Sign In</Link>
                    <Link to="/signup" className="btn-primary" style={{ marginTop: '16px', width: '100%', maxWidth: '240px' }} onClick={toggleMobileMenu}>Try for Free</Link>
                </div>
            </div>
        </>
    );
};

export default Navigation;
