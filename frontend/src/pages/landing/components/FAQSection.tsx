import React, { useMemo, useState } from 'react';

type FAQItem = {
    category: 'General' | 'Pricing' | 'Integrations' | 'Security';
    question: string;
    answer: string;
};

const categories: FAQItem['category'][] = ['General', 'Pricing', 'Integrations', 'Security'];

const faqItems: FAQItem[] = [
    {
        category: 'General',
        question: 'What is Sermuno built for?',
        answer: 'Sermuno helps support and operations teams manage shared inboxes with clear ownership, SLA visibility, and team collaboration in one workflow.',
    },
    {
        category: 'General',
        question: 'Can multiple teams work in the same workspace?',
        answer: 'Yes. You can organize inboxes by function, assign role-based access, and keep internal context shared across support, success, and ops.',
    },
    {
        category: 'General',
        question: 'How quickly can we get started?',
        answer: 'Most teams can connect their first inbox and configure routing in under an hour, then iterate workflows as volume grows.',
    },
    {
        category: 'General',
        question: 'Is Sermuno suitable for small teams too?',
        answer: 'Yes. Starter workflows are intentionally lightweight, so smaller teams get structure without enterprise-level complexity.',
    },
    {
        category: 'Pricing',
        question: 'Do you charge by mailbox or by user?',
        answer: 'Pricing is user-based so teams can scale across inboxes without hidden per-mailbox limits.',
    },
    {
        category: 'Pricing',
        question: 'Can we upgrade or downgrade later?',
        answer: 'Absolutely. You can switch plans as your team changes, and billing updates automatically on your next cycle.',
    },
    {
        category: 'Pricing',
        question: 'Do you offer annual pricing options?',
        answer: 'Yes. Annual plans are available for teams that want predictable budgeting and long-term rollout support.',
    },
    {
        category: 'Pricing',
        question: 'Is there a trial for Professional features?',
        answer: 'We offer guided trials for advanced capabilities so teams can validate SLA, automation, and reporting fit before committing.',
    },
    {
        category: 'Integrations',
        question: 'Which email providers are supported?',
        answer: 'Sermuno supports Google Workspace, Microsoft 365, SMTP/IMAP mailboxes, and webhook-based workflows.',
    },
    {
        category: 'Integrations',
        question: 'Can we connect Sermuno to internal automation?',
        answer: 'Yes. Webhooks let you trigger downstream actions and keep internal tools synchronized with ticket and thread events.',
    },
    {
        category: 'Integrations',
        question: 'Can we sync with our CRM records?',
        answer: 'Integration workflows can enrich threads with account context so agents have customer history while replying.',
    },
    {
        category: 'Integrations',
        question: 'Do integrations support bi-directional updates?',
        answer: 'Depending on the workflow, you can push status changes out and receive external updates back into Sermuno in real time.',
    },
    {
        category: 'Security',
        question: 'How is customer data protected?',
        answer: 'Data is encrypted in transit and at rest, with controlled access policies and audit-ready operational guardrails.',
    },
    {
        category: 'Security',
        question: 'Do you support enterprise compliance requirements?',
        answer: 'Enterprise plans include stronger governance controls and implementation support for security and compliance workflows.',
    },
    {
        category: 'Security',
        question: 'Can we enforce role-based access controls?',
        answer: 'Yes. Admins can define scoped permissions so users only access inboxes and actions relevant to their responsibilities.',
    },
    {
        category: 'Security',
        question: 'Are audit logs available?',
        answer: 'Activity and operational history are available to help security teams review access, assignment, and workflow events.',
    },
];

const FAQSection = () => {
    const [activeCategory, setActiveCategory] = useState<FAQItem['category']>('General');
    const [openIndex, setOpenIndex] = useState<number | null>(null);

    const filteredItems = useMemo(
        () => faqItems.filter(item => item.category === activeCategory),
        [activeCategory]
    );

    return (
        <section className="faq-section" id="faq">
            <div className="faq-container">
                <div className="faq-header">
                    <p className="faq-eyebrow" data-reveal>
                        Let&apos;s answer some questions
                    </p>
                    <h2 className="faq-h2" data-reveal data-delay="1">
                        Frequently Asked Questions
                    </h2>
                </div>

                <div className="faq-tabs" data-reveal data-delay="2">
                    {categories.map(category => (
                        <button
                            key={category}
                            type="button"
                            className={`faq-tab ${activeCategory === category ? 'active' : ''}`}
                            onClick={() => {
                                setActiveCategory(category);
                                setOpenIndex(null);
                            }}
                        >
                            {category}
                        </button>
                    ))}
                </div>

                <div className="faq-list">
                    {filteredItems.map((faq, idx) => {
                        const isOpen = openIndex === idx;
                        return (
                            <div
                                key={`${activeCategory}-${faq.question}`}
                                className={`faq-item-card ${isOpen ? 'is-open' : ''}`}
                            >
                                <button
                                    type="button"
                                    className="faq-trigger"
                                    onClick={() => setOpenIndex(isOpen ? null : idx)}
                                    aria-expanded={isOpen}
                                >
                                    <span>{faq.question}</span>
                                    <span className="faq-icon">+</span>
                                </button>

                                <div className="faq-content-wrapper">
                                    <div className="faq-content">
                                        <p>{faq.answer}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

export default FAQSection;
