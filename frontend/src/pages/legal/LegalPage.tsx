import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ReactLenis } from 'lenis/react';
import '../landing/styles.css';
import { Navigation, Footer } from '../landing/components';

const sectionTitleStyle: React.CSSProperties = {
    color: 'var(--c-mint)',
    marginTop: '24px',
    marginBottom: '8px',
    fontSize: '24px',
    fontWeight: 700,
};

const pageSectionStyle: React.CSSProperties = {
    padding: '140px 24px 80px',
};

const cardStyle: React.CSSProperties = {
    maxWidth: '980px',
    margin: '0 auto',
    borderRadius: '20px',
    border: '1px solid rgba(142, 182, 155, 0.2)',
    background: 'rgba(4, 30, 29, 0.92)',
    boxShadow: '0 30px 80px rgba(0, 0, 0, 0.45)',
    padding: '38px 34px 44px',
    color: 'var(--c-sage)',
    lineHeight: 1.8,
};

const metaStyle: React.CSSProperties = {
    fontSize: '13px',
    color: 'rgba(142,182,155,0.66)',
    marginBottom: '16px',
};

const titleStyle: React.CSSProperties = {
    fontSize: '44px',
    lineHeight: 1.15,
    fontWeight: 700,
    marginBottom: '12px',
    color: 'var(--c-mint)',
};

const backLinkStyle: React.CSSProperties = {
    color: 'var(--c-mint)',
    textDecoration: 'underline',
    textUnderlineOffset: '4px',
    fontSize: '14px',
};

const PrivacyContent = () => (
    <>
        <p style={metaStyle}>Last updated: April 2026</p>
        <p>
            Sermuno BV (KvK: 99985853), Kampenringweg 17, 2803 PE Gouda, The Netherlands,
            operates the platform at <strong>sermuno.ai</strong>. This policy explains how we collect,
            use, store, and protect personal data in line with GDPR and applicable Dutch privacy law.
        </p>

        <h2 style={sectionTitleStyle}>1. Data Controller</h2>
        <p>
            <strong>Sermuno BV</strong><br />
            KvK: 99985853<br />
            Kampenringweg 17, 2803 PE Gouda, The Netherlands<br />
            Email: <strong>info@sermuno.ai</strong>
        </p>

        <h2 style={sectionTitleStyle}>2. Data We Collect</h2>
        <p><strong>Account data:</strong> name, email, hashed password, optional profile data, language/timezone.</p>
        <p><strong>Communication data:</strong> email, WhatsApp, calendar events, notes, and ticket/task content processed through the platform.</p>
        <p><strong>CRM data:</strong> customer contacts, company details, communication history, tags, notes, and custom fields.</p>
        <p><strong>Technical data:</strong> IP address, browser/device details, usage events, logs, and crash diagnostics.</p>
        <p><strong>Billing data:</strong> subscription and invoicing data; payment card handling is performed by Stripe.</p>
        <p><strong>Files:</strong> uploads and attachments stored in Cloudflare R2 (EU region).</p>

        <h2 style={sectionTitleStyle}>3. Legal Basis (GDPR)</h2>
        <p>
            We process data under Art. 6(1)(b) contract performance, Art. 6(1)(f) legitimate interest,
            Art. 6(1)(c) legal obligation, and Art. 6(1)(a) consent where applicable.
        </p>

        <h2 style={sectionTitleStyle}>4. How We Use Data</h2>
        <p>
            To provide and secure the service, authenticate users, process payments, synchronize email/calendar,
            provide support, prevent abuse/fraud, and meet legal obligations.
        </p>

        <h2 style={sectionTitleStyle}>5. Third-Party Processors</h2>
        <p>We do not sell personal data. We share data only with trusted processors:</p>
        <ul>
            <li>Neon.tech (EU database hosting, Frankfurt)</li>
            <li>Cloudflare R2 (EU file storage)</li>
            <li>Resend.com (transactional email delivery)</li>
            <li>Stripe (payment processing)</li>
            <li>Google (OAuth and Gmail/Calendar integration)</li>
            <li>Microsoft (OAuth and Outlook integration)</li>
            <li>Zoom (meeting integration)</li>
        </ul>

        <h2 style={sectionTitleStyle}>6. Retention</h2>
        <p>Account data: subscription period + 2 years after cancellation.</p>
        <p>Communication data: subscription period.</p>
        <p>Payment records: 7 years (Dutch legal requirement).</p>
        <p>Backups: 30 days.</p>

        <h2 style={sectionTitleStyle}>7. Security</h2>
        <p>
            Data is encrypted in transit and at rest. Passwords are hashed with bcrypt.
            Token expiries and rate limiting are enforced, with regular security reviews.
        </p>

        <h2 style={sectionTitleStyle}>8. International Transfers</h2>
        <p>
            Data is primarily processed in the EU. If transferred outside the EU,
            appropriate safeguards (including SCCs) are applied.
        </p>

        <h2 style={sectionTitleStyle}>9. Your Rights</h2>
        <p>
            You can request access, rectification, erasure, restriction, portability,
            objection, and withdrawal of consent by emailing <strong>info@sermuno.ai</strong>.
            We respond within 30 days.
        </p>
        <p>
            You may also lodge a complaint with the Dutch Data Protection Authority
            at <strong>autoriteitpersoonsgegevens.nl</strong>.
        </p>

        <h2 style={sectionTitleStyle}>10. Cookies</h2>
        <p>
            We use essential cookies for authentication and security. We do not use
            tracking or advertising cookies.
        </p>

        <h2 style={sectionTitleStyle}>11. Children</h2>
        <p>
            Sermuno is not intended for users under 16. If you believe child data was submitted,
            contact <strong>info@sermuno.ai</strong>.
        </p>

        <h2 style={sectionTitleStyle}>12. Policy Changes</h2>
        <p>
            We may update this policy and will notify users of material changes by email
            or prominent in-app notice.
        </p>

        <h2 style={sectionTitleStyle}>13. Contact</h2>
        <p>
            Email: <strong>info@sermuno.ai</strong><br />
            Address: <strong>Sermuno BV, Kampenringweg 17, 2803 PE Gouda, The Netherlands</strong>
        </p>
    </>
);

