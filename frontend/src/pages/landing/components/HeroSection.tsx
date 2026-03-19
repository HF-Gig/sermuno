import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import SpiralBackground from './SpiralBackground';

const HeroSection = () => {
    const [isVideoOpen, setIsVideoOpen] = useState(false);

    return (
        <section className="hero-section" id="hero">
            <div className="hero-glow" data-parallax="0.15" />

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-30 [mask-image:radial-gradient(circle_at_center,white,transparent_80%)]" style={{ zIndex: 0, top: '-15%' }}>
                <SpiralBackground size={1200} points={1200} dotRadius={1.2} opacityMax={0.4} />
            </div>

            <div className="hero-shell">
                <div className="hero-content">
                    <p className="hero-eyebrow">Customer Support Platform</p>

                    <h1 className="hero-headline">
                        <span className="line-1">Support that moves</span>
                        <span className="line-2">at enterprise speed</span>
                    </h1>

                    <p className="hero-sub">
                        Sermuno unifies support, sales, and operations in one workspace so your team resolves faster,
                        stays aligned, and scales without chaos.
                    </p>

                    <div className="hero-actions">
                        <div className="hero-btns">
                            <Link to="/signup" className="btn-primary">
                                Start free
                            </Link>
                            <button type="button" onClick={() => setIsVideoOpen(true)} className="btn-ghost">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                                Watch demo
                            </button>
                        </div>
                        <div className="hero-trust">No credit card required - Setup in minutes</div>
                    </div>
                </div>

                <div className="hero-dashboard-wrap" aria-hidden="true">
                    <article className="hero-glass-card glass-ticket">
                        <p className="glass-label">Priority Ticket</p>
                        <h3 className="glass-title">Billing API timeout on enterprise workspace</h3>
                        <p className="glass-sub">Owner: Support Ops - Last update 2m ago</p>
                        <div className="glass-row">
                            <span className="glass-badge">SLA 12m</span>
                            <span className="glass-badge">P1</span>
                        </div>
                    </article>

                    <article className="hero-glass-card glass-metric">
                        <p className="glass-label">First Response</p>
                        <p className="glass-kpi">2m 18s</p>
                        <p className="glass-trend">+19% faster this week</p>
                    </article>

                    <article className="hero-glass-card glass-profile">
                        <div className="glass-profile-row">
                            <span className="glass-avatar">AM</span>
                            <div>
                                <p className="glass-name">Aisha Malik</p>
                                <p className="glass-role">Support Lead</p>
                            </div>
                        </div>
                        <div className="glass-divider" />
                        <div className="glass-list">
                            <p>Queue load: 14 active</p>
                            <p>CSAT trend: 98.2%</p>
                            <p>Escalations: 1 open</p>
                        </div>
                    </article>
                </div>
            </div>

            {isVideoOpen && (
                <div className="video-modal-overlay" onClick={() => setIsVideoOpen(false)}>
                    <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="video-modal-close" onClick={() => setIsVideoOpen(false)} aria-label="Close video">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                        <video className="video-player" src="/demo.mp4" controls autoPlay playsInline />
                    </div>
                </div>
            )}
        </section>
    );
};

export default HeroSection;
