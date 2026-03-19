import React from 'react';

const ProblemSection = () => {
    return (
        <section className="problem-section" id="problem">
            <div className="problem-glow" aria-hidden="true" />
            <div className="problem-container">
                <p className="problem-eyebrow" data-reveal>
                    The Problem
                </p>
                <h2 className="problem-h2" data-reveal data-delay="1">
                    Shared inboxes create hidden bottlenecks.
                </h2>
                <p className="problem-description" data-reveal data-delay="2">
                    Without clear ownership and system-level visibility, teams duplicate responses, miss SLA targets,
                    and lose context across channels.
                </p>
            </div>
        </section>
    );
};

export default ProblemSection;
