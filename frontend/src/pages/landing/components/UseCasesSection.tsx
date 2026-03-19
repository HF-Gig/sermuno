import React from 'react';

const useCases = [
    {
        title: 'Customer Support',
        body: "Route complex tickets, enforce strict SLAs, and stop stepping on each other's toes in messy shared inboxes.",
        icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
    },
    {
        title: 'Customer Success',
        body: 'Keep a pulse on account health and manage high-touch onboarding escalations alongside your support team.',
        icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
    },
    {
        title: 'IT & Internal Ops',
        body: 'Manage internal employee requests, vendor communications, and system alerts in a unified, secure workspace.',
        icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
    },
];

const UseCasesSection = () => {
    return (
        <section className="usecases-section" id="usecases">
            <div className="usecases-container">
                <div className="usecases-header-wrap">
                    <p className="usecases-eyebrow" data-reveal>
                        BUILT FOR SCALE
                    </p>
                    <h2 className="usecases-h2" data-reveal data-delay="1">
                        Designed for modern operations teams
                    </h2>
                    <p className="usecases-subtext" data-reveal data-delay="2">
                        Whether you are answering tickets or fixing bugs, Sermuno brings context to the chaos.
                    </p>
                </div>

                <div className="usecases-grid">
                    {useCases.map((item, idx) => (
                        <article key={idx} className="usecase-card" data-reveal data-delay={Math.min(idx + 1, 3).toString()}>
                            <div className="usecase-icon-wrapper">
                                {item.icon}
                            </div>
                            <h3 className="usecase-title">{item.title}</h3>
                            <p className="usecase-body">{item.body}</p>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default UseCasesSection;
