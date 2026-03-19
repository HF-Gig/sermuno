const fs = require('fs');
const path = require('path');

const firstNames = ['Alice', 'Bob', 'Charlie', 'David', 'Eva', 'Frank', 'Grace', 'Hannah', 'Ian', 'Julia', 'Kevin', 'Lily', 'Mason', 'Nina', 'Oliver', 'Piper', 'Quinn', 'Rachel', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xander', 'Yara', 'Zane'];
const lastNames = ['Smith', 'Jones', 'Brown', 'Lee', 'Green', 'White', 'Black', 'Clark', 'Davis', 'Evans', 'Ford', 'Garcia', 'Hill', 'Irwin', 'Jackson', 'King', 'Lopez', 'Moore', 'Nelson', 'Owen', 'Perez', 'Quinn', 'Reed', 'Scott', 'Taylor'];
const domains = ['acme.com', 'startup.co', 'bigcorp.com', 'freelance.dev', 'studio.art', 'services.net', 'marketing.io', 'tech.org', 'design.co', 'web.dev'];

const subjects = [
    'Login issues on mobile app', 'Feature request: Dark mode', 'Payment failed for subscription',
    'How to export data?', 'Account recovery assistance', 'SMTP configuration help',
    'Bulk email sending limits', 'Bug in reporting dashboard', 'Need help with API integration',
    'Billing discrepancy', 'Upgrade to Professional plan', 'Downgrade my account',
    'Where is the settings page?', 'Cannot upload avatar', 'App crashes on launch',
    'Missing data in export', 'Integration with Slack not working', 'Custom domains question',
    'How to setup SSO?', 'Requesting a demo'
];

const subjectToContent = {
    'Login issues on mobile app': {
        inbound: 'I cannot log in to the mobile app. It keeps saying "invalid credentials" even though I am sure they are correct. Running on iOS 17.',
        support: 'Could you please try resetting your password? Also, make sure you are on the latest version of the app (v2.4.1).',
        tags: ['mobile', 'bug']
    },
    'Feature request: Dark mode': {
        inbound: 'Would love to see a dark mode option! The white background is very bright at night.',
        support: 'Thanks for the suggestion! We have added this to our feature roadmap.',
        tags: ['feature-request']
    },
    'Payment failed for subscription': {
        inbound: 'My payment for the Professional plan failed this morning. Can you tell me why?',
        support: 'It looks like a temporary issue with our processor. I have cleared it; please try again.',
        tags: ['billing', 'urgent']
    },
    'SMTP configuration help': {
        inbound: 'I am struggling to set up my custom SMTP. I am using port 587 but it times out.',
        support: 'Please ensure that your firewall allows outbound connections on port 587 and that TLS is enabled.',
        tags: ['setup']
    },
    'How to export data?': {
        inbound: 'Is there a way to export my contacts to a CSV file?',
        support: 'Yes, navigate to Settings > Data Export and you will find the options there.',
        tags: ['account']
    }
};

const genericInbound = [
    "Hi, I have a question about my account settings.",
    "Could you help me with a weird error I'm seeing?",
    "Is there any update on my previous request?",
    "I'm interested in upgrading my plan, what are the options?",
    "The dashboard is loading very slowly for me today."
];

const genericSupport = [
    "Thanks for reaching out! I'm looking into this for you right now.",
    "Could you provide more details or a screenshot of the error?",
    "I've updated your account settings, it should work now.",
    "Sorry for the delay, we're experiencing high volume today.",
    "Is there anything else I can help you with today?"
];

const statuses = ['new', 'in_progress', 'waiting', 'done', 'snoozed', 'spam'];
const priorities = ['low', 'normal', 'high'];
const assignees = ['Noah Metz', 'Sarah Chen', 'James Wilson', null];
const possibleTags = ['bug', 'feature-request', 'billing', 'urgent', 'mobile', 'account', 'setup'];
const mailboxes = ['1', '2', '3'];

function getRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomTags() {
    const numTags = Math.floor(Math.random() * 3);
    const tags = new Set();
    for (let i = 0; i < numTags; i++) {
        tags.add(getRandomItem(possibleTags));
    }
    return Array.from(tags);
}

const tickets = [];
const allMessages = [];
let msgIdCounter = 100;

function generateMessages(threadId, ticket) {
    const threadMessages = [];
    const subject = ticket.subject;
    const from = ticket.from;
    const status = ticket.status;
    const mailboxEmail = ticket.mailboxId === '3' ? 'billing@unidesk.io' : (ticket.mailboxId === '2' ? 'sales@unidesk.io' : 'support@unidesk.io');

    const contentPref = subjectToContent[subject] || { inbound: getRandomItem(genericInbound), support: getRandomItem(genericSupport) };

    const startTime = new Date(ticket.updatedAt);
    startTime.setHours(startTime.getHours() - 24); // Start 24h before updatedAt

    const addMsg = (role, body, offsetHours) => {
        const msgTime = new Date(startTime);
        msgTime.setHours(msgTime.getHours() + offsetHours);
        const msg = {
            id: `m${msgIdCounter++}`,
            threadId: threadId,
            fromEmail: role === 'customer' ? from : mailboxEmail,
            toEmail: [role === 'customer' ? mailboxEmail : from],
            subject: (role === 'support' ? 'Re: ' : '') + subject,
            bodyHtml: `<p>${body}</p>`,
            bodyText: body,
            direction: role === 'customer' ? 'INBOUND' : 'OUTBOUND',
            createdAt: msgTime.toISOString(),
            attachments: []
        };
        threadMessages.push(msg);
    };

    // First inbound message (always exists)
    addMsg('customer', contentPref.inbound, 0);

    let count = 1;
    if (status === 'new') {
        // Just the 1 message
    } else if (status === 'in_progress') {
        addMsg('support', contentPref.support, 2);
        count = 2;
    } else if (status === 'waiting') {
        addMsg('support', "I've sent you the steps, let me know if they work.", 2);
        count = 2;
    } else if (status === 'done') {
        addMsg('support', "I've resolved the issue for you. Have a great day!", 4);
        addMsg('customer', "Thanks! It works now.", 6);
        count = 3;
    } else if (status === 'snoozed') {
        addMsg('support', `I will follow up with you ${ticket.snoozeUntil || 'later'}.`, 2);
        count = 2;
    } else {
        // Spam etc.
    }

    // Add some random longer threads (6-10 messages) if we want
    if (Math.random() > 0.9 && status !== 'new') {
        for (let i = count; i < 6 + Math.floor(Math.random() * 5); i++) {
            const role = i % 2 === 0 ? 'customer' : 'support';
            const body = role === 'customer' ? "I still have one more question." : "Sure, what is it?";
            addMsg(role, body, i * 2);
        }
    }

    return threadMessages;
}

// Generate the 120 tickets
for (let i = 1; i <= 120; i++) {
    const fn = getRandomItem(firstNames);
    const ln = getRandomItem(lastNames);
    const domain = getRandomItem(domains);
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}@${domain}`;

    const status = getRandomItem(statuses);
    let snoozeUntil = undefined;
    if (status === 'snoozed') {
        snoozeUntil = getRandomItem(['later today', 'tomorrow', 'next week']);
    }

    const date = new Date(Date.parse('2026-02-21T12:00:00Z') - Math.random() * 7 * 24 * 60 * 60 * 1000);

    const ticket = {
        id: `t${i}`,
        subject: getRandomItem(subjects),
        status: status,
        priority: getRandomItem(priorities),
        from: email,
        snippet: 'Here is a mock snippet for the email to show in the list...',
        assignedTo: getRandomItem(assignees),
        tags: getRandomTags(),
        updatedAt: date.toISOString(),
        unreadCount: Math.random() > 0.7 ? Math.floor(Math.random() * 5) + 1 : 0,
        mailboxId: getRandomItem(mailboxes),
        snoozeUntil: snoozeUntil
    };

    // Set snippet to the first inbound message content later when generated
    const msgs = generateMessages(ticket.id, ticket);
    ticket.snippet = msgs[0].bodyText.substring(0, 100) + '...';

    tickets.push(ticket);
    allMessages.push(...msgs);
}

const dataPath = path.join(__dirname, '../src/mockData/data.ts');
let content = fs.readFileSync(dataPath, 'utf-8');

// Update SEED_THREADS
const threadRegex = /export const SEED_THREADS: MockThread\[\] = \[([\s\S]*?)\];/;
const threadReplacement = `export const SEED_THREADS: MockThread[] = [\n    ${tickets.map(t => JSON.stringify(t)).join(',\n    ')}\n];`;
content = content.replace(threadRegex, threadReplacement);

// Update SEED_MESSAGES
const msgRegex = /export const SEED_MESSAGES = \[([\s\S]*?)\];/;
const msgReplacement = `export const SEED_MESSAGES = [\n    ${allMessages.map(m => JSON.stringify(m)).join(',\n    ')}\n];`;
content = content.replace(msgRegex, msgReplacement);

fs.writeFileSync(dataPath, content);

console.log(`Successfully generated 120 mock tickets and ${allMessages.length} messages in data.ts`);
