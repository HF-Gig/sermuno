import React, { useEffect } from 'react';

interface ModalsProps {
    activeModal: string | null;
    onClose: () => void;
}

const Modals: React.FC<ModalsProps> = ({ activeModal, onClose }) => {
    // Lock body scroll when open
    useEffect(() => {
        if (activeModal) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }

        return () => {
            document.body.style.overflow = '';
        };
    }, [activeModal]);

    // Close on escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    if (!activeModal) return null;

    const modalData: Record<string, { title: string, content: React.ReactNode }> = {
        'privacy': {
            title: 'Privacy Policy',
            content: (
                <div style={{ lineHeight: '1.8', color: 'var(--c-sage)' }}>
                    <p style={{ fontSize: '13px', color: 'rgba(142,182,155,0.6)', marginBottom: '16px' }}>Effective: February 1, 2026 &nbsp;·&nbsp; Last updated: February 28, 2026</p>
                    <p>Sermuno ("we", "us", or "our") operates a shared team inbox platform. This Privacy Policy explains what personal data we collect, why we collect it, and how we protect it. We do not sell your data — full stop.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>1. Information We Collect</h3>
                    <p><strong>Account information:</strong> When you create an account we collect your name, work email address, company name, and a hashed password.</p>
                    <p style={{ marginTop: '10px' }}><strong>Usage data:</strong> We automatically log feature interactions, page views, session duration, IP address, browser type, and device identifiers to understand how the product is used and to maintain performance.</p>
                    <p style={{ marginTop: '10px' }}><strong>Email integration metadata:</strong> When you connect a mailbox (Gmail, Outlook, IMAP), we store OAuth tokens, sender/recipient addresses, subject lines, and message bodies strictly to provide the service. We do not read your emails for advertising.</p>
                    <p style={{ marginTop: '10px' }}><strong>Cookies &amp; analytics:</strong> We use first-party cookies for authentication sessions and optional third-party analytics (e.g. aggregated, anonymized usage patterns). You can disable non-essential cookies in your account settings at any time.</p>
                    <p style={{ marginTop: '10px' }}><strong>Billing information:</strong> Payment card details are handled entirely by Stripe, Inc. We store only a tokenised reference and the last four digits of your card.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>2. How We Use Your Data</h3>
                    <p>We use your data to: deliver and improve the Sermuno service; authenticate users and enforce access controls; enforce SLA timers and routing rules you configure; send transactional emails (password resets, invoices, security alerts); detect and prevent abuse; and comply with legal obligations. We do not use your email content to train machine-learning models.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>3. How We Share Your Data</h3>
                    <p>We share data only with vetted sub-processors that help us operate: <strong>AWS</strong> (cloud infrastructure), <strong>Stripe</strong> (billing), <strong>Postmark</strong> (transactional email). All sub-processors are contractually bound to treat your data with the same level of protection we apply. We will disclose data to law enforcement only if compelled by a valid legal order, and we will notify you where legally permitted.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>4. Security</h3>
                    <p>All data is encrypted in transit (TLS 1.2+) and at rest (AES-256). Access to production systems is limited to authorized engineers via hardware-MFA-protected VPN. We perform continuous automated vulnerability scanning and annual third-party penetration testing.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>5. Data Retention</h3>
                    <p>We retain your account data for as long as your subscription is active. After account deletion, we purge personal data within 30 days, except where we must retain records for legal or tax purposes (up to 7 years for billing records).</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>6. Your Rights</h3>
                    <p>You may request access, correction, export, or deletion of your personal data at any time via your account settings. EU/EEA users may exercise GDPR rights (including the right to object to processing) by emailing <strong>privacy@sermuno.com</strong>. We aim to respond within 30 days.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>7. Contact</h3>
                    <p>Questions about this policy? Email <strong>privacy@sermuno.com</strong>. For general enquiries: <strong>hello@sermuno.com</strong>.</p>
                </div>
            )
        },
        'terms': {
            title: 'Terms of Service',
            content: (
                <div style={{ lineHeight: '1.8', color: 'var(--c-sage)' }}>
                    <p style={{ fontSize: '13px', color: 'rgba(142,182,155,0.6)', marginBottom: '16px' }}>Effective: February 1, 2026 &nbsp;·&nbsp; Last updated: February 28, 2026</p>
                    <p>These Terms of Service ("Terms") form a binding agreement between you (and your organisation) and Sermuno Inc. ("Sermuno"). By creating an account or using the Sermuno platform you confirm you have read, understood, and agreed to these Terms.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>1. The Service</h3>
                    <p>Sermuno provides a collaborative shared inbox platform for teams. We grant you a non-exclusive, non-transferable licence to use the platform in accordance with your chosen subscription plan. We may update, improve, or deprecate features at any time — we will provide reasonable advance notice for material removals.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>2. Accounts</h3>
                    <p>You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. You must notify us immediately at <strong>security@sermuno.com</strong> if you suspect unauthorised access. Each seat is for one named user — sharing login credentials between multiple people is not permitted.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>3. Acceptable Use</h3>
                    <p>You agree not to: (a) send unsolicited bulk email or spam via connected mailboxes; (b) store or transmit content that is illegal, defamatory, or violates third-party intellectual property rights; (c) attempt to gain unauthorised access to other tenants' data or Sermuno's infrastructure; (d) resell or sublicense access to the platform; or (e) use the service in a way that knowingly degrades performance for other customers.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>4. Billing &amp; Free Plan</h3>
                    <p>Paid subscriptions are billed monthly or annually in advance and are non-refundable. The free plan is provided with limited seats and features as described on the pricing page. We reserve the right to change pricing with 30 days' notice to existing subscribers. Failure to pay will result in read-only access until the balance is settled; accounts unpaid for more than 60 days may be suspended.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>5. Intellectual Property</h3>
                    <p>You retain full ownership of all data you and your team import into Sermuno ("Customer Data"). You grant us a limited licence to process Customer Data solely to provide and improve the service. Sermuno retains all intellectual property rights in the platform, including its design, software, and documentation.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>6. Limitation of Liability</h3>
                    <p>To the maximum extent permitted by law, Sermuno's total liability for any claim arising under these Terms shall not exceed the fees you paid in the three months preceding the claim. We are not liable for indirect, incidental, or consequential damages, including loss of data or revenue.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>7. Termination</h3>
                    <p>You may cancel your account at any time from your billing settings. We may suspend or terminate your access with immediate effect for material breach of these Terms, non-payment, or activity that poses a security risk. Upon termination, personal data will be deleted in accordance with our Privacy Policy.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>8. Changes to These Terms</h3>
                    <p>We may update these Terms periodically. We will notify you of material changes via email or an in-app notice at least 14 days before they take effect. Continued use of the service after that date constitutes acceptance of the revised Terms.</p>

                    <h3 style={{ color: 'var(--c-mint)', marginTop: '28px', marginBottom: '10px' }}>9. Contact</h3>
                    <p>Questions about these Terms? Email <strong>legal@sermuno.com</strong>. For general enquiries: <strong>hello@sermuno.com</strong>.</p>
                </div>
            )
        },
    };

    const data = modalData[activeModal];
    if (!data) return null;

    return (
        <div className={`modal-overlay ${activeModal ? 'open' : ''}`} onClick={onClose}>
            <div className="modal-container" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">{data.title}</h2>
                    <button className="modal-close" onClick={onClose} aria-label="Close modal">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div className="modal-body">
                    {data.content}
                </div>
            </div>
        </div>
    );
};

export default Modals;
