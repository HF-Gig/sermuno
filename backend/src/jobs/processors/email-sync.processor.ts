import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { ImapFlow } from 'imapflow';
import * as crypto from 'crypto';
import { simpleParser } from 'mailparser';
import { EMAIL_SYNC_QUEUE } from '../queues/email-sync.queue';
import { PrismaService } from '../../database/prisma.service';
import { CrmService } from '../../modules/crm/crm.service';
import type { Prisma } from '@prisma/client';
import { EventsGateway } from '../../modules/websockets/events.gateway';
import {
  resolveEmailSyncProviderPolicy,
  sharedEmailSyncRateLimiter,
  type EmailSyncProviderPolicy,
} from './email-sync-provider-policy';

export interface EmailSyncJobData {
  mailboxId: string;
  organizationId: string;
  /** When true, use mini-chunks of 100 messages with 50ms delay (ENABLE_STREAMING_SYNC) */
  streamingMode?: boolean;
}

const STREAM_CHUNK_SIZE = 100;
const STREAM_DELAY_MS = 50;

/** Gmail/IMAP folder name → folder type mapping */
const FOLDER_TYPE_MAP: Record<string, string> = {
  INBOX: 'inbox',
  '[Gmail]/Sent Mail': 'sent',
  '[Gmail]/Drafts': 'drafts',
  '[Gmail]/Spam': 'spam',
  '[Gmail]/Trash': 'trash',
  '[Gmail]/All Mail': 'archive',
  // Outlook variants
  'Sent Items': 'sent',
  Sent: 'sent',
  Drafts: 'drafts',
  'Junk Email': 'spam',
  'Deleted Items': 'trash',
  Archive: 'archive',
};

/** Folders to sync (by resolved type) */
const SYNC_FOLDER_TYPES = new Set(['inbox', 'sent', 'drafts', 'spam', 'trash']);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

