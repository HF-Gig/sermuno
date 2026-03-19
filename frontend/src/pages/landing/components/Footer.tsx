import React from 'react';
import { Link } from 'react-router-dom';
import { useLenis } from 'lenis/react';

const HEADER_OFFSET = 80;

interface FooterProps {
    onOpenModal: (id: string) => void;
}

const Footer: React.FC<FooterProps> = ({ onOpenModal }) => {
    const lenis = useLenis();
    const currentYear = new Date().getFullYear();

    const scrollToSection = (e: React.MouseEvent<HTMLElement>, id: string) => {
        e.preventDefault();
        const target = document.getElementById(id);
        if (!target) return;

        const top = target.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;
        if (lenis) {
            lenis.scrollTo(top, {
                duration: 1.1,
                immediate: false,
            });
            return;
        }

        window.scrollTo({ top, behavior: 'smooth' });
    };

    const scrollToTop = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        if (lenis) {
            lenis.scrollTo(0, {
                duration: 1.1,
                immediate: false,
            });
            return;
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    return (
        <footer className="landing-footer">
            <div className="footer-container">
                <div className="footer-grid">
                    <div className="footer-col brand-col">
                        <Link to="/" className="footer-logo">SERMUNO</Link>
                        <p className="footer-brand-text">
                            The inbox built for teams who need to get things done.
                        </p>
                        <div className="footer-copyright">&copy; {currentYear} Sermuno. All rights reserved.</div>
                    </div>

                    <div className="footer-col">
                        <div className="footer-col-title">Product</div>
                        <a href="#features" onClick={(e) => scrollToSection(e, 'features')} className="footer-link" style={{ cursor: 'pointer' }}>Features</a>
                        <a href="#integrations" onClick={(e) => scrollToSection(e, 'integrations')} className="footer-link" style={{ cursor: 'pointer' }}>Integrations</a>
                        <a href="#pricing" onClick={(e) => scrollToSection(e, 'pricing')} className="footer-link" style={{ cursor: 'pointer' }}>Pricing</a>
                    </div>

                    <div className="footer-col">
                        <div className="footer-col-title">Legal</div>
                        <button onClick={() => onOpenModal('privacy')} className="footer-link" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>Privacy Policy</button>
                        <button onClick={() => onOpenModal('terms')} className="footer-link" style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>Terms of Service</button>
                    </div>
                </div>
                <div className="footer-bottom">
                    <button
                        onClick={scrollToTop}
                        className="back-to-top"
                        aria-label="Back to top"
                    >
                        ↑ Back to top
                    </button>
                </div>
            </div>
            <div className="footer-wordmark" aria-hidden="true">SERMUNO</div>
        </footer>
    );
};

export default Footer;