const TermsContent = () => (
    <>
        <p style={metaStyle}>Last updated: April 2026</p>
        <p>
            These Terms form a legally binding agreement between you (or your organization)
            and Sermuno BV (KvK: 99985853), Kampenringweg 17, 2803 PE Gouda, The Netherlands.
            By using Sermuno, you accept these Terms.
        </p>

        <h2 style={sectionTitleStyle}>1. Service</h2>
        <p>
            Sermuno is a multi-tenant SaaS platform for ticket/task management, CRM,
            email integration, WhatsApp, calendar scheduling, automation workflows,
            and AI-assisted features. Feature availability depends on plan.
        </p>

        <h2 style={sectionTitleStyle}>2. Plans and Billing</h2>
        <p><strong>Starter:</strong> EUR 24.99/month</p>
        <p><strong>Pro:</strong> EUR 29.99/month</p>
        <p>Prices exclude VAT. VAT is applied based on location.</p>
        <p>
            Subscriptions are billed monthly in advance via Stripe. Payments are non-refundable
            unless required by law.
        </p>
        <p>
            Free trials may be offered. At trial end, subscriptions convert to paid unless cancelled.
        </p>
        <p>
            Cancellation is available from account settings and takes effect at the end of
            the current billing period.
        </p>

        <h2 style={sectionTitleStyle}>3. Acceptable Use</h2>
        <p>You agree not to use Sermuno to:</p>
        <ul>
            <li>Violate applicable law or regulation</li>
            <li>Send spam or unsolicited commercial messages</li>
            <li>Transmit malware or harmful code</li>
            <li>Attempt unauthorized access to systems/accounts</li>
            <li>Scrape/harvest platform data without permission</li>
            <li>Impersonate people/entities</li>
            <li>Disrupt platform operations</li>
        </ul>

        <h2 style={sectionTitleStyle}>4. Data and Intellectual Property</h2>
        <p>
            You retain ownership of your uploaded/created content. You grant Sermuno a limited
            license to process/store it to provide the service.
        </p>
        <p>
            All Sermuno platform IP (software, design, logos, docs) remains Sermuno BV property.
        </p>

        <h2 style={sectionTitleStyle}>5. Third-Party Integrations</h2>
        <p>
            Integrations with Google, Microsoft, Stripe, Zoom, and others are subject to
            those providers' terms/policies. Sermuno is not responsible for third-party actions.
        </p>

        <h2 style={sectionTitleStyle}>6. Availability</h2>
        <p>
            We target 99.9% uptime but cannot guarantee uninterrupted service.
            Maintenance/updates may temporarily affect availability.
        </p>

        <h2 style={sectionTitleStyle}>7. Limitation of Liability</h2>
        <p>
            To the extent permitted by law, total liability is capped at fees paid in the
            12 months before the claim. Sermuno is not liable for indirect/consequential damages,
            backup-related data loss, or third-party integration actions.
        </p>

        <h2 style={sectionTitleStyle}>8. Indemnification</h2>
        <p>
            You agree to indemnify Sermuno BV and its employees, contractors, and directors
            against claims/damages/expenses arising from your use of the platform or breach of Terms.
        </p>

        <h2 style={sectionTitleStyle}>9. Termination</h2>
        <p>You may terminate your account at any time.</p>
        <p>Sermuno may suspend/terminate for Terms violations.</p>
        <p>After termination, access ends immediately.</p>
        <p>Data is retained for 90 days after termination, then permanently deleted.</p>
        <p>You may request data export before termination.</p>

        <h2 style={sectionTitleStyle}>10. Governing Law and Disputes</h2>
        <p>
            These Terms are governed by Dutch law. Disputes fall under the competent courts
            in the Netherlands. Mandatory EU consumer protections remain applicable where required.
        </p>

        <h2 style={sectionTitleStyle}>11. Changes to Terms</h2>
        <p>
            We may modify these Terms and will notify users of material changes by email
            at least 30 days before effectiveness.
        </p>

        <h2 style={sectionTitleStyle}>12. Contact</h2>
        <p>
            Email: <strong>info@sermuno.ai</strong><br />
            Address: <strong>Sermuno BV, Kampenringweg 17, 2803 PE Gouda, The Netherlands</strong>
        </p>
    </>
);

export default function LegalPage() {
    const { pathname } = useLocation();
    const isPrivacy = pathname === '/privacy-policy' || pathname === '/privacy';
    const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';

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
                <section style={pageSectionStyle}>
                    <div style={cardStyle}>
                        <div style={{ marginBottom: '18px' }}>
                            <Link to="/" style={backLinkStyle}>← Back to home</Link>
                        </div>
                        <h1 style={titleStyle}>{title}</h1>
                        {isPrivacy ? <PrivacyContent /> : <TermsContent />}
                    </div>
                </section>
                <Footer />
            </div>
        </ReactLenis>
    );
}
