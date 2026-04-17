import { MessageSquare, Activity, Terminal } from 'lucide-react';

const UseCasesSection = () => {
    const useCases = [
        {
            title: 'Customer Support',
            body: "Route complex tickets, enforce strict SLAs, and stop stepping on each other's toes in messy shared inboxes.",
            Icon: MessageSquare
        },
        {
            title: 'Customer Success',
            body: 'Keep a pulse on account health and manage high-touch onboarding escalations alongside your support team.',
            Icon: Activity
        },
        {
            title: 'IT & Internal Ops',
            body: 'Manage internal employee requests, vendor communications, and system alerts in a unified, secure workspace.',
            Icon: Terminal
        },
    ];

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
                                <item.Icon className="w-6 h-6" />
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