@Processor(EMAIL_SYNC_QUEUE, {
  concurrency: 2,
})
export class EmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Optional() private readonly crmService: CrmService | null,
    @Optional() private readonly eventsGateway: EventsGateway | null,
  ) {
    super();
  }

  async process(job: Job<EmailSyncJobData>): Promise<void> {
    const { mailboxId, organizationId, streamingMode } = job.data;
    this.logger.log(
      `[email-sync] mailbox=${mailboxId} org=${organizationId} streaming=${streamingMode ?? false}`,
    );

    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId, deletedAt: null },
    });

    if (!mailbox) {
      this.logger.warn(
        `[email-sync] Mailbox ${mailboxId} not found — skipping`,
      );
      return;
    }

    const providerSyncPolicy = resolveEmailSyncProviderPolicy(
      this.configService,
      mailbox,
    );
    this.logger.log(
      `[email-sync] mailbox=${mailboxId} provider=${providerSyncPolicy.label} batch=${providerSyncPolicy.batchSize} delayMs=${providerSyncPolicy.delayMs} cap=${providerSyncPolicy.rateLimit.capacity} refill=${providerSyncPolicy.rateLimit.refillPerSecond}/s`,
    );

    const imapHost =
      mailbox.imapHost ||
      (mailbox.provider === 'GMAIL'
        ? 'imap.gmail.com'
        : mailbox.provider === 'OUTLOOK'
          ? 'outlook.office365.com'
          : null);
    const imapUser = mailbox.imapUser || mailbox.email;
    if (
      !imapHost ||
      !imapUser ||
      (!mailbox.imapPass &&
        !mailbox.oauthAccessToken &&
        !mailbox.googleAccessToken)
    ) {
      this.logger.warn(
        `[email-sync] Mailbox ${mailboxId} missing IMAP auth credentials — skipping`,
      );
      await this.markMailboxSyncFailed(
        mailboxId,
        organizationId,
        'Missing IMAP credentials',
      );
      return;
    }

    let imapPass: string | null = null;
    let oauthAccessToken: string | null = null;

    if (mailbox.imapPass) {
      try {
        imapPass = this.decrypt(mailbox.imapPass);
      } catch {
        this.logger.warn(
          `[email-sync] Failed to decrypt IMAP password for mailbox=${mailboxId}`,
        );
      }
    }

    if (!imapPass) {
      // Prefer oauthAccessToken; fall back to googleAccessToken
      const encryptedOauthToken =
        mailbox.oauthAccessToken || mailbox.googleAccessToken;
      if (encryptedOauthToken) {
        try {
          const decryptedToken = this.decrypt(encryptedOauthToken);

          // Check if token is expired (or expires within 2 minutes)
          const expiresAt =
            mailbox.oauthTokenExpiresAt ?? mailbox.googleTokenExpiresAt;
          const isExpired = expiresAt
            ? expiresAt.getTime() - Date.now() < 2 * 60 * 1000
            : false;

          if (isExpired) {
            this.logger.log(
              `[email-sync] OAuth token expired for mailbox=${mailboxId}, attempting refresh`,
            );
            const refreshed =
              mailbox.oauthProvider === 'microsoft'
                ? await this.refreshMicrosoftToken(mailboxId, mailbox)
                : await this.refreshGoogleToken(mailboxId, mailbox);
            if (refreshed) {
              oauthAccessToken = refreshed;
            } else {
              // Use the (possibly stale) token anyway — Google may still accept it
              oauthAccessToken = decryptedToken;
              this.logger.warn(
                `[email-sync] Token refresh failed; proceeding with existing token for mailbox=${mailboxId}`,
              );
            }
          } else {
            oauthAccessToken = decryptedToken;
          }
        } catch {
          this.logger.warn(
            `[email-sync] Failed to decrypt OAuth token for mailbox=${mailboxId}`,
          );
        }
      }
    }

    if (!imapPass && !oauthAccessToken) {
      this.logger.error(
        `[email-sync] No usable auth credential for mailbox=${mailboxId}`,
      );
      await this.markMailboxSyncFailed(
        mailboxId,
        organizationId,
        'No usable auth credential',
      );
      return;
    }

    const authConfig = imapPass
      ? { user: imapUser, pass: imapPass }
      : { user: imapUser, accessToken: oauthAccessToken! };

    await this.prisma.mailbox.update({
      where: { id: mailboxId },
      data: {
        syncStatus: 'SYNCING',
        healthStatus: 'degraded',
        lastSyncError: null,
      },
    });

    this.eventsGateway?.emitToOrganization(organizationId, 'mailbox:synced', {
      mailboxId,
      organizationId,
      syncStatus: 'SYNCING',
    });

    if (
      !imapPass &&
      oauthAccessToken &&
      mailbox.provider === 'OUTLOOK' &&
      mailbox.oauthProvider === 'microsoft'
    ) {
      const refreshedGraphToken = await this.refreshMicrosoftToken(
        mailboxId,
        mailbox,
      );
      const effectiveToken = refreshedGraphToken || oauthAccessToken;
      const outlookSynced = await this.trySyncOutlookViaApi(
        mailboxId,
        organizationId,
        effectiveToken,
        streamingMode ?? false,
        providerSyncPolicy,
      );
      if (outlookSynced) {
        await this.prisma.mailbox.update({
          where: { id: mailboxId },
          data: {
            lastSyncAt: new Date(),
            syncStatus: 'SUCCESS',
            syncErrorCount: 0,
            nextRetryAt: null,
            healthStatus: 'healthy',
            lastSyncError: null,
          },
        });

        this.eventsGateway?.emitToOrganization(
          organizationId,
          'mailbox:synced',
          {
            mailboxId,
            organizationId,
            syncStatus: 'SUCCESS',
            lastSyncAt: new Date().toISOString(),
          },
        );

        return;
      }

      await this.markMailboxSyncFailed(
        mailboxId,
        organizationId,
        'Microsoft mailbox does not have mail API scope yet. Reconnect Microsoft mailbox and grant requested permissions.',
      );
      return;
    }

    const client = new ImapFlow({
      host: imapHost,
      port: mailbox.imapPort ?? 993,
      secure: mailbox.imapSecure,
      auth: authConfig,
      logger: false,
    });

    try {
      await this.acquireProviderRequestSlot(providerSyncPolicy);
      await client.connect();
      await this.syncAllFolders(
        client,
        mailboxId,
        organizationId,
        streamingMode ?? false,
        providerSyncPolicy,
      );

      await this.prisma.mailbox.update({
        where: { id: mailboxId },
        data: {
          lastSyncAt: new Date(),
          syncStatus: 'SUCCESS',
          syncErrorCount: 0,
          nextRetryAt: null,
          healthStatus: 'healthy',
        },
      });

      this.eventsGateway?.emitToOrganization(organizationId, 'mailbox:synced', {
        mailboxId,
        organizationId,
        syncStatus: 'SUCCESS',
        lastSyncAt: new Date().toISOString(),
      });
    } catch (err) {
      const errorDetails = (() => {
        if (!err || typeof err !== 'object') return String(err);
        const e = err as {
          message?: string;
          command?: string;
          response?: string;
          responseText?: string;
          code?: string;
        };
        return [
          e.message,
          e.command ? `command=${e.command}` : '',
          e.code ? `code=${e.code}` : '',
          e.responseText || e.response || '',
        ]
          .filter(Boolean)
          .join(' | ');
      })();
      this.logger.error(
        `[email-sync] mailbox=${mailboxId} error: ${errorDetails}`,
      );

      await this.markMailboxSyncFailed(mailboxId, organizationId, String(err));
      throw err;
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private async acquireProviderRequestSlot(
    providerSyncPolicy: EmailSyncProviderPolicy,
  ): Promise<void> {
    await sharedEmailSyncRateLimiter.acquire(
      providerSyncPolicy.key,
      providerSyncPolicy,
    );
  }

  private resolveFetchBatchSize(
    providerSyncPolicy: EmailSyncProviderPolicy,
    streamingMode: boolean,
  ): number {
    if (streamingMode) {
      return Math.max(
        1,
        Math.min(providerSyncPolicy.batchSize, STREAM_CHUNK_SIZE),
      );
    }

    return Math.max(1, providerSyncPolicy.batchSize);
  }

  private async markMailboxSyncFailed(
    mailboxId: string,
    organizationId: string,
    errorMessage: string,
  ) {
    const current = await this.prisma.mailbox.findUnique({
      where: { id: mailboxId },
      select: { syncErrorCount: true },
    });
    const newErrorCount = (current?.syncErrorCount ?? 0) + 1;
    const backoffMinutes = Math.min(Math.pow(2, newErrorCount), 60);
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

    await this.prisma.mailbox.update({
      where: { id: mailboxId },
      data: {
        syncStatus: 'FAILED',
        healthStatus: 'failed',
        syncErrorCount: { increment: 1 },
        nextRetryAt,
        lastSyncError: String(errorMessage || 'Sync failed'),
      },
    });

    this.eventsGateway?.emitToOrganization(organizationId, 'mailbox:synced', {
      mailboxId,
      organizationId,
      syncStatus: 'FAILED',
    });
  }

  // ─── Token refresh ────────────────────────────────────────────────────────

  /**
   * Attempts to refresh the Google OAuth access token using the stored refresh token.
   * Returns the new plaintext access token on success, or null on failure.
   */
  private async refreshGoogleToken(
    mailboxId: string,
    mailbox: {
      googleRefreshToken?: string | null;
      oauthRefreshToken?: string | null;
    },
  ): Promise<string | null> {
    const encryptedRefreshToken =
      mailbox.oauthRefreshToken || mailbox.googleRefreshToken;
    if (!encryptedRefreshToken) {
      this.logger.warn(
        `[email-sync] No refresh token stored for mailbox=${mailboxId}`,
      );
      return null;
    }

    let refreshToken: string;
    try {
      refreshToken = this.decrypt(encryptedRefreshToken);
    } catch {
      this.logger.warn(
        `[email-sync] Failed to decrypt refresh token for mailbox=${mailboxId}`,
      );
      return null;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';

    if (!clientId || !clientSecret) {
      this.logger.warn(
        `[email-sync] Google OAuth client credentials not configured — cannot refresh token`,
      );
      return null;
    }

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(
          `[email-sync] Google token refresh failed (${res.status}): ${body}`,
        );
        return null;
      }

      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
      };

      if (!json.access_token) {
        this.logger.warn(
          `[email-sync] Google token refresh returned no access_token for mailbox=${mailboxId}`,
        );
        return null;
      }

      // Persist the fresh token
      const encryptedNewToken = this.encryptToken(json.access_token);
      const newExpiresAt = json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000)
        : null;

      await this.prisma.mailbox.update({
        where: { id: mailboxId },
        data: {
          oauthAccessToken: encryptedNewToken,
          googleAccessToken: encryptedNewToken,
          ...(newExpiresAt
            ? {
                oauthTokenExpiresAt: newExpiresAt,
                googleTokenExpiresAt: newExpiresAt,
              }
            : {}),
        },
      });

      this.logger.log(
        `[email-sync] Refreshed Google OAuth token for mailbox=${mailboxId}`,
      );
      return json.access_token;
    } catch (err) {
      this.logger.warn(
        `[email-sync] Exception during Google token refresh for mailbox=${mailboxId}: ${String(err)}`,
      );
      return null;
    }
  }

  private async refreshMicrosoftToken(
    mailboxId: string,
    mailbox: {
      oauthRefreshToken?: string | null;
    },
  ): Promise<string | null> {
    const encryptedRefreshToken = mailbox.oauthRefreshToken;
    if (!encryptedRefreshToken) {
      this.logger.warn(
        `[email-sync] No Microsoft refresh token stored for mailbox=${mailboxId}`,
      );
      return null;
    }

    let refreshToken: string;
    try {
      refreshToken = this.decrypt(encryptedRefreshToken);
    } catch {
      this.logger.warn(
        `[email-sync] Failed to decrypt Microsoft refresh token for mailbox=${mailboxId}`,
      );
      return null;
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID ?? '';
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET ?? '';
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI ?? '';
    const scopes = [
      'openid',
      'profile',
      'email',
      'offline_access',
      'https://graph.microsoft.com/User.Read',
      'https://graph.microsoft.com/Mail.Read',
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
    ].join(' ');

    if (!clientId || !clientSecret || !redirectUri) {
      this.logger.warn(
        '[email-sync] Microsoft OAuth client credentials not configured — cannot refresh token',
      );
      return null;
    }

    const tenants = ['consumers', 'common', 'organizations'];

    for (const tenant of tenants) {
      try {
        const res = await fetch(
          `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
              redirect_uri: redirectUri,
              grant_type: 'refresh_token',
              scope: scopes,
            }),
          },
        );

        if (!res.ok) {
          const body = await res.text();
          this.logger.warn(
            `[email-sync] Microsoft token refresh failed tenant=${tenant} status=${res.status}: ${body.slice(0, 260)}`,
          );
          continue;
        }

        const json = (await res.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };

        if (!json.access_token) {
          this.logger.warn(
            `[email-sync] Microsoft token refresh returned no access_token for mailbox=${mailboxId}`,
          );
          continue;
        }

        const encryptedNewToken = this.encryptToken(json.access_token);
        const newRefreshToken = json.refresh_token
          ? this.encryptToken(json.refresh_token)
          : null;
        const newExpiresAt = json.expires_in
          ? new Date(Date.now() + json.expires_in * 1000)
          : null;

        await this.prisma.mailbox.update({
          where: { id: mailboxId },
          data: {
            oauthAccessToken: encryptedNewToken,
            ...(newRefreshToken ? { oauthRefreshToken: newRefreshToken } : {}),
            ...(newExpiresAt ? { oauthTokenExpiresAt: newExpiresAt } : {}),
          },
        });

        this.logger.log(
          `[email-sync] Refreshed Microsoft OAuth token for mailbox=${mailboxId} using tenant=${tenant}`,
        );
        return json.access_token;
      } catch (err) {
        this.logger.warn(
          `[email-sync] Exception during Microsoft token refresh tenant=${tenant} mailbox=${mailboxId}: ${String(err)}`,
        );
      }
    }

    return null;
  }

  private async trySyncOutlookViaApi(
    mailboxId: string,
    organizationId: string,
    accessToken: string,
    streamingMode: boolean,
    providerSyncPolicy: EmailSyncProviderPolicy,
  ): Promise<boolean> {
    const apiHeaders = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };
    const pageSize = Math.max(1, Math.min(providerSyncPolicy.batchSize, 1000));

    const apiCandidates = [
      {
        name: 'graph',
        folderUrl: (top: number) =>
          `https://graph.microsoft.com/v1.0/me/mailFolders?$top=${top}&$select=id,displayName`,
        messagesUrl: (folderId: string, top: number) =>
          `https://graph.microsoft.com/v1.0/me/mailFolders/${encodeURIComponent(folderId)}/messages` +
          `?$top=${top}&$orderby=receivedDateTime%20desc`,
      },
      {
        name: 'outlook-rest',
        folderUrl: (top: number) =>
          `https://outlook.office.com/api/v2.0/me/mailfolders?$top=${top}`,
        messagesUrl: (folderId: string, top: number) =>
          `https://outlook.office.com/api/v2.0/me/mailfolders/${encodeURIComponent(folderId)}/messages` +
          `?$top=${top}&$orderby=DateTimeReceived%20desc`,
      },
    ];

    for (const candidate of apiCandidates) {
      const folderRows: Array<{ id: string; displayName: string }> = [];
      try {
        for await (const folderPage of this.iterateOutlookApiCollection<{
          id?: string;
          displayName?: string;
          Id?: string;
          DisplayName?: string;
        }>(candidate.folderUrl(pageSize), apiHeaders, providerSyncPolicy)) {
          folderRows.push(
            ...folderPage
              .map((folder) => ({
                id: String(folder.id ?? folder.Id ?? '').trim(),
                displayName: String(
                  folder.displayName ?? folder.DisplayName ?? '',
                ).trim(),
              }))
              .filter((folder) => folder.id && folder.displayName),
          );
        }
      } catch (err) {
        const { status, body } = this.outlookApiErrorDetails(err);
        this.logger.warn(
          `[email-sync] ${candidate.name} folders read failed mailbox=${mailboxId} status=${status}: ${body.slice(0, 260)}`,
        );
        continue;
      }

      if (folderRows.length === 0) {
        this.logger.warn(
          `[email-sync] ${candidate.name} returned no folders for mailbox=${mailboxId}`,
        );
        continue;
      }

      const selectedFolders = folderRows
        .map((folder) => {
          const folderType =
            FOLDER_TYPE_MAP[folder.displayName] ||
            (folder.displayName.toUpperCase() === 'INBOX' ? 'inbox' : 'other');
          return {
            id: folder.id,
            displayName: folder.displayName,
            folderType,
          };
        })
        .filter(
          (folder) =>
            folder.folderType === 'inbox' ||
            SYNC_FOLDER_TYPES.has(folder.folderType),
        );

      if (selectedFolders.length === 0) {
        this.logger.warn(
          `[email-sync] ${candidate.name} produced no syncable folders for mailbox=${mailboxId}`,
        );
        continue;
      }

      for (const folder of selectedFolders) {
        let mailboxFolder = await this.prisma.mailboxFolder.findFirst({
          where: { mailboxId, name: folder.displayName },
        });

        if (!mailboxFolder) {
          mailboxFolder = await this.prisma.mailboxFolder.create({
            data: {
              mailbox: { connect: { id: mailboxId } },
              name: folder.displayName,
              type: folder.folderType,
              uidValidity: BigInt(1),
              uidNext: BigInt(1),
              syncStatus: 'SYNCING',
            },
          });
        } else {
          await this.prisma.mailboxFolder.update({
            where: { id: mailboxFolder.id },
            data: { syncStatus: 'SYNCING' },
          });
        }

        let createdCount = 0;
        try {
          for await (const messagePage of this.iterateOutlookApiCollection<
            Record<string, unknown>
          >(
            candidate.messagesUrl(folder.id, pageSize),
            apiHeaders,
            providerSyncPolicy,
          )) {
            const chunks = streamingMode
              ? chunkArray(messagePage, STREAM_CHUNK_SIZE)
              : [messagePage];

            for (const chunk of chunks) {
              for (const message of chunk) {
                const created = await this.upsertOutlookApiMessage(
                  message,
                  mailboxId,
                  organizationId,
                  mailboxFolder.id,
                  folder.folderType,
                );
                if (created) createdCount += 1;
              }
              if (streamingMode) await sleep(STREAM_DELAY_MS);
            }
          }
        } catch (err) {
          const { status, body } = this.outlookApiErrorDetails(err);
          this.logger.warn(
            `[email-sync] ${candidate.name} messages read failed mailbox=${mailboxId} folder=${folder.displayName} status=${status}: ${body.slice(0, 260)}`,
          );
          await this.prisma.mailboxFolder.update({
            where: { id: mailboxFolder.id },
            data: { syncStatus: 'FAILED' },
          });
          continue;
        }

        await this.prisma.mailboxFolder.update({
          where: { id: mailboxFolder.id },
          data: {
            syncStatus: 'SUCCESS',
            lastSyncedAt: new Date(),
            ...(createdCount > 0
              ? { messageCount: { increment: createdCount } }
              : {}),
          },
        });
      }

      this.logger.log(
        `[email-sync] mailbox=${mailboxId} synced via ${candidate.name}`,
      );
      return true;
    }

    return false;
  }

  private async *iterateOutlookApiCollection<T>(
    initialUrl: string,
    headers: Record<string, string>,
    providerSyncPolicy: EmailSyncProviderPolicy,
  ): AsyncGenerator<T[]> {
    let nextUrl: string | null = initialUrl;

    while (nextUrl) {
      await this.acquireProviderRequestSlot(providerSyncPolicy);
      const response = await fetch(nextUrl, { headers });
      if (!response.ok) {
        throw {
          status: response.status,
          body: await response.text(),
        };
      }

      const payload = (await response.json()) as {
        value?: T[];
        '@odata.nextLink'?: string;
        nextLink?: string;
      } & Record<string, unknown>;

      yield payload.value ?? [];

      nextUrl = String(
        payload['@odata.nextLink'] ??
          payload['odata.nextLink'] ??
          payload.nextLink ??
          '',
      ).trim();
      if (!nextUrl) {
        nextUrl = null;
      }
    }
  }

  private outlookApiErrorDetails(err: unknown): {
    status: string;
    body: string;
  } {
    if (!err || typeof err !== 'object') {
      return {
        status: 'unknown',
        body: String(err),
      };
    }

    const error = err as { status?: number | string; body?: string };
    return {
      status: String(error.status ?? 'unknown'),
      body: String(error.body ?? ''),
    };
  }

  private async upsertOutlookApiMessage(
    message: Record<string, unknown>,
    mailboxId: string,
    organizationId: string,
    folderId: string,
    folderType: string,
  ): Promise<boolean> {
    const fromObj = (message.from ?? message.From ?? {}) as {
      emailAddress?: { address?: string; name?: string };
      EmailAddress?: { Address?: string; Name?: string };
    };
    const toRecipients = (message.toRecipients ??
      message.ToRecipients ??
      []) as Array<{
      emailAddress?: { address?: string };
      EmailAddress?: { Address?: string };
    }>;
    const ccRecipients = (message.ccRecipients ??
      message.CcRecipients ??
      []) as Array<{
      emailAddress?: { address?: string };
      EmailAddress?: { Address?: string };
    }>;
    const bccRecipients = (message.bccRecipients ??
      message.BccRecipients ??
      []) as Array<{
      emailAddress?: { address?: string };
      EmailAddress?: { Address?: string };
    }>;
    const bodyObj = (message.body ?? message.Body ?? {}) as {
      contentType?: string;
      content?: string;
      ContentType?: string;
      Content?: string;
    };

    const providerMessageId = String(message.id ?? message.Id ?? '').trim();
    if (!providerMessageId) return false;

    const existing = await this.prisma.message.findFirst({
      where: { mailboxId, messageId: providerMessageId },
      select: { id: true },
    });
    if (existing) return false;

    const fromEmail = String(
      fromObj.emailAddress?.address ||
        fromObj.EmailAddress?.Address ||
        'unknown@example.com',
    ).toLowerCase();
    const fromName = String(
      fromObj.emailAddress?.name || fromObj.EmailAddress?.Name || '',
    );
    const toAddresses = toRecipients
      .map((item) =>
        String(
          item?.emailAddress?.address || item?.EmailAddress?.Address || '',
        ).toLowerCase(),
      )
      .filter(Boolean);
    const ccAddresses = ccRecipients
      .map((item) =>
        String(
          item?.emailAddress?.address || item?.EmailAddress?.Address || '',
        ).toLowerCase(),
      )
      .filter(Boolean);
    const bccAddresses = bccRecipients
      .map((item) =>
        String(
          item?.emailAddress?.address || item?.EmailAddress?.Address || '',
        ).toLowerCase(),
      )
      .filter(Boolean);

    const subject = String(
      message.subject ?? message.Subject ?? '(no subject)',
    );
    const messageIdHeader = String(
      message.internetMessageId ??
        message.InternetMessageId ??
        providerMessageId,
    );
    const isDraft =
      Boolean(message.isDraft ?? message.IsDraft) || folderType === 'drafts';
    const direction: 'INBOUND' | 'OUTBOUND' =
      folderType === 'sent' ? 'OUTBOUND' : 'INBOUND';
    const bodyText = String(
      message.bodyPreview ?? message.BodyPreview ?? '',
    ).slice(0, 50000);
    const bodyContentType = String(
      bodyObj.contentType ?? bodyObj.ContentType ?? '',
    ).toUpperCase();
    const bodyHtml =
      bodyContentType === 'HTML'
        ? String(bodyObj.content ?? bodyObj.Content ?? '').slice(0, 200000)
        : null;

    const receivedAtRaw = String(
      message.receivedDateTime ?? message.DateTimeReceived ?? '',
    );
    const sentAtRaw = String(
      message.sentDateTime ?? message.DateTimeSent ?? '',
    );
    const receivedAt = receivedAtRaw
      ? new Date(receivedAtRaw)
      : sentAtRaw
        ? new Date(sentAtRaw)
        : new Date();

    const thread = await this.findOrCreateThread(
      organizationId,
      mailboxId,
      subject,
      messageIdHeader,
      undefined,
      fromEmail,
      fromName,
    );

    const snippetSource = (
      bodyText || (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, ' ') : '')
    ).trim();
    const snippet = snippetSource
      ? `${snippetSource.replace(/\s+/g, ' ').slice(0, 200)}${fromName ? ` — ${fromName}` : ''}`
      : null;

    await this.prisma.message.create({
      data: {
        thread: { connect: { id: thread.id } },
        mailbox: { connect: { id: mailboxId } },
        folder: { connect: { id: folderId } },
        messageId: providerMessageId,
        fromEmail,
        to: toAddresses as unknown as Prisma.InputJsonValue,
        cc: ccAddresses.length
          ? (ccAddresses as unknown as Prisma.InputJsonValue)
          : undefined,
        bcc: bccAddresses.length
          ? (bccAddresses as unknown as Prisma.InputJsonValue)
          : undefined,
        subject,
        bodyText,
        bodyHtml,
        isRead: Boolean(message.isRead ?? message.IsRead),
        hasAttachments: Boolean(
          message.hasAttachments ?? message.HasAttachments,
        ),
        isInternalNote: false,
        isDraft,
        direction,
        inReplyTo: null,
        snippet,
        createdAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
      },
    });

    this.eventsGateway?.emitToOrganization(organizationId, 'thread:updated', {
      threadId: thread.id,
      mailboxId,
      type: 'new_message',
    });

    if (this.crmService && fromEmail !== 'unknown@example.com') {
      await this.crmService
        .autoCreateContactIfEnabled(fromEmail, fromName, organizationId)
        .catch((err) =>
          this.logger.warn(
            `[email-sync] CRM auto-create failed: ${String(err)}`,
          ),
        );
    }

    return true;
  }

  // ─── Multi-folder sync ────────────────────────────────────────────────────

  private async syncAllFolders(
    client: ImapFlow,
    mailboxId: string,
    organizationId: string,
    streamingMode: boolean,
    providerSyncPolicy: EmailSyncProviderPolicy,
  ): Promise<void> {
    // List all IMAP folders
    await this.acquireProviderRequestSlot(providerSyncPolicy);
    const folderList = await client.list();
    this.logger.log(
      `[email-sync] mailbox=${mailboxId} found ${folderList.length} IMAP folders`,
    );

    // Always ensure INBOX is in the list
    const foldersToSync: Array<{ path: string; type: string }> = [];

    for (const folder of folderList) {
      const path = folder.path;
      const mappedType = FOLDER_TYPE_MAP[path];

      if (mappedType && SYNC_FOLDER_TYPES.has(mappedType)) {
        foldersToSync.push({ path, type: mappedType });
      }
    }

    // Make sure INBOX is always present even if not returned by list()
    if (!foldersToSync.find((f) => f.path === 'INBOX')) {
      foldersToSync.unshift({ path: 'INBOX', type: 'inbox' });
    }

    this.logger.log(
      `[email-sync] mailbox=${mailboxId} syncing folders: ${foldersToSync.map((f) => f.path).join(', ')}`,
    );

    for (const { path, type } of foldersToSync) {
      try {
        await this.syncFolder(
          client,
          mailboxId,
          organizationId,
          path,
          type,
          streamingMode,
          providerSyncPolicy,
        );
      } catch (err) {
        // Log but don't abort — continue with other folders
        this.logger.warn(
          `[email-sync] mailbox=${mailboxId} folder=${path} sync error: ${String(err)}`,
        );
      }
    }
  }

  private async syncFolder(
    client: ImapFlow,
    mailboxId: string,
    organizationId: string,
    folderPath: string,
    folderType: string,
    streamingMode: boolean,
    providerSyncPolicy: EmailSyncProviderPolicy,
  ): Promise<void> {
    let lock: { release: () => void } | null = null;
    try {
      await this.acquireProviderRequestSlot(providerSyncPolicy);
      lock = await client.getMailboxLock(folderPath);
    } catch (err) {
      this.logger.warn(
        `[email-sync] mailbox=${mailboxId} could not lock folder=${folderPath}: ${String(err)}`,
      );
      return;
    }

    try {
      let folder = await this.prisma.mailboxFolder.findFirst({
        where: { mailboxId, name: folderPath },
      });

      const serverStatus = client.mailbox as
        | { uidValidity?: number; uidNext?: number }
        | false;
      const lastUidNext = folder?.uidNext ? Number(folder.uidNext) : 1;

      if (!folder) {
        folder = await this.prisma.mailboxFolder.create({
          data: {
            mailbox: { connect: { id: mailboxId } },
            name: folderPath,
            type: folderType,
            uidValidity:
              serverStatus && serverStatus.uidValidity
                ? BigInt(serverStatus.uidValidity)
                : null,
            uidNext:
              serverStatus && serverStatus.uidNext
                ? BigInt(serverStatus.uidNext)
                : null,
            syncStatus: 'SYNCING',
          },
        });
      } else if (!folder.type) {
        // Backfill type if missing
        await this.prisma.mailboxFolder.update({
          where: { id: folder.id },
          data: { type: folderType },
        });
      }

      let messageUids: number[] = [];

      try {
        await this.acquireProviderRequestSlot(providerSyncPolicy);
        const incrementalSearch = await client.search(
          { uid: `${lastUidNext}:*` },
          { uid: true },
        );
        const incrementalUids = Array.isArray(incrementalSearch)
          ? incrementalSearch
          : [];
        messageUids = [...incrementalUids].sort((left, right) => left - right);
      } catch {
        this.logger.warn(
          `[email-sync] mailbox=${mailboxId} folder=${folderPath} incremental fetch failed; retrying full scan`,
        );
        await this.acquireProviderRequestSlot(providerSyncPolicy);
        const fullScanSearch = await client.search(
          { all: true },
          { uid: true },
        );
        const fullScanUids = Array.isArray(fullScanSearch)
          ? fullScanSearch
          : [];
        messageUids = [...fullScanUids].sort((left, right) => left - right);
      }

      this.logger.log(
        `[email-sync] mailbox=${mailboxId} folder=${folderPath} fetched ${messageUids.length} new messages`,
      );

      if (messageUids.length === 0) {
        await this.prisma.mailboxFolder.update({
          where: { id: folder.id },
          data: { syncStatus: 'SUCCESS', lastSyncedAt: new Date() },
        });
        return;
      }

      const fetchBatchSize = this.resolveFetchBatchSize(
        providerSyncPolicy,
        streamingMode,
      );
      const uidBatches = chunkArray(messageUids, fetchBatchSize);
      let processedCount = 0;

      for (const uidBatch of uidBatches) {
        const fetchedMessages: Array<{
          uid: number;
          envelope: {
            messageId?: string;
            subject?: string;
            from?: Array<{ address?: string; name?: string }>;
            to?: Array<{ address?: string }>;
            date?: Date;
            inReplyTo?: string;
          };
          source?: Buffer;
        }> = [];

        await this.acquireProviderRequestSlot(providerSyncPolicy);
        for await (const msg of client.fetch(
          uidBatch,
          {
            uid: true,
            envelope: true,
            source: true,
          },
          { uid: true },
        )) {
          fetchedMessages.push({
            uid: msg.uid,
            envelope: msg.envelope as (typeof fetchedMessages)[0]['envelope'],
            source: msg.source,
          });
        }

        const chunks = streamingMode
          ? chunkArray(fetchedMessages, STREAM_CHUNK_SIZE)
          : [fetchedMessages];

        for (const chunk of chunks) {
          for (const msg of chunk) {
            await this.upsertMessage(
              msg,
              mailboxId,
              organizationId,
              folder.id,
              folderType,
            );
            processedCount += 1;
          }
          if (streamingMode) await sleep(STREAM_DELAY_MS);
        }
      }

      const maxUid = Math.max(...messageUids);
      await this.prisma.mailboxFolder.update({
        where: { id: folder.id },
        data: {
          uidNext: BigInt(maxUid + 1),
          uidValidity:
            serverStatus && serverStatus.uidValidity
              ? BigInt(serverStatus.uidValidity)
              : undefined,
          syncStatus: 'SUCCESS',
          lastSyncedAt: new Date(),
          messageCount: { increment: processedCount },
        },
      });
    } finally {
      lock?.release();
    }
  }

  // ─── Message upsert ───────────────────────────────────────────────────────

  private async upsertMessage(
    msg: {
      uid: number;
      envelope: {
        messageId?: string;
        subject?: string;
        from?: Array<{ address?: string; name?: string }>;
        to?: Array<{ address?: string }>;
        date?: Date;
        inReplyTo?: string;
      };
      source?: Buffer;
    },
    mailboxId: string,
    organizationId: string,
    folderId: string,
    folderType: string,
  ): Promise<void> {
    const env = msg.envelope;
    const fromEmail = env.from?.[0]?.address ?? 'unknown@example.com';
    const fromName = env.from?.[0]?.name ?? '';
    const toAddresses = (env.to ?? [])
      .map((a) => a.address ?? '')
      .filter(Boolean);
    const subject = env.subject ?? '(no subject)';
    const rfc822MessageId = env.messageId ?? `<uid-${msg.uid}@imap>`;
    const inReplyTo = env.inReplyTo ?? undefined;
    const receivedAt = env.date ?? new Date();

    // Parse MIME to extract clean body text and HTML
    let bodyText = '';
    let bodyHtml: string | null = null;
    if (msg.source) {
      try {
        const parsed = await simpleParser(msg.source);
        bodyText = parsed.text ?? '';
        bodyHtml = parsed.html || null;
        // Trim to storage limits
        bodyText = bodyText.slice(0, 50000);
        if (bodyHtml) bodyHtml = bodyHtml.slice(0, 200000);
      } catch {
        // Fall back to raw source, stripping obvious MIME headers
        const raw = msg.source.toString('utf8');
        const headerEnd = raw.indexOf('\r\n\r\n');
        bodyText =
          headerEnd >= 0
            ? raw.slice(headerEnd + 4).slice(0, 50000)
            : raw.slice(0, 50000);
      }
    }

    // Idempotent: skip if already stored (unique by mailboxId + folderId + imapUid)
    const existing = await this.prisma.message.findFirst({
      where: { mailboxId, folderId, imapUid: msg.uid },
      select: { id: true },
    });
    if (existing) return;

    const direction: 'INBOUND' | 'OUTBOUND' =
      folderType === 'sent' ? 'OUTBOUND' : 'INBOUND';
    const isDraft = folderType === 'drafts';

    const thread = await this.findOrCreateThread(
      organizationId,
      mailboxId,
      subject,
      rfc822MessageId,
      inReplyTo,
      fromEmail,
      fromName,
    );

    // Build snippet from clean text (not raw MIME)
    const snippetText = bodyText.trim().replace(/\s+/g, ' ');
    const snippet =
      snippetText.slice(0, 200) + (fromName ? ` — ${fromName}` : '') || null;

    await this.prisma.message.create({
      data: {
        thread: { connect: { id: thread.id } },
        mailbox: { connect: { id: mailboxId } },
        folder: { connect: { id: folderId } },
        fromEmail,
        to: toAddresses as unknown as Prisma.InputJsonValue,
        subject,
        bodyText,
        bodyHtml,
        isInternalNote: false,
        isDraft,
        direction,
        imapUid: msg.uid,
        inReplyTo: inReplyTo ?? null,
        snippet,
        createdAt: receivedAt,
      },
    });

    this.eventsGateway?.emitToOrganization(organizationId, 'thread:updated', {
      threadId: thread.id,
      mailboxId,
      type: 'new_message',
    });

    if (this.crmService && fromEmail !== 'unknown@example.com') {
      await this.crmService
        .autoCreateContactIfEnabled(fromEmail, fromName, organizationId)
        .catch((err) =>
          this.logger.warn(
            `[email-sync] CRM auto-create failed: ${String(err)}`,
          ),
        );
    }
  }

  private async findOrCreateThread(
    organizationId: string,
    mailboxId: string,
    subject: string,
    _messageId: string,
    inReplyTo: string | undefined,
    fromEmail: string,
    fromName?: string,
  ): Promise<{ id: string }> {
    if (inReplyTo) {
      const existing = await this.prisma.thread.findFirst({
        where: { organizationId, subject },
        select: { id: true },
      });
      if (existing) return existing;
    }

    let contactLink: { contactId: string | null; companyId: string | null } = {
      contactId: null,
      companyId: null,
    };
    if (this.crmService && fromEmail && fromEmail !== 'unknown@example.com') {
      contactLink = await this.crmService
        .autoCreateContactIfEnabled(fromEmail, fromName, organizationId)
        .catch(() => ({ contactId: null, companyId: null }));
    }

    return this.prisma.thread.create({
      data: {
        organization: { connect: { id: organizationId } },
        mailbox: { connect: { id: mailboxId } },
        subject,
        status: 'OPEN',
        ...(contactLink.contactId
          ? { contact: { connect: { id: contactLink.contactId } } }
          : {}),
        ...(contactLink.companyId
          ? { company: { connect: { id: contactLink.companyId } } }
          : {}),
      },
      select: { id: true },
    });
  }

  // ─── Encryption ───────────────────────────────────────────────────────────

  private decryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY ?? '';
    return Buffer.from(crypto.createHash('sha256').update(key).digest());
  }

  private legacyDecryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY ?? '';
    return Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf8');
  }

  private decryptWithKey(ciphertext: string, key: Buffer): string {
    const [ivHex, tagHex, dataHex] = ciphertext.split(':');
    if (!ivHex || !tagHex || !dataHex)
      throw new Error('Invalid encrypted value');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }

  private decrypt(ciphertext: string): string {
    const primaryKey = this.decryptionKey();
    try {
      return this.decryptWithKey(ciphertext, primaryKey);
    } catch {
      return this.decryptWithKey(ciphertext, this.legacyDecryptionKey());
    }
  }

  private encryptToken(plaintext: string): string {
    const key = this.decryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }
}
