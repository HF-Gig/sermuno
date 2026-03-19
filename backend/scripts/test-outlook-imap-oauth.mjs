import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';

const mailboxId = process.argv[2];
if (!mailboxId) {
  console.error('Usage: node scripts/test-outlook-imap-oauth.mjs <mailbox-id>');
  process.exit(1);
}

const envPath = path.resolve(process.cwd(), '.env');
const envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const envMap = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1)];
    }),
);

const encryptionKey = process.env.ENCRYPTION_KEY || envMap.ENCRYPTION_KEY || '';
if (!encryptionKey) {
  console.error('Missing ENCRYPTION_KEY');
  process.exit(1);
}

const prisma = new PrismaClient();

const decrypt = (ciphertext, keyBuffer) => {
  const [ivHex, tagHex, dataHex] = String(ciphertext || '').split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
};

try {
  const mailbox = await prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: {
      email: true,
      imapUser: true,
      oauthAccessToken: true,
    },
  });

  if (!mailbox?.oauthAccessToken) {
    console.error('Mailbox/token not found');
    process.exit(1);
  }

  let accessToken = '';
  try {
    accessToken = decrypt(mailbox.oauthAccessToken, Buffer.from(crypto.createHash('sha256').update(encryptionKey).digest()));
  } catch {
    accessToken = decrypt(mailbox.oauthAccessToken, Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32), 'utf8'));
  }

  const user = mailbox.imapUser || mailbox.email;
  const tokenParts = accessToken.split('.');
  if (tokenParts.length >= 2) {
    try {
      const claims = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString('utf8'));
      console.log('token claims', {
        aud: claims.aud,
        scp: claims.scp,
        preferred_username: claims.preferred_username,
        upn: claims.upn,
        iss: claims.iss,
        tid: claims.tid,
      });
    } catch {
      console.log('token claims: unable to decode JWT payload');
    }
  } else {
    console.log('token format: opaque/non-jwt');
  }

  const hosts = ['outlook.office365.com', 'imap-mail.outlook.com'];
  const authVariants = [
    { label: 'accessToken-default', auth: { user, accessToken } },
    { label: 'accessToken-xoauth2', auth: { user, accessToken, method: 'XOAUTH2' } },
  ];

  for (const host of hosts) {
    for (const variant of authVariants) {
      const client = new ImapFlow({
        host,
        port: 993,
        secure: true,
        auth: variant.auth,
        logger: false,
      });

      try {
        await client.connect();
        console.log(`${host} (${variant.label}): OK`);
      } catch (err) {
        const e = err || {};
        console.log(`${host} (${variant.label}): FAIL`, {
          message: e?.message,
          code: e?.code,
          response: e?.response,
          responseText: e?.responseText,
        });
      } finally {
        await client.logout().catch(() => undefined);
      }
    }
  }

  const smtpHosts = ['smtp.office365.com', 'smtp-mail.outlook.com'];
  for (const host of smtpHosts) {
    const transporter = nodemailer.createTransport({
      host,
      port: 587,
      secure: false,
      auth: {
        type: 'OAuth2',
        user,
        accessToken,
      },
      tls: { minVersion: 'TLSv1.2' },
    });

    try {
      await transporter.verify();
      console.log(`${host} (smtp oauth2): OK`);
    } catch (err) {
      const e = err || {};
      console.log(`${host} (smtp oauth2): FAIL`, {
        message: e?.message,
        code: e?.code,
        response: e?.response,
        responseCode: e?.responseCode,
      });
    }
  }

  const restEndpoints = [
    'https://outlook.office.com/api/v2.0/me',
    'https://outlook.office.com/api/v2.0/me/mailfolders?$top=5',
    'https://outlook.office.com/api/v2.0/me/messages?$top=5',
    'https://outlook.office.com/api/v2.0/me/messages?$top=5&$select=Id,Subject,DateTimeReceived,From',
    'https://outlook.office.com/api/v2.0/me/MailFolders/Inbox/messages?$top=5',
    'https://graph.microsoft.com/v1.0/me',
    'https://graph.microsoft.com/v1.0/me/mailFolders?$top=5',
  ];

  for (const endpoint of restEndpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const text = await res.text();
      console.log(`API ${endpoint}:`, res.status, text.slice(0, 220));
    } catch (err) {
      console.log(`API ${endpoint}: FAIL`, String(err));
    }
  }
} finally {
  await prisma.$disconnect();
}
