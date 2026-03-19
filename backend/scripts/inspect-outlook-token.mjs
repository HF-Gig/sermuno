import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const mailboxId = process.argv[2];
if (!mailboxId) {
  console.error('Usage: node scripts/inspect-outlook-token.mjs <mailbox-id>');
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
      id: true,
      email: true,
      oauthProvider: true,
      oauthTokenExpiresAt: true,
      oauthAccessToken: true,
      oauthRefreshToken: true,
      lastSyncError: true,
      syncStatus: true,
      syncErrorCount: true,
    },
  });

  if (!mailbox) {
    console.error('Mailbox not found');
    process.exit(1);
  }

  let accessToken = '';
  try {
    accessToken = decrypt(mailbox.oauthAccessToken, Buffer.from(crypto.createHash('sha256').update(encryptionKey).digest()));
  } catch {
    accessToken = decrypt(mailbox.oauthAccessToken, Buffer.from(encryptionKey.padEnd(32, '0').slice(0, 32), 'utf8'));
  }

  const payloadPart = accessToken.split('.')[1] || '';
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));

  console.log(JSON.stringify({
    mailbox: {
      id: mailbox.id,
      email: mailbox.email,
      oauthProvider: mailbox.oauthProvider,
      syncStatus: mailbox.syncStatus,
      syncErrorCount: mailbox.syncErrorCount,
      lastSyncError: mailbox.lastSyncError,
      oauthTokenExpiresAt: mailbox.oauthTokenExpiresAt,
    },
    tokenClaims: {
      aud: claims.aud,
      iss: claims.iss,
      tid: claims.tid,
      scp: claims.scp,
      preferred_username: claims.preferred_username,
      upn: claims.upn,
      email: claims.email,
      exp: claims.exp,
      appid: claims.appid,
    },
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
