import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';
import { ImapFlow } from 'imapflow';
import * as crypto from 'crypto';
import { simpleParser } from 'mailparser';
import { EMAIL_SYNC_QUEUE } from '../queues/email-sync.queue';
import { PrismaService } from '../../database/prisma.service';
import { CrmService } from '../../modules/crm/crm.service';
import { AttachmentStorageService } from '../../modules/attachments/attachment-storage.service';
import type { Prisma } from '@prisma/client';
import { ThreadStatus } from '@prisma/client';
import { EventsGateway } from '../../modules/websockets/events.gateway';
import { FeatureFlagsService } from '../../config/feature-flags.service';
import { RulesEngineService } from '../../modules/rules/rules-engine.service';
import { AiCategorizationService } from '../../modules/ai-categorization/ai-categorization.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import {
  resolveEmailSyncProviderPolicy,
  sharedEmailSyncRateLimiter,
  type EmailSyncProviderPolicy,
} from './email-sync-provider-policy';
import {
  EmailSyncAdaptiveThrottle,
  type EmailSyncAdaptiveThrottleOptions,
} from './email-sync-adaptive-throttle';

export interface EmailSyncJobData {
  mailboxId: string;
  organizationId: string;
  /** When true, use mini-chunks of 100 messages with 50ms delay (ENABLE_STREAMING_SYNC) */
  streamingMode?: boolean;
  /**
   * Optional canonical folder type hints for targeted sync runs.
   * When omitted, the processor syncs all canonical folders.
   */
  folderTypeHints?: Array<'inbox' | 'sent' | 'drafts' | 'spam' | 'trash' | 'archive'>;
}

type SyncExecutionOptions = {
  interactive?: boolean;
  reconcileDeletions?: boolean;
  runtimeCache?: SyncRuntimeCache;
};

type ThreadLookupResult = {
  id: string;
  contactId: string | null;
  companyId: string | null;
};

type SyncRuntimeCache = {
  threadByMessageId: Map<string, ThreadLookupResult>;
  threadBySubject: Map<string, ThreadLookupResult>;
  contactLinkByEmail: Map<string, { contactId: string | null; companyId: string | null }>;
};

type UpsertTiming = {
  parseMs: number;
  dedupeMs: number;
  threadResolveMs: number;
  createMs: number;
  postIngestMs: number;
};

type FolderSyncTiming = {
  path: string;
  type: string;
  totalMs: number;
  lockMs: number;
  folderLookupMs: number;
  deletionReconcileMs: number;
  searchMs: number;
  fetchMs: number;
  upsertMs: number;
  parseMs: number;
  dedupeMs: number;
  threadResolveMs: number;
  createMs: number;
  postIngestMs: number;
  counterRefreshMs: number;
  newMessageCount: number;
  reconciledDeletedMessages: number;
};

type MailboxSyncTimingSummary = {
  mailboxLookupMs: number;
  credentialPrepMs: number;
  connectMs: number;
  syncFoldersMs: number;
  finalizeMs: number;
  totalMs: number;
  folderTimings: FolderSyncTiming[];
};

const STREAM_CHUNK_SIZE = 100;
const STREAM_DELAY_MS = 50;

type ResolvedMailboxFolderType =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'spam'
  | 'trash'
  | 'archive'
  | 'custom'
  | 'excluded';

/** Gmail/IMAP folder name → folder type mapping */
const CANONICAL_FOLDER_TYPES = new Set([
  'inbox',
  'sent',
  'drafts',
  'spam',
  'trash',
  'archive',
]);

const FOLDER_MESSAGE_PRIORITY: Record<string, number> = {
  inbox: 0,
  sent: 1,
  drafts: 2,
  spam: 3,
  trash: 4,
  archive: 5,
  custom: 6,
  excluded: 7,
};

function normalizeRfcMessageId(value?: string | null): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.startsWith('<') && raw.endsWith('>') ? raw : `<${raw}>`;
}

/** Folders to sync (by resolved type). */
const SYNC_FOLDER_TYPES = new Set([
  'inbox',
  'sent',
  'drafts',
  'spam',
  'trash',
  'archive',
]);

const IMAP_SPECIAL_USE_TO_TYPE: Record<string, ResolvedMailboxFolderType> = {
  '\\inbox': 'inbox',
  '\\sent': 'sent',
  '\\drafts': 'drafts',
  '\\junk': 'spam',
  '\\spam': 'spam',
  '\\trash': 'trash',
  '\\archive': 'archive',
  '\\all': 'archive',
};

const OUTLOOK_WELL_KNOWN_NAME_TO_TYPE: Record<
  string,
  ResolvedMailboxFolderType
> = {
  inbox: 'inbox',
  sentitems: 'sent',
  drafts: 'drafts',
  junkemail: 'spam',
  deleteditems: 'trash',
  archive: 'archive',
};

function normalizeToken(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\[\]().]/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveFolderTypeFromName(name: string): ResolvedMailboxFolderType {
  const raw = String(name || '').trim().toLowerCase();
  const normalized = normalizeToken(name);
  if (!normalized) return 'excluded';

  // Provider/system folders that are outside Sermuno's mailbox-folder model.
  if (
    normalized === 'gmail' ||
    raw === '[gmail]' ||
    raw === '[gmail]/starred' ||
    raw === '[gmail]/important' ||
    normalized === 'outbox' ||
    normalized === 'conversation history' ||
    normalized === 'important' ||
    normalized === 'starred' ||
    normalized === 'flagged emails' ||
    normalized.endsWith('/outbox') ||
    normalized.endsWith('/conversation history') ||
    normalized.endsWith('/starred') ||
    normalized.endsWith('/important')
  ) {
    return 'excluded';
  }

  if (
    normalized === 'inbox' ||
    normalized.endsWith('/inbox') ||
    normalized.includes(' inbox')
  ) {
    return 'inbox';
  }

  if (
    normalized.includes('sent') ||
    normalized.includes('sent items') ||
    normalized.includes('sent mail')
  ) {
    return 'sent';
  }

  if (normalized.includes('draft')) {
    return 'drafts';
  }

  if (
    normalized.includes('spam') ||
    normalized.includes('junk') ||
    normalized.includes('bulk mail')
  ) {
    return 'spam';
  }

  if (
    normalized.includes('trash') ||
    normalized.includes('deleted') ||
    normalized.includes('bin')
  ) {
    return 'trash';
  }

  if (
    normalized.includes('all mail') ||
    normalized.includes('archive') ||
    normalized === 'all'
  ) {
    return 'archive';
  }

  return 'custom';
}

function resolveImapFolderType(folder: {
  path?: string;
  specialUse?: string | null;
  flags?: Set<string> | string[] | null;
}): ResolvedMailboxFolderType {
  const specialUse = normalizeToken(folder.specialUse || '').replace(/^\\+/, '');
  if (specialUse) {
    const mapped = IMAP_SPECIAL_USE_TO_TYPE[`\\${specialUse}`];
    if (mapped) return mapped;
  }

  const flags = folder.flags ? Array.from(folder.flags as Iterable<string>) : [];
  for (const flag of flags) {
    const normalizedFlag = normalizeToken(flag).replace(/^\\+/, '');
    const mapped = IMAP_SPECIAL_USE_TO_TYPE[`\\${normalizedFlag}`];
    if (mapped) return mapped;
  }

  return resolveFolderTypeFromName(folder.path || '');
}

function resolveOutlookFolderType(
  displayName: string,
  wellKnownName?: string,
): ResolvedMailboxFolderType {
  const normalizedWellKnown = normalizeToken(wellKnownName || '').replace(
    /\s+/g,
    '',
  );
  if (normalizedWellKnown) {
    const mapped = OUTLOOK_WELL_KNOWN_NAME_TO_TYPE[normalizedWellKnown];
    if (mapped) return mapped;
  }

  return resolveFolderTypeFromName(displayName);
}

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

class KillSwitchActivatedError extends Error {
  constructor(
    readonly flag: 'DISABLE_IMAP_SYNC',
    readonly stage: string,
  ) {
    super(`${flag} active at ${stage}`);
  }
}

@Processor(EMAIL_SYNC_QUEUE, {
  concurrency: 2,
})
export class EmailSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailSyncProcessor.name);
  private readonly adaptiveThrottle = new EmailSyncAdaptiveThrottle();
  private readonly interactiveImapClientTtlMs = 45_000;
  private readonly interactiveImapClients = new Map<
    string,
    {
      authHash: string;
      client: ImapFlow;
      expiresAt: number;
      busy: boolean;
    }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly featureFlags: FeatureFlagsService,
    @Optional()
    @Inject(CrmService)
    private readonly crmService: CrmService | null,
    @Optional()
    @Inject(EventsGateway)
    private readonly eventsGateway: EventsGateway | null,
    @Optional()
    @Inject(RulesEngineService)
    private readonly rulesEngine: RulesEngineService | null,
    @Optional()
    @Inject(AiCategorizationService)
    private readonly aiCategorizationService: AiCategorizationService | null,
    @Optional()
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService | null,
    private readonly attachmentStorage: AttachmentStorageService,
  ) {
    super();
  }

  async process(job: Job<EmailSyncJobData>): Promise<void> {
    await this.runMailboxSync({
      mailboxId: job.data.mailboxId,
      organizationId: job.data.organizationId,
      streamingMode: job.data.streamingMode ?? false,
      folderTypeHints: job.data.folderTypeHints,
      options: {
        interactive: false,
        reconcileDeletions: false,
      },
    });
  }

  async refreshMailboxInteractive(params: {
    mailboxId: string;
    organizationId: string;
    folderTypeHints?: EmailSyncJobData['folderTypeHints'];
    reconcileDeletions?: boolean;
  }): Promise<{
    mailboxId: string;
    durationMs: number;
    folderTypeHints: string[];
    timings: MailboxSyncTimingSummary;
  }> {
    const startedAt = Date.now();
    const timings = await this.runMailboxSync({
      mailboxId: params.mailboxId,
      organizationId: params.organizationId,
      streamingMode: false,
      folderTypeHints: params.folderTypeHints,
      options: {
        interactive: true,
        reconcileDeletions: params.reconcileDeletions ?? true,
      },
    });

    return {
      mailboxId: params.mailboxId,
      durationMs: Date.now() - startedAt,
      folderTypeHints: Array.isArray(params.folderTypeHints)
        ? params.folderTypeHints
        : [],
      timings,
    };
  }

  private async runMailboxSync(params: {
    mailboxId: string;
    organizationId: string;
    streamingMode: boolean;
    folderTypeHints?: EmailSyncJobData['folderTypeHints'];
    options: SyncExecutionOptions;
  }): Promise<MailboxSyncTimingSummary> {
    const { mailboxId, organizationId, streamingMode } = params;
    const adaptiveBucketKey = this.adaptiveBucketKey(mailboxId);
    const runStartedAt = Date.now();
    const timings: MailboxSyncTimingSummary = {
      mailboxLookupMs: 0,
      credentialPrepMs: 0,
      connectMs: 0,
      syncFoldersMs: 0,
      finalizeMs: 0,
      totalMs: 0,
      folderTimings: [],
    };
    this.logger.log(
      `[email-sync] mailbox=${mailboxId} org=${organizationId} streaming=${streamingMode ?? false} interactive=${params.options.interactive ?? false} reconcileDeletions=${params.options.reconcileDeletions ?? false}`,
    );
    if (this.featureFlags.get('DISABLE_IMAP_SYNC')) {
      await this.markMailboxSyncSkippedByKillSwitch(
        mailboxId,
        organizationId,
        'IMAP sync skipped because DISABLE_IMAP_SYNC is active',
      );
      timings.totalMs = Date.now() - runStartedAt;
      return timings;
    }
    if (!params.options.interactive) {
      await this.awaitAdaptiveThrottle(adaptiveBucketKey, mailboxId, 'job-start');
    }

    const mailboxLookupStartedAt = Date.now();
    const mailbox = await this.prisma.mailbox.findUnique({
      where: { id: mailboxId },
    });
    timings.mailboxLookupMs = Date.now() - mailboxLookupStartedAt;

    if (!mailbox || mailbox.organizationId !== organizationId || mailbox.deletedAt) {
      this.logger.warn(
        `[email-sync] Mailbox ${mailboxId} not found — skipping`,
      );
      timings.totalMs = Date.now() - runStartedAt;
      return timings;
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
      timings.totalMs = Date.now() - runStartedAt;
      return timings;
    }

    let imapPass: string | null = null;
    let oauthAccessToken: string | null = null;
    const credentialPrepStartedAt = Date.now();

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
      timings.totalMs = Date.now() - runStartedAt;
      return timings;
    }
    timings.credentialPrepMs = Date.now() - credentialPrepStartedAt;

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

    if (!params.options.interactive) {
      this.eventsGateway?.emitToOrganization(organizationId, 'mailbox:synced', {
        mailboxId,
        organizationId,
        syncStatus: 'SYNCING',
      });
    }

    const enableOutlookGraphSync =
      String(process.env.ENABLE_OUTLOOK_GRAPH_SYNC ?? 'true')
        .trim()
        .toLowerCase() === 'true';

    if (
      enableOutlookGraphSync &&
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
        this.adaptiveThrottle.recordSuccess(
          adaptiveBucketKey,
          this.adaptiveOptions(),
        );
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

        timings.totalMs = Date.now() - runStartedAt;
        return timings;
      }
      this.logger.warn(
        `[email-sync] mailbox=${mailboxId} Microsoft Graph sync unavailable, falling back to IMAP OAuth flow`,
      );
    } else if (
      !enableOutlookGraphSync &&
      mailbox.provider === 'OUTLOOK' &&
      mailbox.oauthProvider === 'microsoft' &&
      oauthAccessToken
    ) {
      this.logger.log(
        `[email-sync] mailbox=${mailboxId} Outlook Graph sync disabled; using IMAP OAuth flow`,
      );
    }

    const interactiveClientKey = `${mailboxId}:${imapHost}:${mailbox.imapPort ?? 993}:${mailbox.imapSecure ? 'secure' : 'plain'}`;
    const authHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(authConfig))
      .digest('hex');
    const acquiredClient = await this.acquireImapClient({
      interactive: Boolean(params.options.interactive),
      mailboxId,
      clientKey: interactiveClientKey,
      authHash,
      clientFactory: () =>
        new ImapFlow({
          host: imapHost,
          port: mailbox.imapPort ?? 993,
          secure: mailbox.imapSecure,
          auth: authConfig,
          logger: false,
        }),
      providerSyncPolicy,
      stage: 'imap-connect',
    });
    const client = acquiredClient.client;
    timings.connectMs = acquiredClient.connectMs;

    try {
      const syncFoldersStartedAt = Date.now();
      timings.folderTimings = await this.syncAllFolders(
        client,
        mailboxId,
        organizationId,
        streamingMode ?? false,
        providerSyncPolicy,
        params.folderTypeHints,
        params.options,
      );
      timings.syncFoldersMs = Date.now() - syncFoldersStartedAt;
      this.adaptiveThrottle.recordSuccess(
        adaptiveBucketKey,
        this.adaptiveOptions(),
      );

      const finalizeStartedAt = Date.now();
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
      timings.finalizeMs = Date.now() - finalizeStartedAt;
      timings.totalMs = Date.now() - runStartedAt;
      return timings;
    } catch (err) {
      if (err instanceof KillSwitchActivatedError) {
        await this.markMailboxSyncSkippedByKillSwitch(
          mailboxId,
          organizationId,
          `IMAP sync skipped at ${err.stage} because ${err.flag} is active`,
        );
        timings.totalMs = Date.now() - runStartedAt;
        return timings;
      }

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
      timings.totalMs = Date.now() - runStartedAt;
      acquiredClient.invalidate();
      throw err;
    } finally {
      await acquiredClient.release();
    }
  }

  private async acquireImapClient(input: {
    interactive: boolean;
    mailboxId: string;
    clientKey: string;
    authHash: string;
    clientFactory: () => ImapFlow;
    providerSyncPolicy: EmailSyncProviderPolicy;
    stage: string;
  }): Promise<{
    client: ImapFlow;
    connectMs: number;
    release: () => Promise<void>;
    invalidate: () => void;
  }> {
    if (input.interactive) {
      const existing = this.interactiveImapClients.get(input.clientKey);
      const now = Date.now();
      if (
        existing &&
        !existing.busy &&
        existing.authHash === input.authHash &&
        existing.expiresAt > now
      ) {
        existing.busy = true;
        return {
          client: existing.client,
          connectMs: 0,
          release: async () => {
            const latest = this.interactiveImapClients.get(input.clientKey);
            if (latest && latest.client === existing.client) {
              latest.busy = false;
              latest.expiresAt = Date.now() + this.interactiveImapClientTtlMs;
            }
          },
          invalidate: () => {
            const latest = this.interactiveImapClients.get(input.clientKey);
            if (latest && latest.client === existing.client) {
              this.interactiveImapClients.delete(input.clientKey);
              void latest.client.logout().catch(() => undefined);
            }
          },
        };
      }

      if (existing && (existing.authHash !== input.authHash || existing.expiresAt <= now)) {
        this.interactiveImapClients.delete(input.clientKey);
        void existing.client.logout().catch(() => undefined);
      }
    }

    const client = input.clientFactory();
    const connectStartedAt = Date.now();
    await this.acquireProviderRequestSlot(
      input.mailboxId,
      input.providerSyncPolicy,
      input.stage,
      { interactive: input.interactive },
    );
    await client.connect();
    const connectMs = Date.now() - connectStartedAt;

    if (!input.interactive) {
      return {
        client,
        connectMs,
        release: async () => {
          await client.logout().catch(() => undefined);
        },
        invalidate: () => {
          void client.logout().catch(() => undefined);
        },
      };
    }

    this.interactiveImapClients.set(input.clientKey, {
      authHash: input.authHash,
      client,
      expiresAt: Date.now() + this.interactiveImapClientTtlMs,
      busy: true,
    });

    return {
      client,
      connectMs,
      release: async () => {
        const latest = this.interactiveImapClients.get(input.clientKey);
        if (latest && latest.client === client) {
          latest.busy = false;
          latest.expiresAt = Date.now() + this.interactiveImapClientTtlMs;
        } else {
          await client.logout().catch(() => undefined);
        }
      },
      invalidate: () => {
        const latest = this.interactiveImapClients.get(input.clientKey);
        if (latest && latest.client === client) {
          this.interactiveImapClients.delete(input.clientKey);
        }
        void client.logout().catch(() => undefined);
      },
    };
  }

  private async acquireProviderRequestSlot(
    mailboxId: string,
    providerSyncPolicy: EmailSyncProviderPolicy,
    stage = 'provider-slot',
    options?: SyncExecutionOptions,
  ): Promise<void> {
    if (this.featureFlags.get('DISABLE_IMAP_SYNC')) {
      throw new KillSwitchActivatedError('DISABLE_IMAP_SYNC', stage);
    }

    if (!options?.interactive) {
      await this.awaitAdaptiveThrottle(
        this.adaptiveBucketKey(mailboxId),
        mailboxId,
        stage,
      );
    }
    await sharedEmailSyncRateLimiter.acquire(
      providerSyncPolicy.key,
      providerSyncPolicy,
    );
  }

  private adaptiveBucketKey(mailboxId: string): string {
    return `email-sync:${mailboxId}`;
  }

  private adaptiveOptions(): EmailSyncAdaptiveThrottleOptions {
    return {
      enableBackpressure: this.featureFlags.isEnabled('ENABLE_BACKPRESSURE'),
      enableSmartBackoff: this.featureFlags.isEnabled('ENABLE_SMART_BACKOFF'),
      backpressure: {
        highWatermark: this.readNumberConfig(
          'backpressure.heapHighWatermark',
          0.85,
        ),
        recoveryWatermark: this.readNumberConfig(
          'backpressure.heapRecoveryWatermark',
          0.7,
        ),
        minDelayMs: Math.max(
          0,
          Math.round(
            this.readNumberConfig('backpressure.minDelayMs', STREAM_DELAY_MS),
          ),
        ),
        maxDelayMs: Math.max(
          0,
          Math.round(this.readNumberConfig('backpressure.maxDelayMs', 2000)),
        ),
      },
      smartBackoff: {
        baseDelayMs: Math.max(
          1,
          Math.round(this.readNumberConfig('smartBackoff.baseDelayMs', 100)),
        ),
        maxDelayMs: Math.max(
          1,
          Math.round(this.readNumberConfig('smartBackoff.maxDelayMs', 5000)),
        ),
        windowSize: Math.max(
          1,
          Math.round(this.readNumberConfig('smartBackoff.windowSize', 20)),
        ),
        errorRateWeight: Math.max(
          0,
          this.readNumberConfig('smartBackoff.errorRateWeight', 4),
        ),
        consecutiveWeight: Math.max(
          0,
          this.readNumberConfig('smartBackoff.consecutiveWeight', 1),
        ),
      },
    };
  }

  private readNumberConfig(path: string, fallback: number): number {
    const raw = this.configService.get<number | string | undefined>(path);
    if (raw === undefined || raw === null || raw === '') return fallback;

    const parsed =
      typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private async awaitAdaptiveThrottle(
    adaptiveBucketKey: string,
    mailboxId: string,
    stage: string,
  ): Promise<number> {
    const delay = this.adaptiveThrottle.computeDelay(
      adaptiveBucketKey,
      this.adaptiveOptions(),
    );

    if (delay.totalDelayMs > 0) {
      this.logger.debug(
        `[email-sync] mailbox=${mailboxId} stage=${stage} adaptiveDelayMs=${delay.totalDelayMs} backpressure=${delay.backpressureDelayMs} smart=${delay.smartBackoffDelayMs} heapRatio=${delay.heapRatio.toFixed(3)}`,
      );
      await sleep(delay.totalDelayMs);
    }

    return delay.totalDelayMs;
  }

  private async applyChunkDelay(
    adaptiveBucketKey: string,
    mailboxId: string,
    streamingMode: boolean,
    stage: string,
    options?: SyncExecutionOptions,
  ): Promise<void> {
    if (options?.interactive) {
      return;
    }
    const adaptiveDelayMs = this.adaptiveThrottle.computeDelay(
      adaptiveBucketKey,
      this.adaptiveOptions(),
    ).totalDelayMs;
    const totalDelayMs = Math.max(streamingMode ? STREAM_DELAY_MS : 0, adaptiveDelayMs);

    if (totalDelayMs > 0) {
      this.logger.debug(
        `[email-sync] mailbox=${mailboxId} stage=${stage} chunkDelayMs=${totalDelayMs}`,
      );
      await sleep(totalDelayMs);
    }
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
    const normalizedErrorMessage = String(errorMessage || 'Sync failed');
    const isLegacyMicrosoftScopeFalsePositive =
      normalizedErrorMessage.includes(
        'Microsoft mailbox does not have mail API scope yet',
      );

    if (isLegacyMicrosoftScopeFalsePositive) {
      this.logger.warn(
        `[email-sync] mailbox=${mailboxId} ignoring legacy Microsoft scope false-positive failure`,
      );
      await this.prisma.mailbox.update({
        where: { id: mailboxId },
        data: {
          syncStatus: 'PENDING',
          healthStatus: 'degraded',
          nextRetryAt: new Date(Date.now() + 5 * 60 * 1000),
          lastSyncError: null,
        },
      });
      this.eventsGateway?.emitToOrganization(organizationId, 'mailbox:synced', {
        mailboxId,
        organizationId,
        syncStatus: 'PENDING',
      });
      return;
    }

    const adaptiveBucketKey = this.adaptiveBucketKey(mailboxId);
    const adaptiveOptions = this.adaptiveOptions();
    this.adaptiveThrottle.recordFailure(adaptiveBucketKey, adaptiveOptions);

    const current = await this.prisma.mailbox.findUnique({
      where: { id: mailboxId },
      select: { syncErrorCount: true },
    });
    const newErrorCount = (current?.syncErrorCount ?? 0) + 1;
    const baseBackoffMinutes = Math.min(Math.pow(2, newErrorCount), 60);
    const smartBackoffDelayMs = adaptiveOptions.enableSmartBackoff
      ? this.adaptiveThrottle.computeDelay(adaptiveBucketKey, adaptiveOptions)
          .smartBackoffDelayMs
      : 0;
    const smartBackoffMinutes =
      smartBackoffDelayMs > 0 ? Math.ceil(smartBackoffDelayMs / 60000) : 0;
    const backoffMinutes = Math.min(
      60,
      Math.max(baseBackoffMinutes, smartBackoffMinutes),
    );
    const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

    await this.prisma.mailbox.update({
      where: { id: mailboxId },
      data: {
        syncStatus: 'FAILED',
        healthStatus: 'failed',
        syncErrorCount: { increment: 1 },
        nextRetryAt,
        lastSyncError: normalizedErrorMessage,
      },
    });

    this.eventsGateway?.emitToOrganization(organizationId, 'mailbox:synced', {
      mailboxId,
      organizationId,
      syncStatus: 'FAILED',
    });
  }

  private async markMailboxSyncSkippedByKillSwitch(
    mailboxId: string,
    organizationId: string,
    message: string,
  ): Promise<void> {
    this.logger.warn(
      `[email-sync] mailbox=${mailboxId} org=${organizationId} ${message}`,
    );

    await this.prisma.mailbox
      .update({
        where: { id: mailboxId },
        data: {
          syncStatus: 'FAILED',
          nextRetryAt: null,
          lastSyncError: message,
        },
      })
      .catch(() => undefined);

    this.eventsGateway?.emitToOrganization(organizationId, 'mailbox:synced', {
      mailboxId,
      organizationId,
      syncStatus: 'FAILED',
    });
  }

  private isThreadingDisabled(mailboxId: string, stage: string): boolean {
    if (!this.featureFlags.get('DISABLE_THREADING')) {
      return false;
    }

    this.logger.warn(
      `[email-sync] DISABLE_THREADING active; skipped ${stage} mailbox=${mailboxId}`,
    );
    return true;
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
    const adaptiveBucketKey = this.adaptiveBucketKey(mailboxId);
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
      const candidateHeaders =
        candidate.name === 'graph'
          ? { ...apiHeaders, Prefer: 'IdType="ImmutableId"' }
          : apiHeaders;
      const folderRows: Array<{
        id: string;
        displayName: string;
        wellKnownName?: string;
      }> = [];
      const folderEndpoints =
        candidate.name === 'graph'
          ? [
              candidate.folderUrl(pageSize),
              `https://graph.microsoft.com/v1.0/me/mailFolders?$top=${pageSize}`,
            ]
          : [candidate.folderUrl(pageSize)];
      let foldersFetched = false;

      for (const folderEndpoint of folderEndpoints) {
        try {
          for await (const folderPage of this.iterateOutlookApiCollection<{
            id?: string;
            displayName?: string;
            wellKnownName?: string;
            Id?: string;
            DisplayName?: string;
            WellKnownName?: string;
          }>(
            mailboxId,
            folderEndpoint,
            candidateHeaders,
            providerSyncPolicy,
          )) {
            folderRows.push(
              ...folderPage
                .map((folder) => ({
                  id: String(folder.id ?? folder.Id ?? '').trim(),
                  displayName: String(
                    folder.displayName ?? folder.DisplayName ?? '',
                  ).trim(),
                  wellKnownName: String(
                    folder.wellKnownName ?? folder.WellKnownName ?? '',
                  ).trim(),
                }))
                .filter((folder) => folder.id && folder.displayName),
            );
          }
          foldersFetched = true;
          break;
        } catch (err) {
          if (err instanceof KillSwitchActivatedError) {
            throw err;
          }
          const { status, body } = this.outlookApiErrorDetails(err);
          this.logger.warn(
            `[email-sync] ${candidate.name} folders read failed mailbox=${mailboxId} endpoint=${folderEndpoint} status=${status}: ${body.slice(0, 260)}`,
          );
        }
      }

      if (!foldersFetched) {
        continue;
      }

      if (folderRows.length === 0) {
        this.logger.warn(
          `[email-sync] ${candidate.name} returned no folders for mailbox=${mailboxId}`,
        );
        continue;
      }

      const resolvedFolders = folderRows.map((folder) => ({
        id: folder.id,
        displayName: folder.displayName,
        folderType: resolveOutlookFolderType(
          folder.displayName,
          folder.wellKnownName,
        ),
      }));

      for (const folder of resolvedFolders) {
        await this.upsertMailboxFolderMetadata(
          mailboxId,
          folder.displayName,
          folder.folderType,
        );
      }

      const selectedFolders = resolvedFolders.filter((folder) =>
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

        try {
          for await (const messagePage of this.iterateOutlookApiCollection<
            Record<string, unknown>
          >(
            mailboxId,
            candidate.messagesUrl(folder.id, pageSize),
            candidateHeaders,
            providerSyncPolicy,
          )) {
            const chunks = streamingMode
              ? chunkArray(messagePage, STREAM_CHUNK_SIZE)
              : [messagePage];

            for (const chunk of chunks) {
              for (const message of chunk) {
                await this.upsertOutlookApiMessage(
                  message,
                  mailboxId,
                  organizationId,
                  mailboxFolder.id,
                  folder.folderType,
                  candidate.name as 'graph' | 'outlook-rest',
                  candidateHeaders,
                  providerSyncPolicy,
                );
              }
              await this.applyChunkDelay(
                adaptiveBucketKey,
                mailboxId,
                streamingMode,
                'outlook-message-chunk',
              );
            }
          }
        } catch (err) {
          if (err instanceof KillSwitchActivatedError) {
            throw err;
          }
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

        const counters = await this.refreshMailboxFolderCounters(
          mailboxFolder.id,
        );
        await this.prisma.mailboxFolder.update({
          where: { id: mailboxFolder.id },
          data: {
            syncStatus: 'SUCCESS',
            lastSyncedAt: new Date(),
            messageCount: counters.messageCount,
            unreadCount: counters.unreadCount,
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
    mailboxId: string,
    initialUrl: string,
    headers: Record<string, string>,
    providerSyncPolicy: EmailSyncProviderPolicy,
  ): AsyncGenerator<T[]> {
    let nextUrl: string | null = initialUrl;

    while (nextUrl) {
      await this.acquireProviderRequestSlot(
        mailboxId,
        providerSyncPolicy,
        'outlook-page',
      );
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
    const message =
      err instanceof Error ? err.message : String((err as any)?.message || '');
    return {
      status: String(error.status ?? 'unknown'),
      body: String(error.body ?? message ?? ''),
    };
  }

  private async upsertOutlookApiMessage(
    message: Record<string, unknown>,
    mailboxId: string,
    organizationId: string,
    folderId: string,
    folderType: string,
    apiVariant: 'graph' | 'outlook-rest',
    apiHeaders: Record<string, string>,
    providerSyncPolicy: EmailSyncProviderPolicy,
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
    const rawMessageIdHeader = String(
      message.internetMessageId ??
        message.InternetMessageId ??
        providerMessageId,
    ).trim();
    const messageIdHeader =
      normalizeRfcMessageId(rawMessageIdHeader) || rawMessageIdHeader;
    const candidateMessageIds = Array.from(
      new Set(
        [providerMessageId, rawMessageIdHeader, messageIdHeader]
          .map((value) => String(value || '').trim())
          .filter((value) => value.length > 0),
      ),
    );

    if (this.isThreadingDisabled(mailboxId, 'outlook-thread-match-create')) {
      return false;
    }

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
    const isDraft =
      Boolean(message.isDraft ?? message.IsDraft) || folderType === 'drafts';
    const direction: 'INBOUND' | 'OUTBOUND' =
      folderType === 'sent' ? 'OUTBOUND' : 'INBOUND';
    const hasAttachmentsFlag = Boolean(
      message.hasAttachments ?? message.HasAttachments,
    );
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

    const existing = await this.prisma.message.findFirst({
      where: { mailboxId, messageId: { in: candidateMessageIds } },
      select: { id: true, hasAttachments: true },
    });
    if (existing) {
      if (direction === 'OUTBOUND') {
        const placeholder = await this.findOutboundPlaceholderMessage({
          mailboxId,
          subject,
          fromEmail,
          toAddresses,
          createdAt: receivedAt,
          bodyText,
          bodyHtml,
        });
        if (placeholder && placeholder.id !== existing.id) {
          await this.prisma.attachment.updateMany({
            where: { messageId: placeholder.id },
            data: { messageId: existing.id },
          });
          if (placeholder.hasAttachments && !existing.hasAttachments) {
            await this.prisma.message.updateMany({
              where: { id: existing.id, hasAttachments: false },
              data: { hasAttachments: true },
            });
          }
          await this.deleteMissingProviderMessages(organizationId, [
            { id: placeholder.id, threadId: placeholder.threadId },
          ]);
        }
      }
      await this.reconcileDuplicateMessageEntriesByMessageId(
        mailboxId,
        organizationId,
        messageIdHeader,
        existing.id,
      );
      if (hasAttachmentsFlag) {
        await this.ingestOutlookApiAttachments({
          messageId: existing.id,
          organizationId,
          mailboxId,
          providerMessageId,
          apiVariant,
          apiHeaders,
          providerSyncPolicy,
          fallbackMessageId: messageIdHeader || providerMessageId,
        });
      }
      return false;
    }

    if (direction === 'OUTBOUND') {
      const placeholder = await this.findOutboundPlaceholderMessage({
        mailboxId,
        subject,
        fromEmail,
        toAddresses,
        createdAt: receivedAt,
        bodyText,
        bodyHtml,
      });

      if (placeholder) {
        await this.prisma.message.update({
          where: { id: placeholder.id },
          data: {
            folder: { connect: { id: folderId } },
            messageId: messageIdHeader || providerMessageId,
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
            hasAttachments:
              placeholder.hasAttachments || hasAttachmentsFlag,
            isDraft,
            direction,
            inReplyTo: null,
            createdAt: Number.isNaN(receivedAt.getTime())
              ? placeholder.createdAt
              : receivedAt,
          },
        });

        await this.reconcileDuplicateMessageEntriesByMessageId(
          mailboxId,
          organizationId,
          messageIdHeader,
          placeholder.id,
        );
        if (hasAttachmentsFlag || placeholder.hasAttachments) {
          await this.ingestOutlookApiAttachments({
            messageId: placeholder.id,
            organizationId,
            mailboxId,
            providerMessageId,
            apiVariant,
            apiHeaders,
            providerSyncPolicy,
            fallbackMessageId: messageIdHeader || providerMessageId,
          });
        }

        return false;
      }
    }

    const thread = await this.findOrCreateThread(
      organizationId,
      mailboxId,
      subject,
      messageIdHeader,
      undefined,
      [],
      fromEmail,
      fromName,
    );

    const snippetSource = (
      bodyText || (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, ' ') : '')
    ).trim();
    const snippet = snippetSource
      ? `${snippetSource.replace(/\s+/g, ' ').slice(0, 200)}${fromName ? ` — ${fromName}` : ''}`
      : null;

    const createdMessage = await this.prisma.message.create({
      data: {
        thread: { connect: { id: thread.id } },
        mailbox: { connect: { id: mailboxId } },
        folder: { connect: { id: folderId } },
        messageId: messageIdHeader || providerMessageId,
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
        hasAttachments: hasAttachmentsFlag,
        isInternalNote: false,
        isDraft,
        direction,
        inReplyTo: null,
        snippet,
        createdAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
      },
      select: { id: true },
    });

    if (direction === 'INBOUND') {
      await this.evaluateRulesForInboundMessage({
        organizationId,
        threadId: thread.id,
        fromEmail,
        toAddresses,
        ccAddresses,
        subject,
        bodyText,
        bodyHtml,
        hasAttachments: hasAttachmentsFlag,
      });
      await this.categorizeInboundMessage({
        organizationId,
        mailboxId,
        threadId: thread.id,
        messageId: createdMessage.id,
        fromEmail,
        toAddresses,
        ccAddresses,
        subject,
        bodyText,
        bodyHtml,
        hasAttachments: hasAttachmentsFlag,
      });
    }

    if (hasAttachmentsFlag) {
      await this.ingestOutlookApiAttachments({
        messageId: createdMessage.id,
        organizationId,
        mailboxId,
        providerMessageId,
        apiVariant,
        apiHeaders,
        providerSyncPolicy,
        fallbackMessageId: messageIdHeader || providerMessageId,
      });
    }

    this.eventsGateway?.emitToOrganization(organizationId, 'thread:updated', {
      threadId: thread.id,
      mailboxId,
      type: 'new_message',
    });

    this.eventsGateway?.emitToOrganization(organizationId, 'message:new', {
      id: createdMessage.id,
      threadId: thread.id,
      mailboxId,
      direction,
      subject,
      createdAt: receivedAt.toISOString(),
    });

    this.eventsGateway?.emitToOrganization(organizationId, 'new_message', {
      id: createdMessage.id,
      threadId: thread.id,
      mailboxId,
      direction,
      subject,
      createdAt: receivedAt.toISOString(),
    });

    if (direction === 'INBOUND') {
      await this.dispatchInboundNewMessageNotifications({
        organizationId,
        mailboxId,
        threadId: thread.id,
        messageId: createdMessage.id,
        fromEmail,
        fromName,
        subject,
        receivedAt,
      });
    }

    if (this.crmService && thread.contactId) {
      await this.crmService.emitContactActivity({
        organizationId,
        contactId: thread.contactId,
        activity: direction === 'INBOUND' ? 'email_received' : 'email_sent',
        threadId: thread.id,
        mailboxId,
        messageId: createdMessage.id,
      });
    }

    await this.reconcileDuplicateMessageEntriesByMessageId(
      mailboxId,
      organizationId,
      messageIdHeader,
      createdMessage.id,
    );

    return true;
  }

  private async fetchOutlookApiMessageSource(
    mailboxId: string,
    providerMessageId: string,
    apiVariant: 'graph' | 'outlook-rest',
    apiHeaders: Record<string, string>,
    providerSyncPolicy: EmailSyncProviderPolicy,
  ): Promise<Buffer | null> {
    const sourceUrl =
      apiVariant === 'graph'
        ? `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(
            providerMessageId,
          )}/$value`
        : `https://outlook.office.com/api/v2.0/me/messages/${encodeURIComponent(
            providerMessageId,
          )}/$value`;
    await this.acquireProviderRequestSlot(
      mailboxId,
      providerSyncPolicy,
      'outlook-message-source',
    );
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          Authorization: apiHeaders.Authorization,
          Accept: 'message/rfc822',
        },
      });
      if (!response.ok) {
        return null;
      }
      const source = Buffer.from(await response.arrayBuffer());
      return source.length > 0 ? source : null;
    } catch {
      return null;
    }
  }

  private async fetchOutlookApiAttachmentPayloads(
    mailboxId: string,
    providerMessageId: string,
    apiVariant: 'graph' | 'outlook-rest',
    apiHeaders: Record<string, string>,
    providerSyncPolicy: EmailSyncProviderPolicy,
  ): Promise<
    Array<{
      filename: string;
      contentType: string | null;
      content: Buffer;
    }>
  > {
    const attachmentsUrl =
      apiVariant === 'graph'
        ? `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/attachments?$top=50`
        : `https://outlook.office.com/api/v2.0/me/messages/${encodeURIComponent(providerMessageId)}/attachments?$top=50`;

    const payloads: Array<{
      filename: string;
      contentType: string | null;
      content: Buffer;
    }> = [];

    for await (const attachmentPage of this.iterateOutlookApiCollection<
      Record<string, unknown>
    >(mailboxId, attachmentsUrl, apiHeaders, providerSyncPolicy)) {
      for (const attachment of attachmentPage) {
        const typeTag = String(
          attachment['@odata.type'] ?? attachment.Type ?? '',
        ).toLowerCase();
        const isFileAttachment =
          typeTag.includes('fileattachment') ||
          String(attachment.type ?? attachment.Type ?? '').toLowerCase() ===
            'fileattachment';
        if (!isFileAttachment) {
          continue;
        }

        const filename = String(
          attachment.name ?? attachment.Name ?? 'attachment.bin',
        ).trim();
        const contentTypeRaw = String(
          attachment.contentType ?? attachment.ContentType ?? '',
        ).trim();
        const contentType = contentTypeRaw || null;
        let contentBase64 = String(
          attachment.contentBytes ?? attachment.ContentBytes ?? '',
        ).trim();

        if (!contentBase64) {
          const attachmentId = String(
            attachment.id ?? attachment.Id ?? '',
          ).trim();
          if (!attachmentId) {
            continue;
          }
          const detailUrl =
            apiVariant === 'graph'
              ? `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(attachmentId)}`
              : `https://outlook.office.com/api/v2.0/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(attachmentId)}`;
          await this.acquireProviderRequestSlot(
            mailboxId,
            providerSyncPolicy,
            'outlook-attachment-detail',
          );
          const detailResponse = await fetch(detailUrl, { headers: apiHeaders });
          if (detailResponse.ok) {
            const detailPayload =
              (await detailResponse.json()) as Record<string, unknown>;
            contentBase64 = String(
              detailPayload.contentBytes ?? detailPayload.ContentBytes ?? '',
            ).trim();
          }
        }

        if (!contentBase64) {
          continue;
        }

        let content: Buffer;
        try {
          content = Buffer.from(contentBase64, 'base64');
        } catch {
          continue;
        }
        if (content.length === 0) {
          continue;
        }

        payloads.push({
          filename: filename || 'attachment.bin',
          contentType,
          content,
        });
      }
    }

    return payloads;
  }

  private async persistParsedAttachments(
    messageId: string,
    organizationId: string,
    parsedAttachments: Array<{
      filename: string;
      contentType: string | null;
      content: Buffer;
    }>,
  ): Promise<boolean> {
    if (!Array.isArray(parsedAttachments) || parsedAttachments.length === 0) {
      return false;
    }
    const existingAttachmentCount = await this.prisma.attachment.count({
      where: { messageId },
    });
    if (existingAttachmentCount > 0) {
      return true;
    }

    for (const parsedAttachment of parsedAttachments) {
      const filename = String(parsedAttachment.filename || 'attachment.bin').trim();
      const contentType =
        String(parsedAttachment.contentType || '').trim() || null;
      const content = parsedAttachment.content;
      if (!Buffer.isBuffer(content) || content.length === 0) {
        continue;
      }

      const storageKey = this.attachmentStorage.generateStorageKey(
        organizationId,
        filename,
      );
      await this.attachmentStorage.upload(
        storageKey,
        content,
        contentType || 'application/octet-stream',
      );
      await this.prisma.attachment.create({
        data: {
          messageId,
          filename,
          contentType,
          sizeBytes: Number(content.length || 0),
          storageKey,
        },
      });
    }

    return (
      (await this.prisma.attachment.count({
        where: { messageId },
      })) > 0
    );
  }

  private async ingestOutlookApiAttachments(input: {
    messageId: string;
    organizationId: string;
    mailboxId: string;
    providerMessageId: string;
    apiVariant: 'graph' | 'outlook-rest';
    apiHeaders: Record<string, string>;
    providerSyncPolicy: EmailSyncProviderPolicy;
    fallbackMessageId: string;
  }): Promise<boolean> {
    try {
      const payloads = await this.fetchOutlookApiAttachmentPayloads(
        input.mailboxId,
        input.providerMessageId,
        input.apiVariant,
        input.apiHeaders,
        input.providerSyncPolicy,
      );
      const ingestedFromApi = await this.persistParsedAttachments(
        input.messageId,
        input.organizationId,
        payloads,
      );
      if (ingestedFromApi) {
        await this.prisma.message.update({
          where: { id: input.messageId },
          data: { hasAttachments: true },
        });
        return true;
      }
    } catch (error) {
      const { status, body } = this.outlookApiErrorDetails(error);
      this.logger.warn(
        `[email-sync] outlook attachment ingest failed mailbox=${input.mailboxId} message=${input.providerMessageId} status=${status}: ${body.slice(0, 260)}`,
      );
    }

    const rawSource = await this.fetchOutlookApiMessageSource(
      input.mailboxId,
      input.providerMessageId,
      input.apiVariant,
      input.apiHeaders,
      input.providerSyncPolicy,
    );
    if (!rawSource) {
      return false;
    }
    await this.enrichInteractiveMessageContent(
      input.messageId,
      rawSource,
      input.fallbackMessageId,
      input.organizationId,
    );
    return (
      (await this.prisma.attachment.count({
        where: { messageId: input.messageId },
      })) > 0
    );
  }

  // ─── Multi-folder sync ────────────────────────────────────────────────────
  private async upsertMailboxFolderMetadata(
    mailboxId: string,
    folderName: string,
    folderType: ResolvedMailboxFolderType,
  ): Promise<void> {
    if (folderType === 'excluded') {
      const rows = await this.prisma.mailboxFolder.findMany({
        where: { mailboxId, name: folderName },
        select: { id: true },
      });
      for (const row of rows) {
        await this.prisma.message.updateMany({
          where: { folderId: row.id },
          data: { folderId: null },
        });
      }
      await this.prisma.mailboxFolder.deleteMany({
        where: {
          mailboxId,
          name: folderName,
        },
      });
      return;
    }

    const normalizedType = CANONICAL_FOLDER_TYPES.has(folderType)
      ? folderType
      : 'custom';

    const existing = await this.prisma.mailboxFolder.findFirst({
      where: { mailboxId, name: folderName },
      select: { id: true, type: true },
    });

    if (!existing) {
      await this.prisma.mailboxFolder.create({
        data: {
          mailbox: { connect: { id: mailboxId } },
          name: folderName,
          type: normalizedType,
          uidValidity: BigInt(1),
          uidNext: BigInt(1),
          syncStatus: 'PENDING',
        },
      });
      return;
    }

    if (existing.type !== normalizedType) {
      await this.prisma.mailboxFolder.update({
        where: { id: existing.id },
        data: { type: normalizedType },
      });
    }
  }

  private async refreshMailboxFolderCounters(folderId: string): Promise<{
    messageCount: number;
    unreadCount: number;
  }> {
    const [messageCount, unreadCount] = await Promise.all([
      this.prisma.message.count({
        where: { folderId, deletedAt: null },
      }),
      this.prisma.message.count({
        where: { folderId, deletedAt: null, isRead: false },
      }),
    ]);

    return { messageCount, unreadCount };
  }
  private async syncAllFolders(
    client: ImapFlow,
    mailboxId: string,
    organizationId: string,
    streamingMode: boolean,
    providerSyncPolicy: EmailSyncProviderPolicy,
    folderTypeHints?: EmailSyncJobData['folderTypeHints'],
    options: SyncExecutionOptions = {},
  ): Promise<FolderSyncTiming[]> {
    const adaptiveBucketKey = this.adaptiveBucketKey(mailboxId);
    const folderTimings: FolderSyncTiming[] = [];
    const targetedFolderTypesOrdered =
      Array.isArray(folderTypeHints) && folderTypeHints.length > 0
        ? folderTypeHints
        : null;
    const targetedFolderTypes = targetedFolderTypesOrdered
      ? new Set(targetedFolderTypesOrdered)
      : null;
    const inboxOnlyInteractiveRefresh =
      options.interactive &&
      Array.isArray(targetedFolderTypesOrdered) &&
      targetedFolderTypesOrdered.length === 1 &&
      targetedFolderTypesOrdered[0] === 'inbox';

    if (inboxOnlyInteractiveRefresh) {
      await this.upsertMailboxFolderMetadata(mailboxId, 'INBOX', 'inbox');
      folderTimings.push(
        await this.syncFolder(
          client,
          mailboxId,
          organizationId,
          'INBOX',
          'inbox',
          streamingMode,
          providerSyncPolicy,
          options,
        ),
      );
      return folderTimings;
    }

    // List all IMAP folders
    await this.acquireProviderRequestSlot(
      mailboxId,
      providerSyncPolicy,
      'imap-list-folders',
      options,
    );
    const folderList = await client.list();
    this.logger.log(
      `[email-sync] mailbox=${mailboxId} found ${folderList.length} IMAP folders`,
    );

    const discoveredFolders = folderList
      .map((folder) => {
        const path = String(folder.path || '').trim();
        return {
          path,
          type: resolveImapFolderType({
            path,
            specialUse: folder.specialUse,
            flags: folder.flags as Set<string> | string[] | null | undefined,
          }),
        };
      })
      .filter((folder) => folder.path.length > 0);

    for (const folder of discoveredFolders) {
      await this.upsertMailboxFolderMetadata(mailboxId, folder.path, folder.type);
    }

    const foldersToSync: Array<{ path: string; type: string }> = [];
    const seenPaths = new Set<string>();
    for (const folder of discoveredFolders) {
      if (!SYNC_FOLDER_TYPES.has(folder.type)) continue;
      if (targetedFolderTypes && !targetedFolderTypes.has(folder.type as any)) {
        continue;
      }
      if (seenPaths.has(folder.path)) continue;
      seenPaths.add(folder.path);
      foldersToSync.push({ path: folder.path, type: folder.type });
    }

    // Make sure INBOX is always present even if not returned by list()
    const shouldEnsureInbox =
      !targetedFolderTypes || targetedFolderTypes.has('inbox');
    if (shouldEnsureInbox && !foldersToSync.find((f) => f.path === 'INBOX')) {
      await this.upsertMailboxFolderMetadata(mailboxId, 'INBOX', 'inbox');
      foldersToSync.unshift({ path: 'INBOX', type: 'inbox' });
    }

    if (targetedFolderTypesOrdered) {
      const orderMap = new Map(
        targetedFolderTypesOrdered.map((type, index) => [type, index]),
      );
      foldersToSync.sort((left, right) => {
        const leftIndex = orderMap.get(left.type as any) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex =
          orderMap.get(right.type as any) ?? Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex) return leftIndex - rightIndex;
        return left.path.localeCompare(right.path);
      });
    }

    this.logger.log(
      `[email-sync] mailbox=${mailboxId} syncing folders: ${foldersToSync.map((f) => f.path).join(', ')}`,
    );

    for (const { path, type } of foldersToSync) {
      try {
        folderTimings.push(
          await this.syncFolder(
          client,
          mailboxId,
          organizationId,
          path,
          type,
          streamingMode,
          providerSyncPolicy,
          options,
          ),
        );
        this.adaptiveThrottle.recordSuccess(
          adaptiveBucketKey,
          this.adaptiveOptions(),
        );
      } catch (err) {
        this.adaptiveThrottle.recordFailure(
          adaptiveBucketKey,
          this.adaptiveOptions(),
        );
        if (err instanceof KillSwitchActivatedError) {
          throw err;
        }
        // Log but don't abort — continue with other folders
        this.logger.warn(
          `[email-sync] mailbox=${mailboxId} folder=${path} sync error: ${String(err)}`,
        );
      }
    }

    return folderTimings;
  }

  private async syncFolder(
    client: ImapFlow,
    mailboxId: string,
    organizationId: string,
    folderPath: string,
    folderType: string,
    streamingMode: boolean,
    providerSyncPolicy: EmailSyncProviderPolicy,
    options: SyncExecutionOptions = {},
  ): Promise<FolderSyncTiming> {
    const adaptiveBucketKey = this.adaptiveBucketKey(mailboxId);
    const folderStartedAt = Date.now();
    const timing: FolderSyncTiming = {
      path: folderPath,
      type: folderType,
      totalMs: 0,
      lockMs: 0,
      folderLookupMs: 0,
      deletionReconcileMs: 0,
      searchMs: 0,
      fetchMs: 0,
      upsertMs: 0,
      parseMs: 0,
      dedupeMs: 0,
      threadResolveMs: 0,
      createMs: 0,
      postIngestMs: 0,
      counterRefreshMs: 0,
      newMessageCount: 0,
      reconciledDeletedMessages: 0,
    };
    let lock: { release: () => void } | null = null;
    try {
      const lockStartedAt = Date.now();
      if (options.interactive) {
        const currentlySelectedPath = String(
          ((client as unknown as { mailbox?: { path?: string } }).mailbox?.path ||
            ''),
        );
        if (currentlySelectedPath !== folderPath) {
          await this.acquireProviderRequestSlot(
            mailboxId,
            providerSyncPolicy,
            `imap-open:${folderPath}`,
            options,
          );
          await client.mailboxOpen(folderPath, { readOnly: true });
        }
      } else {
        await this.acquireProviderRequestSlot(
          mailboxId,
          providerSyncPolicy,
          `imap-lock:${folderPath}`,
          options,
        );
        lock = await client.getMailboxLock(folderPath);
      }
      timing.lockMs = Date.now() - lockStartedAt;
    } catch (err) {
      if (err instanceof KillSwitchActivatedError) {
        throw err;
      }
      this.logger.warn(
        `[email-sync] mailbox=${mailboxId} could not lock folder=${folderPath}: ${String(err)}`,
      );
      timing.totalMs = Date.now() - folderStartedAt;
      return timing;
    }

    try {
      const folderLookupStartedAt = Date.now();
      let folder = await this.prisma.mailboxFolder.findFirst({
        where: { mailboxId, name: folderPath },
      });

      let serverStatus = client.mailbox as
        | { uidValidity?: number; uidNext?: number; exists?: number }
        | false;
      if (options.interactive) {
        const statusStartedAt = Date.now();
        await this.acquireProviderRequestSlot(
          mailboxId,
          providerSyncPolicy,
          `imap-status:${folderPath}`,
          options,
        );
        const liveStatus = await client.status(folderPath, {
          uidNext: true,
          uidValidity: true,
          messages: true,
          unseen: true,
        });
        serverStatus = {
          uidValidity: Number(liveStatus.uidValidity || 0) || undefined,
          uidNext: Number(liveStatus.uidNext || 0) || undefined,
          exists: Number(liveStatus.messages || 0) || 0,
        };
        timing.folderLookupMs += Date.now() - statusStartedAt;
      }
      const lastUidNext = folder?.uidNext ? Number(folder.uidNext) : 1;
      const serverUidNext =
        serverStatus && serverStatus.uidNext
          ? Number(serverStatus.uidNext)
          : null;
      const hasUidDrift =
        serverUidNext !== null &&
        Number.isFinite(serverUidNext) &&
        serverUidNext > 0 &&
        lastUidNext > serverUidNext;
      const effectiveLastUidNext = hasUidDrift ? 1 : lastUidNext;

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
      } else if (folder.type !== folderType) {
        // Keep folder type in sync when provider mapping changes.
        await this.prisma.mailboxFolder.update({
          where: { id: folder.id },
          data: { type: folderType },
        });
      }
      timing.folderLookupMs = Date.now() - folderLookupStartedAt;

      let messageUids: number[] = [];
      let reconciledDeletedMessages = 0;
      let reconciledDeletedUnreadCount = 0;

      if (
        !options.reconcileDeletions &&
        serverUidNext !== null &&
        Number.isFinite(serverUidNext) &&
        serverUidNext > 0 &&
        effectiveLastUidNext === serverUidNext
      ) {
        const counterRefreshStartedAt = Date.now();
        await this.prisma.mailboxFolder.update({
          where: { id: folder.id },
          data: {
            syncStatus: 'SUCCESS',
            lastSyncedAt: new Date(),
            uidNext: BigInt(serverUidNext),
            uidValidity:
              serverStatus && serverStatus.uidValidity
                ? BigInt(serverStatus.uidValidity)
                : folder.uidValidity,
          },
        });
        timing.counterRefreshMs = Date.now() - counterRefreshStartedAt;
        timing.totalMs = Date.now() - folderStartedAt;
        return timing;
      }

      if (options.reconcileDeletions) {
        const deletionReconcileStartedAt = Date.now();
        const providerExists = Number(
          (serverStatus && 'exists' in serverStatus
            ? (serverStatus as { exists?: number }).exists
            : 0) || 0,
        );
        const localMessageCount = await this.prisma.message.count({
          where: {
            mailboxId,
            folderId: folder.id,
            deletedAt: null,
          },
        });
        const shouldForceFullDeleteReconcile =
          Boolean(options.interactive) &&
          CANONICAL_FOLDER_TYPES.has(String(folderType || '').toLowerCase());
        const likelyHasProviderDeletes =
          shouldForceFullDeleteReconcile || providerExists < localMessageCount;

        if (likelyHasProviderDeletes) {
          const searchStartedAt = Date.now();
          await this.acquireProviderRequestSlot(
            mailboxId,
            providerSyncPolicy,
            `imap-search-full:${folderPath}`,
            options,
          );
          const fullScanSearch = await client.search(
            { all: true },
            { uid: true },
          );
          const providerUids = (Array.isArray(fullScanSearch)
            ? fullScanSearch
            : []
          )
            .filter((uid) => Number.isInteger(uid) && uid > 0)
            .sort((left, right) => left - right);
          const providerUidSet = new Set(providerUids);

          const localMessages = await this.prisma.message.findMany({
            where: {
              mailboxId,
              folderId: folder.id,
              deletedAt: null,
              imapUid: { not: null },
            },
            select: {
              id: true,
              threadId: true,
              imapUid: true,
              isRead: true,
            },
          });

          const localUidSet = new Set(
            localMessages
              .map((message) => Number(message.imapUid || 0))
              .filter((uid) => uid > 0),
          );

          const missingMessages = localMessages.filter((message) => {
            const uid = Number(message.imapUid || 0);
            return uid > 0 && !providerUidSet.has(uid);
          });

          if (missingMessages.length > 0) {
            const deletionResult = await this.deleteMissingProviderMessages(
              organizationId,
              missingMessages.map((message) => ({
                id: message.id,
                threadId: message.threadId,
              })),
            );
            reconciledDeletedMessages = deletionResult.deletedCount;
            reconciledDeletedUnreadCount = missingMessages.filter(
              (message) => !message.isRead,
            ).length;
          }

          messageUids = providerUids.filter((uid) => !localUidSet.has(uid));
          timing.searchMs += Date.now() - searchStartedAt;
        } else {
          const searchStartedAt = Date.now();
          await this.acquireProviderRequestSlot(
            mailboxId,
            providerSyncPolicy,
            `imap-search-incremental:${folderPath}`,
            options,
          );
          const incrementalSearch = await client.search(
            { uid: `${effectiveLastUidNext}:*` },
            { uid: true },
          );
          const incrementalUids = Array.isArray(incrementalSearch)
            ? incrementalSearch
            : [];
          messageUids = [...incrementalUids].sort((left, right) => left - right);
          timing.searchMs += Date.now() - searchStartedAt;
        }
        timing.deletionReconcileMs = Date.now() - deletionReconcileStartedAt;
      } else {
        try {
          if (options.interactive) {
            const uidFetchStartedAt = Date.now();
            await this.acquireProviderRequestSlot(
              mailboxId,
              providerSyncPolicy,
              `imap-fetch-uids:${folderPath}`,
              options,
            );
            const incrementalUids: number[] = [];
            for await (const msg of client.fetch(
              `${Math.max(effectiveLastUidNext, 1)}:*`,
              { uid: true },
              { uid: true },
            )) {
              if (Number.isInteger(msg.uid) && msg.uid > 0) {
                incrementalUids.push(msg.uid);
              }
            }
            messageUids = Array.from(new Set(incrementalUids)).sort(
              (left, right) => left - right,
            );
            timing.searchMs += Date.now() - uidFetchStartedAt;
          } else {
            const searchStartedAt = Date.now();
            await this.acquireProviderRequestSlot(
              mailboxId,
              providerSyncPolicy,
              `imap-search-incremental:${folderPath}`,
              options,
            );
            const incrementalSearch = await client.search(
              { uid: `${effectiveLastUidNext}:*` },
              { uid: true },
            );
            const incrementalUids = Array.isArray(incrementalSearch)
              ? incrementalSearch
              : [];
            messageUids = [...incrementalUids].sort((left, right) => left - right);
            timing.searchMs += Date.now() - searchStartedAt;
          }
        } catch (err) {
          if (err instanceof KillSwitchActivatedError) {
            throw err;
          }
          this.logger.warn(
            `[email-sync] mailbox=${mailboxId} folder=${folderPath} incremental fetch failed; retrying full scan`,
          );
          const searchStartedAt = Date.now();
          await this.acquireProviderRequestSlot(
            mailboxId,
            providerSyncPolicy,
            `imap-search-full:${folderPath}`,
            options,
          );
          const fullScanSearch = await client.search(
            { all: true },
            { uid: true },
          );
          const fullScanUids = Array.isArray(fullScanSearch)
            ? fullScanSearch
            : [];
          messageUids = [...fullScanUids].sort((left, right) => left - right);
          timing.searchMs += Date.now() - searchStartedAt;
        }
      }
      timing.reconciledDeletedMessages = reconciledDeletedMessages;
      timing.newMessageCount = messageUids.length;

      this.logger.log(
        `[email-sync] mailbox=${mailboxId} folder=${folderPath} fetched ${messageUids.length} new messages reconciledDeleted=${reconciledDeletedMessages}`,
      );

      if (messageUids.length === 0) {
        const counterRefreshStartedAt = Date.now();
        await this.prisma.mailboxFolder.update({
          where: { id: folder.id },
          data: {
            syncStatus: 'SUCCESS',
            lastSyncedAt: new Date(),
            uidNext:
              serverStatus && serverStatus.uidNext
                ? BigInt(serverStatus.uidNext)
                : folder.uidNext,
            messageCount: Math.max(
              0,
              Number(folder.messageCount ?? 0) - reconciledDeletedMessages,
            ),
            unreadCount: Math.max(
              0,
              Number(folder.unreadCount ?? 0) - reconciledDeletedUnreadCount,
            ),
          },
        });
        timing.counterRefreshMs = Date.now() - counterRefreshStartedAt;
        timing.totalMs = Date.now() - folderStartedAt;
        return timing;
      }

      const fetchBatchSize = this.resolveFetchBatchSize(
        providerSyncPolicy,
        streamingMode,
      );
      const uidBatches = chunkArray(messageUids, fetchBatchSize);
      const runtimeCache: SyncRuntimeCache = {
        threadByMessageId: new Map<string, ThreadLookupResult>(),
        threadBySubject: new Map<string, ThreadLookupResult>(),
        contactLinkByEmail: new Map<
          string,
          { contactId: string | null; companyId: string | null }
        >(),
      };
      let createdMessageCount = 0;
      let unreadCreatedCount = 0;

      for (const uidBatch of uidBatches) {
        const fetchStartedAt = Date.now();
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

        await this.acquireProviderRequestSlot(
          mailboxId,
          providerSyncPolicy,
          `imap-fetch:${folderPath}`,
          options,
        );
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
        timing.fetchMs += Date.now() - fetchStartedAt;

        const chunks = streamingMode
          ? chunkArray(fetchedMessages, STREAM_CHUNK_SIZE)
          : [fetchedMessages];

        for (const chunk of chunks) {
          const upsertStartedAt = Date.now();
          if (options.interactive) {
            const batchResult = await this.upsertInteractiveBatch(
              chunk,
              mailboxId,
              organizationId,
              folder.id,
              folderType,
              { ...options, runtimeCache },
            );
            timing.parseMs += batchResult.timing.parseMs;
            timing.dedupeMs += batchResult.timing.dedupeMs;
            timing.threadResolveMs += batchResult.timing.threadResolveMs;
            timing.createMs += batchResult.timing.createMs;
            timing.postIngestMs += batchResult.timing.postIngestMs;
            createdMessageCount += batchResult.createdCount;
            unreadCreatedCount += batchResult.unreadCreatedCount;
          } else {
            for (const msg of chunk) {
              const upsertResult = await this.upsertMessage(
                msg,
                mailboxId,
                organizationId,
                folder.id,
                folderType,
                { ...options, runtimeCache },
              );
              timing.parseMs += upsertResult.timing.parseMs;
              timing.dedupeMs += upsertResult.timing.dedupeMs;
              timing.threadResolveMs += upsertResult.timing.threadResolveMs;
              timing.createMs += upsertResult.timing.createMs;
              timing.postIngestMs += upsertResult.timing.postIngestMs;
              if (upsertResult.created) {
                createdMessageCount += 1;
                unreadCreatedCount += upsertResult.unreadDelta;
              }
            }
          }
          timing.upsertMs += Date.now() - upsertStartedAt;
          await this.applyChunkDelay(
            adaptiveBucketKey,
            mailboxId,
            streamingMode,
            `imap-message-chunk:${folderPath}`,
            options,
          );
        }
      }

      const maxUid = Math.max(...messageUids);
      const counterRefreshStartedAt = Date.now();
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
          messageCount: Math.max(
            0,
            Number(folder.messageCount ?? 0) -
              reconciledDeletedMessages +
              createdMessageCount,
          ),
          unreadCount: Math.max(
            0,
            Number(folder.unreadCount ?? 0) -
              reconciledDeletedUnreadCount +
              unreadCreatedCount,
          ),
        },
      });
      timing.counterRefreshMs = Date.now() - counterRefreshStartedAt;
      timing.totalMs = Date.now() - folderStartedAt;
      return timing;
    } finally {
      lock?.release();
    }
  }

  // ─── Message upsert ───────────────────────────────────────────────────────

  private normalizeAddressArray(
    value: Prisma.JsonValue | null | undefined,
  ): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }

  private normalizeBodySignature(
    bodyText: string | null | undefined,
    bodyHtml: string | null | undefined,
  ): string {
    const base = String(bodyText || '').trim()
      || String(bodyHtml || '').replace(/<[^>]+>/g, ' ').trim();
    return base.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 240);
  }

  private async findOutboundPlaceholderMessage(input: {
    mailboxId: string;
    subject: string;
    fromEmail: string;
    toAddresses: string[];
    createdAt: Date;
    bodyText: string | null;
    bodyHtml: string | null;
  }): Promise<{
    id: string;
    threadId: string;
    createdAt: Date;
    hasAttachments: boolean;
  } | null> {
    const start = new Date(input.createdAt.getTime() - 30 * 60 * 1000);
    const end = new Date(input.createdAt.getTime() + 30 * 60 * 1000);
    const candidates = await this.prisma.message.findMany({
      where: {
        mailboxId: input.mailboxId,
        direction: 'OUTBOUND',
        isDraft: false,
        deletedAt: null,
        messageId: null,
        subject: input.subject,
        fromEmail: input.fromEmail,
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      select: {
        id: true,
        threadId: true,
        createdAt: true,
        hasAttachments: true,
        to: true,
        bodyText: true,
        bodyHtml: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    if (candidates.length === 0) return null;

    const targetTo = new Set(
      input.toAddresses.map((value) => value.toLowerCase().trim()).filter(Boolean),
    );
    const targetBodySig = this.normalizeBodySignature(
      input.bodyText || '',
      input.bodyHtml || '',
    );

    const byRecipients = candidates.filter((candidate) => {
      const candidateTo = new Set(this.normalizeAddressArray(candidate.to));
      if (targetTo.size === 0 || candidateTo.size === 0) return true;
      if (candidateTo.size !== targetTo.size) return false;
      for (const entry of targetTo) {
        if (!candidateTo.has(entry)) return false;
      }
      return true;
    });

    const recipientMatched = byRecipients.length > 0 ? byRecipients : candidates;
    const bodyMatched = recipientMatched.find((candidate) => {
      const candidateSig = this.normalizeBodySignature(
        candidate.bodyText || '',
        candidate.bodyHtml || '',
      );
      if (!targetBodySig || !candidateSig) return true;
      return (
        candidateSig === targetBodySig ||
        candidateSig.includes(targetBodySig) ||
        targetBodySig.includes(candidateSig)
      );
    });

    const selected = bodyMatched || recipientMatched[0] || null;
    if (!selected) return null;
    return {
      id: selected.id,
      threadId: selected.threadId,
      createdAt: selected.createdAt,
      hasAttachments: selected.hasAttachments,
    };
  }

  private async deleteMissingProviderMessages(
    organizationId: string,
    messages: Array<{ id: string; threadId: string }>,
  ): Promise<{ deletedCount: number; unreadDeletedCount: number }> {
    if (messages.length === 0) {
      return { deletedCount: 0, unreadDeletedCount: 0 };
    }

    const messageIds = messages.map((message) => message.id);
    const candidateThreadIds = Array.from(
      new Set(messages.map((message) => message.threadId).filter(Boolean)),
    );
    const attachments = await this.prisma.attachment.findMany({
      where: { messageId: { in: messageIds } },
      select: { storageKey: true },
    });
    const attachmentStorageKeys = Array.from(
      new Set(
        attachments
          .map((attachment) => String(attachment.storageKey || '').trim())
          .filter((storageKey) => storageKey.length > 0),
      ),
    );

    const deletedThreadIds = await this.prisma.$transaction(async (tx) => {
      await tx.attachment.deleteMany({
        where: { messageId: { in: messageIds } },
      });
      await tx.auditLog.deleteMany({
        where: {
          organizationId,
          entityType: 'message',
          entityId: { in: messageIds },
        },
      });
      await tx.message.deleteMany({
        where: { id: { in: messageIds } },
      });

      if (candidateThreadIds.length === 0) {
        return [] as string[];
      }

      const emptyThreads = await tx.thread.findMany({
        where: {
          id: { in: candidateThreadIds },
          messages: { none: {} },
        },
        select: { id: true },
      });
      const emptyThreadIds = emptyThreads.map((thread) => thread.id);
      if (emptyThreadIds.length === 0) {
        return [] as string[];
      }

      const notifications = await tx.notification.findMany({
        where: {
          organizationId,
          resourceId: { in: emptyThreadIds },
        },
        select: { id: true },
      });
      const notificationIds = notifications.map((notification) => notification.id);
      if (notificationIds.length > 0) {
        await tx.notificationDigestItem.deleteMany({
          where: { notificationId: { in: notificationIds } },
        });
      }

      await tx.notification.deleteMany({
        where: {
          organizationId,
          resourceId: { in: emptyThreadIds },
        },
      });
      await tx.scheduledMessage.deleteMany({
        where: {
          organizationId,
          threadId: { in: emptyThreadIds },
        },
      });
      await tx.threadTag.deleteMany({
        where: { threadId: { in: emptyThreadIds } },
      });
      await tx.threadNote.deleteMany({
        where: {
          organizationId,
          threadId: { in: emptyThreadIds },
        },
      });
      await tx.auditLog.deleteMany({
        where: {
          organizationId,
          entityType: 'thread',
          entityId: { in: emptyThreadIds },
        },
      });
      await tx.thread.deleteMany({
        where: { id: { in: emptyThreadIds } },
      });

      return emptyThreadIds;
    });

    await Promise.all(
      attachmentStorageKeys.map((storageKey) =>
        this.attachmentStorage.delete(storageKey).catch((error) => {
          this.logger.warn(
            `[email-sync] failed to delete attachment storageKey=${storageKey}: ${String(error)}`,
          );
        }),
      ),
    );

    if (deletedThreadIds.length > 0) {
      this.eventsGateway?.emitToOrganization(organizationId, 'thread:updated', {
        threadIds: deletedThreadIds,
        type: 'deleted',
      });
    }

    return {
      deletedCount: messageIds.length,
      unreadDeletedCount: 0,
    };
  }

  private async reconcileDuplicateMessageEntriesByMessageId(
    mailboxId: string,
    organizationId: string,
    messageId: string,
    preferredMessageId?: string | null,
  ): Promise<void> {
    const normalizedMessageId = normalizeRfcMessageId(messageId);
    if (!normalizedMessageId) return;

    const rows = await this.prisma.message.findMany({
      where: {
        mailboxId,
        messageId: normalizedMessageId,
        deletedAt: null,
      },
      select: {
        id: true,
        threadId: true,
        createdAt: true,
        hasAttachments: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (rows.length <= 1) return;

    const keeper =
      rows.find((row) => String(row.id) === String(preferredMessageId || '')) ||
      rows[0];
    const duplicates = rows.filter((row) => row.id !== keeper.id);
    if (duplicates.length === 0) return;

    const duplicateIds = duplicates.map((row) => row.id);
    await this.prisma.attachment.updateMany({
      where: { messageId: { in: duplicateIds } },
      data: { messageId: keeper.id },
    });

    if (duplicates.some((row) => row.hasAttachments)) {
      await this.prisma.message.updateMany({
        where: {
          id: keeper.id,
          hasAttachments: false,
        },
        data: { hasAttachments: true },
      });
    }

    await this.deleteMissingProviderMessages(
      organizationId,
      duplicates.map((row) => ({ id: row.id, threadId: row.threadId })),
    );

    this.logger.warn(
      `[email-sync] reconciled duplicate messages mailbox=${mailboxId} messageId=${normalizedMessageId} removed=${duplicates.length}`,
    );
  }

  private async upsertInteractiveBatch(
    chunk: Array<{
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
    }>,
    mailboxId: string,
    organizationId: string,
    folderId: string,
    folderType: string,
    options: SyncExecutionOptions,
  ): Promise<{
    createdCount: number;
    unreadCreatedCount: number;
    timing: UpsertTiming;
  }> {
    const timing: UpsertTiming = {
      parseMs: 0,
      dedupeMs: 0,
      threadResolveMs: 0,
      createMs: 0,
      postIngestMs: 0,
    };

    const prepared = chunk.map((msg) => {
      const parseStartedAt = Date.now();
      const env = msg.envelope;
      const fromEmail = env.from?.[0]?.address ?? 'unknown@example.com';
      const fromName = env.from?.[0]?.name ?? '';
      const toAddresses = (env.to ?? [])
        .map((address) => address.address ?? '')
        .filter(Boolean);
      const subject = env.subject ?? '(no subject)';
      const fastContent = msg.source
        ? this.extractFastMessageContent(msg.source)
        : {
            messageId: null,
            inReplyTo: null,
            references: [],
            bodyText: '',
            bodyHtml: null,
            hasAttachments: false,
          };
      const rfc822MessageId =
        fastContent.messageId ??
        normalizeRfcMessageId(env.messageId) ??
        `<uid-${msg.uid}@imap>`;
      const parseMs = Date.now() - parseStartedAt;
      const persistedMessageId =
        normalizeRfcMessageId(rfc822MessageId) ?? `<uid-${msg.uid}@imap>`;
      return {
        msg,
        fromEmail,
        fromName,
        toAddresses,
        subject,
        rfc822MessageId: persistedMessageId,
        inReplyTo: fastContent.inReplyTo ?? env.inReplyTo ?? undefined,
        receivedAt: env.date ?? new Date(),
        references: fastContent.references,
        bodyText: fastContent.bodyText,
        bodyHtml: fastContent.bodyHtml,
        hasAttachments: fastContent.hasAttachments,
        parseMs,
      };
    });
    timing.parseMs += prepared.reduce((sum, item) => sum + item.parseMs, 0);

    const realMessageIds = Array.from(
      new Set(
        prepared
          .map((item) => item.rfc822MessageId)
          .filter((value) => !String(value).startsWith('<uid-')),
      ),
    );
    const dedupeStartedAt = Date.now();
    const existingByMessageId = realMessageIds.length
      ? await this.prisma.message.findMany({
          where: {
            mailboxId,
            messageId: { in: realMessageIds },
            deletedAt: null,
          },
          select: {
            id: true,
            hasAttachments: true,
            messageId: true,
            folder: { select: { type: true } },
          },
        })
      : [];
    timing.dedupeMs += Date.now() - dedupeStartedAt;
    const existingByMessageIdMap = new Map(
      existingByMessageId
        .filter((row) => row.messageId)
        .map((row) => [String(row.messageId), row]),
    );
    const referenceCandidateIds = Array.from(
      new Set(
        prepared.flatMap((item) =>
          [
            normalizeRfcMessageId(item.inReplyTo),
            ...item.references.map((value) => normalizeRfcMessageId(value)),
          ].filter((value): value is string => Boolean(value)),
        ),
      ),
    );
    if (referenceCandidateIds.length > 0) {
      const referenceLookupStartedAt = Date.now();
      const referencedMessages = await this.prisma.message.findMany({
        where: {
          mailboxId,
          messageId: { in: referenceCandidateIds },
          deletedAt: null,
          thread: {
            organizationId,
            status: { not: ThreadStatus.TRASH },
          },
        },
        select: {
          messageId: true,
          thread: {
            select: { id: true, contactId: true, companyId: true },
          },
        },
      });
      for (const referencedMessage of referencedMessages) {
        if (!referencedMessage.messageId || !referencedMessage.thread) continue;
        options.runtimeCache?.threadByMessageId.set(
          String(referencedMessage.messageId),
          {
            id: referencedMessage.thread.id,
            contactId: referencedMessage.thread.contactId ?? null,
            companyId: referencedMessage.thread.companyId ?? null,
          },
        );
      }
      timing.threadResolveMs += Date.now() - referenceLookupStartedAt;
    }

    const messageRows: Prisma.MessageCreateManyInput[] = [];
    const threadRows: Prisma.ThreadCreateManyInput[] = [];
    const duplicateMoves: Array<{ id: string; imapUid: number }> = [];
    const attachmentFlagPromotions: string[] = [];
    const postIngestPayloads: Array<{
      createdMessageId: string;
      thread: ThreadLookupResult;
      fromEmail: string;
      fromName: string;
      toAddresses: string[];
      subject: string;
      bodyText: string;
      bodyHtml: string | null;
      inReplyTo?: string;
      receivedAt: Date;
      direction: 'INBOUND' | 'OUTBOUND';
      source?: Buffer;
      rfc822MessageId: string;
    }> = [];

    for (const item of prepared) {
      const existing = existingByMessageIdMap.get(item.rfc822MessageId);
      if (existing) {
        if (item.hasAttachments && !existing.hasAttachments) {
          attachmentFlagPromotions.push(existing.id);
        }
        await this.hydrateAttachmentsFromSourceIfNeeded(
          existing.id,
          item.msg.source,
          item.rfc822MessageId,
          organizationId,
          item.hasAttachments,
        );
        const existingPriority =
          FOLDER_MESSAGE_PRIORITY[String(existing.folder?.type || 'custom')] ?? 99;
        const currentPriority =
          FOLDER_MESSAGE_PRIORITY[String(folderType || 'custom')] ?? 99;
        const folderTypeNormalized = String(folderType || 'custom').toLowerCase();
        const existingFolderType = String(
          existing.folder?.type || 'custom',
        ).toLowerCase();
        const shouldPromoteProviderDeleteToTrash =
          folderTypeNormalized === 'trash' && existingFolderType !== 'trash';
        if (currentPriority < existingPriority || shouldPromoteProviderDeleteToTrash) {
          duplicateMoves.push({ id: existing.id, imapUid: item.msg.uid });
        }
        continue;
      }

      let thread: ThreadLookupResult;
      const looksLikeReplyBySubject = /^(re:|aw:|fw:|fwd:)\s*/i.test(
        String(item.subject || '').trim(),
      );
      const canCreateRootThreadLocally =
        !item.inReplyTo &&
        item.references.length === 0 &&
        !looksLikeReplyBySubject;
      const normalizedIncomingSubject = String(item.subject || '')
        .replace(/^(re:|fwd?:|aw:|fw:)\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (canCreateRootThreadLocally) {
        const threadId = crypto.randomUUID();
        thread = {
          id: threadId,
          contactId: null,
          companyId: null,
        };
        threadRows.push({
          id: threadId,
          organizationId,
          mailboxId,
          subject: item.subject,
          status: 'OPEN',
        });
      } else {
        // For replies, always resolve by RFC headers first (In-Reply-To / References).
        // Subject cache fallback remains inside findOrCreateThread only if header linkage fails.
        const threadResolveStartedAt = Date.now();
        thread = await this.findOrCreateThread(
          organizationId,
          mailboxId,
          item.subject,
          item.rfc822MessageId,
          item.inReplyTo,
          item.references,
          item.fromEmail,
          item.fromName,
          options,
        );
        timing.threadResolveMs += Date.now() - threadResolveStartedAt;
      }
      options.runtimeCache?.threadByMessageId.set(item.rfc822MessageId, thread);
      if (normalizedIncomingSubject) {
        options.runtimeCache?.threadBySubject.set(normalizedIncomingSubject, thread);
      }

      const createdMessageId = crypto.randomUUID();
      const direction: 'INBOUND' | 'OUTBOUND' =
        folderType === 'sent' ? 'OUTBOUND' : 'INBOUND';
      const isDraft = folderType === 'drafts';
      const snippetText = item.bodyText.trim().replace(/\s+/g, ' ');
      const snippet =
        snippetText.slice(0, 200) + (item.fromName ? ` — ${item.fromName}` : '') ||
        null;

      messageRows.push({
        id: createdMessageId,
        threadId: thread.id,
        mailboxId,
        folderId,
        messageId: item.rfc822MessageId,
        fromEmail: item.fromEmail,
        to: item.toAddresses as unknown as Prisma.InputJsonValue,
        subject: item.subject,
        bodyText: item.bodyText,
        bodyHtml: item.bodyHtml,
        hasAttachments: item.hasAttachments,
        isInternalNote: false,
        isDraft,
        direction,
        imapUid: item.msg.uid,
        inReplyTo: item.inReplyTo ?? null,
        references:
          item.references.length > 0
            ? (item.references as unknown as Prisma.InputJsonValue)
            : undefined,
        snippet,
        createdAt: item.receivedAt,
      });
      postIngestPayloads.push({
        createdMessageId,
        thread,
        fromEmail: item.fromEmail,
        fromName: item.fromName,
        toAddresses: item.toAddresses,
        subject: item.subject,
        bodyText: item.bodyText,
        bodyHtml: item.bodyHtml,
        inReplyTo: item.inReplyTo,
        receivedAt: item.receivedAt,
        direction,
        source: item.msg.source,
        rfc822MessageId: item.rfc822MessageId,
      });
    }

    const createStartedAt = Date.now();
    if (attachmentFlagPromotions.length > 0) {
      await this.prisma.message.updateMany({
        where: {
          id: { in: attachmentFlagPromotions },
          hasAttachments: false,
        },
        data: {
          hasAttachments: true,
        },
      });
    }
    if (duplicateMoves.length > 0) {
      const duplicateUpdateStartedAt = Date.now();
      const valuesSql = duplicateMoves
        .map(
          (move) =>
            `('${String(move.id).replace(/'/g, "''")}', ${Number(move.imapUid)})`,
        )
        .join(', ');
      const markDeletedSql =
        String(folderType || '').toLowerCase() === 'trash'
          ? `"deletedAt" = NOW(),`
          : `"deletedAt" = NULL,`;
      await this.prisma.$executeRawUnsafe(`
        UPDATE "messages" AS m
        SET "folderId" = '${String(folderId).replace(/'/g, "''")}',
            ${markDeletedSql}
            "imapUid" = v.imap_uid
        FROM (VALUES ${valuesSql}) AS v(id, imap_uid)
        WHERE m.id = v.id
      `);
      timing.dedupeMs += Date.now() - duplicateUpdateStartedAt;
    }
    if (threadRows.length > 0) {
      await this.prisma.thread.createMany({
        data: threadRows,
        skipDuplicates: true,
      });
    }
    if (messageRows.length > 0) {
      await this.prisma.message.createMany({
        data: messageRows,
        skipDuplicates: true,
      });
    }
    timing.createMs += Date.now() - createStartedAt;

    const postIngestStartedAt = Date.now();
    for (const payload of postIngestPayloads) {
      this.eventsGateway?.emitToOrganization(organizationId, 'thread:updated', {
        threadId: payload.thread.id,
        mailboxId,
        type: 'new_message',
      });

      void this.runPostIngestWork(
        organizationId,
        mailboxId,
        payload.thread,
        payload.createdMessageId,
        payload.fromEmail,
        payload.fromName,
        payload.toAddresses,
        payload.subject,
        payload.bodyText,
        payload.bodyHtml,
        payload.inReplyTo,
        payload.receivedAt,
        payload.direction,
        options,
      ).catch((error) => {
        this.logger.warn(
          `[email-sync] interactive post-ingest work failed message=${payload.createdMessageId}: ${String(error)}`,
        );
      });

      if (payload.source) {
        void this.enrichInteractiveMessageContent(
          payload.createdMessageId,
          payload.source,
          payload.rfc822MessageId,
          organizationId,
        ).catch((error) => {
          this.logger.warn(
            `[email-sync] interactive message enrichment failed message=${payload.createdMessageId}: ${String(error)}`,
          );
        });
      }
    }
    timing.postIngestMs += Date.now() - postIngestStartedAt;

    return {
      createdCount: postIngestPayloads.length,
      unreadCreatedCount: postIngestPayloads.length,
      timing,
    };
  }

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
    options: SyncExecutionOptions = {},
  ): Promise<{ created: boolean; unreadDelta: number; timing: UpsertTiming }> {
    const timing: UpsertTiming = {
      parseMs: 0,
      dedupeMs: 0,
      threadResolveMs: 0,
      createMs: 0,
      postIngestMs: 0,
    };
    const env = msg.envelope;
    const fromEmail = env.from?.[0]?.address ?? 'unknown@example.com';
    const fromName = env.from?.[0]?.name ?? '';
    const toAddresses = (env.to ?? [])
      .map((a) => a.address ?? '')
      .filter(Boolean);
    const subject = env.subject ?? '(no subject)';
    let rfc822MessageId = normalizeRfcMessageId(env.messageId) ?? `<uid-${msg.uid}@imap>`;
    let inReplyTo = env.inReplyTo ?? undefined;
    const receivedAt = env.date ?? new Date();
    let references: string[] = [];

    const parseStartedAt = Date.now();
    let bodyText = '';
    let bodyHtml: string | null = null;
    let hasAttachments = false;
    if (msg.source) {
      if (options.interactive) {
        const fastContent = this.extractFastMessageContent(msg.source);
        bodyText = fastContent.bodyText;
        bodyHtml = fastContent.bodyHtml;
        hasAttachments = fastContent.hasAttachments;
        rfc822MessageId = fastContent.messageId ?? rfc822MessageId;
        inReplyTo = inReplyTo ?? fastContent.inReplyTo ?? undefined;
        references = fastContent.references;
      } else {
        try {
          const parsed = await simpleParser(msg.source);
          hasAttachments = Array.isArray(parsed.attachments)
            ? parsed.attachments.length > 0
            : false;
          bodyText = parsed.text ?? '';
          bodyHtml = parsed.html || null;
          rfc822MessageId =
            normalizeRfcMessageId(parsed.messageId) ?? rfc822MessageId;
          references = Array.isArray(parsed.references)
            ? parsed.references.map((value) => String(value || '').trim()).filter(Boolean)
            : String(parsed.references || '')
                .split(/\s+/)
                .map((value) => value.trim())
                .filter(Boolean);
          bodyText = bodyText.slice(0, 50000);
          if (bodyHtml) bodyHtml = bodyHtml.slice(0, 200000);
        } catch {
          const fastContent = this.extractFastMessageContent(msg.source);
          bodyText = fastContent.bodyText;
          bodyHtml = fastContent.bodyHtml;
          hasAttachments = fastContent.hasAttachments;
          rfc822MessageId = fastContent.messageId ?? rfc822MessageId;
          references = fastContent.references;
        }
      }
    }
    rfc822MessageId =
      normalizeRfcMessageId(rfc822MessageId) ?? `<uid-${msg.uid}@imap>`;
    timing.parseMs = Date.now() - parseStartedAt;

    const dedupeStartedAt = Date.now();
    const existing = await this.prisma.message.findFirst({
      where: { mailboxId, folderId, imapUid: msg.uid },
      select: { id: true },
    });
    if (existing) {
      if (hasAttachments) {
        await this.prisma.message.updateMany({
          where: {
            id: existing.id,
            hasAttachments: false,
          },
          data: {
            hasAttachments: true,
          },
        });
      }
      await this.hydrateAttachmentsFromSourceIfNeeded(
        existing.id,
        msg.source,
        rfc822MessageId,
        organizationId,
        hasAttachments,
      );
      timing.dedupeMs = Date.now() - dedupeStartedAt;
      return { created: false, unreadDelta: 0, timing };
    }

    const hasRealMessageId = !rfc822MessageId.startsWith('<uid-');
    if (hasRealMessageId) {
      const existingByMessageId = await this.prisma.message.findFirst({
        where: {
          mailboxId,
          messageId: rfc822MessageId,
          deletedAt: null,
        },
        select: {
          id: true,
          hasAttachments: true,
          folderId: true,
          folder: {
            select: {
              type: true,
            },
          },
        },
      });
      if (existingByMessageId) {
        if (hasAttachments && !existingByMessageId.hasAttachments) {
          await this.prisma.message.updateMany({
            where: {
              id: existingByMessageId.id,
              hasAttachments: false,
            },
            data: {
              hasAttachments: true,
            },
          });
        }
        await this.hydrateAttachmentsFromSourceIfNeeded(
          existingByMessageId.id,
          msg.source,
          rfc822MessageId,
          organizationId,
          hasAttachments,
        );
        const existingPriority =
          FOLDER_MESSAGE_PRIORITY[String(existingByMessageId.folder?.type || 'custom')] ?? 99;
        const currentPriority =
          FOLDER_MESSAGE_PRIORITY[String(folderType || 'custom')] ?? 99;
        const folderTypeNormalized = String(folderType || 'custom').toLowerCase();
        const existingFolderType = String(
          existingByMessageId.folder?.type || 'custom',
        ).toLowerCase();
        const shouldPromoteProviderDeleteToTrash =
          folderTypeNormalized === 'trash' && existingFolderType !== 'trash';

        if (currentPriority < existingPriority || shouldPromoteProviderDeleteToTrash) {
          await this.prisma.message.update({
            where: { id: existingByMessageId.id },
            data: {
              folder: { connect: { id: folderId } },
              imapUid: msg.uid,
              messageId: rfc822MessageId,
              inReplyTo: inReplyTo ?? null,
              references:
                references.length > 0
                  ? (references as unknown as Prisma.InputJsonValue)
                  : undefined,
              subject,
              fromEmail,
              to: toAddresses as unknown as Prisma.InputJsonValue,
              bodyText,
              bodyHtml,
              createdAt: receivedAt,
              deletedAt:
                folderTypeNormalized === 'trash'
                  ? new Date()
                  : null,
            },
          });
        }
        if (folderTypeNormalized === 'sent') {
          const placeholder = await this.findOutboundPlaceholderMessage({
            mailboxId,
            subject,
            fromEmail,
            toAddresses,
            createdAt: receivedAt,
            bodyText,
            bodyHtml,
          });
          if (placeholder && placeholder.id !== existingByMessageId.id) {
            await this.prisma.attachment.updateMany({
              where: { messageId: placeholder.id },
              data: { messageId: existingByMessageId.id },
            });
            if (placeholder.hasAttachments && !existingByMessageId.hasAttachments) {
              await this.prisma.message.updateMany({
                where: { id: existingByMessageId.id, hasAttachments: false },
                data: { hasAttachments: true },
              });
            }
            await this.deleteMissingProviderMessages(organizationId, [
              { id: placeholder.id, threadId: placeholder.threadId },
            ]);
          }
        }
        await this.reconcileDuplicateMessageEntriesByMessageId(
          mailboxId,
          organizationId,
          rfc822MessageId,
          existingByMessageId.id,
        );
        timing.dedupeMs = Date.now() - dedupeStartedAt;
        return { created: false, unreadDelta: 0, timing };
      }
    }
    timing.dedupeMs = Date.now() - dedupeStartedAt;

    if (this.isThreadingDisabled(mailboxId, 'imap-thread-match-create')) {
      return { created: false, unreadDelta: 0, timing };
    }

    const direction: 'INBOUND' | 'OUTBOUND' =
      folderType === 'sent' ? 'OUTBOUND' : 'INBOUND';
    const isDraft = folderType === 'drafts';

    if (direction === 'OUTBOUND' && hasRealMessageId) {
      const placeholder = await this.findOutboundPlaceholderMessage({
        mailboxId,
        subject,
        fromEmail,
        toAddresses,
        createdAt: receivedAt,
        bodyText,
        bodyHtml,
      });

      if (placeholder) {
        await this.prisma.message.update({
          where: { id: placeholder.id },
          data: {
            folder: { connect: { id: folderId } },
            messageId: rfc822MessageId,
            fromEmail,
            to: toAddresses as unknown as Prisma.InputJsonValue,
            subject,
            bodyText,
            bodyHtml,
            hasAttachments: placeholder.hasAttachments || hasAttachments,
            isDraft,
            direction,
            imapUid: msg.uid,
            inReplyTo: inReplyTo ?? null,
            references:
              references.length > 0
                ? (references as unknown as Prisma.InputJsonValue)
                : undefined,
            createdAt: receivedAt,
          },
        });

        await this.reconcileDuplicateMessageEntriesByMessageId(
          mailboxId,
          organizationId,
          rfc822MessageId,
          placeholder.id,
        );

        timing.threadResolveMs = 0;
        timing.createMs = 0;
        timing.postIngestMs = 0;
        return { created: false, unreadDelta: 0, timing };
      }
    }

    const threadResolveStartedAt = Date.now();
    const thread = await this.findOrCreateThread(
      organizationId,
      mailboxId,
      subject,
      rfc822MessageId,
      inReplyTo,
      references,
      fromEmail,
      fromName,
      options,
    );
    timing.threadResolveMs = Date.now() - threadResolveStartedAt;

    // Build snippet from clean text (not raw MIME)
    const snippetText = bodyText.trim().replace(/\s+/g, ' ');
    const snippet =
      snippetText.slice(0, 200) + (fromName ? ` — ${fromName}` : '') || null;

    const createStartedAt = Date.now();
    const createdMessage = await this.prisma.message.create({
      data: {
        thread: { connect: { id: thread.id } },
        mailbox: { connect: { id: mailboxId } },
        folder: { connect: { id: folderId } },
        messageId: rfc822MessageId,
        fromEmail,
        to: toAddresses as unknown as Prisma.InputJsonValue,
        subject,
        bodyText,
        bodyHtml,
        hasAttachments,
        isInternalNote: false,
        isDraft,
        direction,
        imapUid: msg.uid,
        inReplyTo: inReplyTo ?? null,
        references:
          references.length > 0
            ? (references as unknown as Prisma.InputJsonValue)
            : undefined,
        snippet,
        createdAt: receivedAt,
      },
      select: { id: true },
    });
    timing.createMs = Date.now() - createStartedAt;

    this.eventsGateway?.emitToOrganization(organizationId, 'thread:updated', {
      threadId: thread.id,
      mailboxId,
      type: 'new_message',
    });

    const postIngestWork = async () =>
      this.runPostIngestWork(
        organizationId,
        mailboxId,
        thread,
        createdMessage.id,
        fromEmail,
        fromName,
        toAddresses,
        subject,
        bodyText,
        bodyHtml,
        inReplyTo,
        receivedAt,
        direction,
        options,
      );

    if (options.interactive) {
      const postIngestStartedAt = Date.now();
      void postIngestWork().catch((error) => {
        this.logger.warn(
          `[email-sync] interactive post-ingest work failed message=${createdMessage.id}: ${String(error)}`,
        );
      });
      timing.postIngestMs = Date.now() - postIngestStartedAt;
    } else {
      const postIngestStartedAt = Date.now();
      await postIngestWork();
      timing.postIngestMs = Date.now() - postIngestStartedAt;
    }

    if (options.interactive && msg.source) {
      void this.enrichInteractiveMessageContent(
        createdMessage.id,
        msg.source,
        rfc822MessageId,
        organizationId,
      ).catch((error) => {
        this.logger.warn(
          `[email-sync] interactive message enrichment failed message=${createdMessage.id}: ${String(error)}`,
        );
      });
    }

    if (hasRealMessageId) {
      await this.reconcileDuplicateMessageEntriesByMessageId(
        mailboxId,
        organizationId,
        rfc822MessageId,
        createdMessage.id,
      );
    }

    return { created: true, unreadDelta: 1, timing };
  }

  private async categorizeInboundMessage(input: {
    organizationId: string;
    mailboxId: string;
    threadId: string;
    messageId: string;
    fromEmail: string;
    toAddresses: string[];
    ccAddresses: string[];
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    hasAttachments: boolean;
  }): Promise<void> {
    if (!this.aiCategorizationService) {
      return;
    }
    try {
      await this.aiCategorizationService.categorizeInboundThread(input);
    } catch (err) {
      this.logger.warn(
        `[email-sync] AI categorization failed thread=${input.threadId}: ${String(err)}`,
      );
    }
  }

  private async dispatchInboundNewMessageNotifications(input: {
    organizationId: string;
    mailboxId: string;
    threadId: string;
    messageId: string;
    fromEmail: string;
    fromName: string | null;
    subject: string;
    receivedAt: Date;
  }): Promise<void> {
    if (!this.notificationsService) {
      return;
    }

    const recipients = await this.resolveNewMessageNotificationRecipients(
      input.organizationId,
      input.mailboxId,
    );
    if (recipients.length === 0) {
      return;
    }

    const senderLabel = input.fromName?.trim() || input.fromEmail;
    const title = 'New incoming email';
    const message = `${senderLabel}: ${input.subject || '(no subject)'}`;
    const createdAtIso = Number.isNaN(input.receivedAt.getTime())
      ? new Date().toISOString()
      : input.receivedAt.toISOString();

    await Promise.all(
      recipients.map((recipientId) =>
        this.notificationsService!
          .dispatch({
            userId: recipientId,
            organizationId: input.organizationId,
            type: 'new_message',
            title,
            message,
            resourceId: input.threadId,
            channels: { email: false },
            data: {
              threadId: input.threadId,
              mailboxId: input.mailboxId,
              messageId: input.messageId,
              fromEmail: input.fromEmail,
              fromName: input.fromName,
              subject: input.subject,
              createdAt: createdAtIso,
            },
          })
          .catch((error) => {
            this.logger.warn(
              `[email-sync] new_message notification failed mailbox=${input.mailboxId} thread=${input.threadId} recipient=${recipientId}: ${String(error)}`,
            );
          }),
      ),
    );
  }

  private async resolveNewMessageNotificationRecipients(
    organizationId: string,
    mailboxId: string,
  ): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId,
        deletedAt: null,
        isActive: true,
        OR: [
          { role: { in: ['ADMIN', 'MANAGER'] } },
          { mailboxAccess: { some: { mailboxId, canRead: true } } },
          {
            teamMemberships: {
              some: {
                team: {
                  mailboxAccess: { some: { mailboxId, canRead: true } },
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    return users.map((user) => user.id);
  }

  private async evaluateRulesForInboundMessage(input: {
    organizationId: string;
    threadId: string;
    fromEmail: string;
    toAddresses: string[];
    ccAddresses: string[];
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    hasAttachments: boolean;
    inReplyTo?: string;
  }): Promise<void> {
    if (!this.rulesEngine) {
      return;
    }

    const context = {
      from: input.fromEmail,
      to: input.toAddresses.join(','),
      cc: input.ccAddresses.join(','),
      subject: input.subject,
      body: input.bodyText || (input.bodyHtml ?? ''),
      has_attachments: input.hasAttachments ? 'true' : 'false',
      is_reply: input.inReplyTo ? 'true' : 'false',
    };

    try {
      await this.rulesEngine.evaluate(
        input.organizationId,
        input.threadId,
        context,
      );
    } catch (err) {
      this.logger.warn(
        `[email-sync] rules evaluation failed thread=${input.threadId}: ${String(err)}`,
      );
    }
  }

  private async runPostIngestWork(
    organizationId: string,
    mailboxId: string,
    thread: ThreadLookupResult,
    messageId: string,
    fromEmail: string,
    fromName: string,
    toAddresses: string[],
    subject: string,
    bodyText: string,
    bodyHtml: string | null,
    inReplyTo: string | undefined,
    receivedAt: Date,
    direction: 'INBOUND' | 'OUTBOUND',
    options: SyncExecutionOptions,
  ): Promise<void> {
    let effectiveThread = thread;

    if (
      options.interactive &&
      this.crmService &&
      !effectiveThread.contactId &&
      fromEmail &&
      fromEmail !== 'unknown@example.com'
    ) {
      const contactLink = await this.resolveContactLink(
        organizationId,
        fromEmail,
        fromName,
        options,
      );
      if (contactLink.contactId || contactLink.companyId) {
        const updatedThread = await this.prisma.thread.update({
          where: { id: thread.id },
          data: {
            ...(contactLink.contactId ? { contactId: contactLink.contactId } : {}),
            ...(contactLink.companyId ? { companyId: contactLink.companyId } : {}),
          },
          select: { id: true, contactId: true, companyId: true },
        });
        effectiveThread = {
          id: updatedThread.id,
          contactId: updatedThread.contactId ?? null,
          companyId: updatedThread.companyId ?? null,
        };
      }
    }

    if (direction === 'INBOUND') {
      await this.evaluateRulesForInboundMessage({
        organizationId,
        threadId: effectiveThread.id,
        fromEmail,
        toAddresses,
        ccAddresses: [],
        subject,
        bodyText,
        bodyHtml,
        hasAttachments: false,
        inReplyTo,
      });
      await this.categorizeInboundMessage({
        organizationId,
        mailboxId,
        threadId: effectiveThread.id,
        messageId,
        fromEmail,
        toAddresses,
        ccAddresses: [],
        subject,
        bodyText,
        bodyHtml,
        hasAttachments: false,
      });
      await this.dispatchInboundNewMessageNotifications({
        organizationId,
        mailboxId,
        threadId: effectiveThread.id,
        messageId,
        fromEmail,
        fromName,
        subject,
        receivedAt,
      });
    }

    if (this.crmService && effectiveThread.contactId) {
      await this.crmService.emitContactActivity({
        organizationId,
        contactId: effectiveThread.contactId,
        activity: direction === 'INBOUND' ? 'email_received' : 'email_sent',
        threadId: effectiveThread.id,
        mailboxId,
        messageId,
      });
    }
  }

  private async findOrCreateThread(
    organizationId: string,
    mailboxId: string,
    subject: string,
    _messageId: string,
    inReplyTo: string | undefined,
    references: string[] = [],
    fromEmail: string,
    fromName?: string,
    options: SyncExecutionOptions = {},
  ): Promise<{ id: string; contactId: string | null; companyId: string | null }> {
    const normalizeSubject = (value?: string | null): string => {
      return String(value || '')
        .replace(/^(re:|fwd?:|aw:|fw:)\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    };
    const runtimeCache = options.runtimeCache;

    if (inReplyTo) {
      const normalizedInReplyTo = normalizeRfcMessageId(inReplyTo);
      if (normalizedInReplyTo) {
        const cachedThread = runtimeCache?.threadByMessageId.get(normalizedInReplyTo);
        if (cachedThread) {
          return cachedThread;
        }
        const matchedByMessageId = await this.prisma.message.findFirst({
          where: {
            mailboxId,
            messageId: normalizedInReplyTo,
            deletedAt: null,
            thread: {
              organizationId,
              status: { not: ThreadStatus.TRASH },
            },
          },
          select: {
            thread: {
              select: { id: true, contactId: true, companyId: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (matchedByMessageId?.thread) {
          const resolvedThread = {
            id: matchedByMessageId.thread.id,
            contactId: matchedByMessageId.thread.contactId ?? null,
            companyId: matchedByMessageId.thread.companyId ?? null,
          };
          runtimeCache?.threadByMessageId.set(normalizedInReplyTo, resolvedThread);
          return resolvedThread;
        }
      }
    }

    const normalizedReferences = Array.from(
      new Set(
        references
          .map((value) => normalizeRfcMessageId(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (normalizedReferences.length > 0) {
      for (const reference of normalizedReferences) {
        const cachedThread = runtimeCache?.threadByMessageId.get(reference);
        if (cachedThread) {
          return cachedThread;
        }
      }
      const matchedByReferences = await this.prisma.message.findFirst({
        where: {
          mailboxId,
          messageId: { in: normalizedReferences },
          deletedAt: null,
          thread: {
            organizationId,
            status: { not: ThreadStatus.TRASH },
          },
        },
        select: {
          thread: {
            select: { id: true, contactId: true, companyId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (matchedByReferences?.thread) {
        const resolvedThread = {
          id: matchedByReferences.thread.id,
          contactId: matchedByReferences.thread.contactId ?? null,
          companyId: matchedByReferences.thread.companyId ?? null,
        };
        normalizedReferences.forEach((reference) =>
          runtimeCache?.threadByMessageId.set(reference, resolvedThread),
        );
        return resolvedThread;
      }
    }

    if (inReplyTo || normalizedReferences.length > 0) {
      const normalizedIncomingSubject = normalizeSubject(subject);
      const cachedBySubject = normalizedIncomingSubject
        ? runtimeCache?.threadBySubject.get(normalizedIncomingSubject)
        : null;
      if (cachedBySubject) {
        return cachedBySubject;
      }
      const subjectCandidates = await this.prisma.thread.findMany({
        where: {
          organizationId,
          mailboxId,
          status: { not: ThreadStatus.TRASH },
          ...(normalizedIncomingSubject
            ? {
                subject: {
                  contains: normalizedIncomingSubject,
                  mode: 'insensitive',
                },
              }
            : {}),
        },
        select: { id: true, subject: true, contactId: true, companyId: true },
        orderBy: { updatedAt: 'desc' },
        take: 25,
      });
      const existing =
        subjectCandidates.find(
          (candidate) =>
            normalizeSubject(candidate.subject) === normalizedIncomingSubject,
        ) || subjectCandidates[0];
      if (existing) {
        if (existing.contactId || !this.crmService || options.interactive) {
          const resolvedThread = {
            id: existing.id,
            contactId: existing.contactId ?? null,
            companyId: existing.companyId ?? null,
          };
          if (normalizedIncomingSubject) {
            runtimeCache?.threadBySubject.set(normalizedIncomingSubject, resolvedThread);
          }
          return resolvedThread;
        }

        const contactLink = await this.resolveContactLink(
          organizationId,
          fromEmail,
          fromName,
          options,
        );
        if (!contactLink.contactId) {
          const resolvedThread = {
            id: existing.id,
            contactId: null,
            companyId: existing.companyId ?? null,
          };
          if (normalizedIncomingSubject) {
            runtimeCache?.threadBySubject.set(normalizedIncomingSubject, resolvedThread);
          }
          return resolvedThread;
        }

        const updated = await this.prisma.thread.update({
          where: { id: existing.id },
          data: {
            ...(existing.contactId ? {} : { contactId: contactLink.contactId }),
            ...(existing.companyId
              ? {}
              : { companyId: contactLink.companyId ?? null }),
          },
          select: { id: true, contactId: true, companyId: true },
        });
        const resolvedThread = {
          id: updated.id,
          contactId: updated.contactId ?? null,
          companyId: updated.companyId ?? null,
        };
        if (normalizedIncomingSubject) {
          runtimeCache?.threadBySubject.set(normalizedIncomingSubject, resolvedThread);
        }
        return resolvedThread;
      }
    }

    const contactLink =
      options.interactive || !this.crmService
        ? { contactId: null, companyId: null }
        : await this.resolveContactLink(
            organizationId,
            fromEmail,
            fromName,
            options,
          );

    const created = await this.prisma.thread.create({
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
      select: { id: true, contactId: true, companyId: true },
    });
    const resolvedThread = {
      id: created.id,
      contactId: created.contactId ?? null,
      companyId: created.companyId ?? null,
    };
    const normalizedCreatedSubject = normalizeSubject(subject);
    if (normalizedCreatedSubject) {
      runtimeCache?.threadBySubject.set(normalizedCreatedSubject, resolvedThread);
    }
    runtimeCache?.threadByMessageId.set(_messageId, resolvedThread);
    if (inReplyTo) {
      const normalizedInReplyTo = normalizeRfcMessageId(inReplyTo);
      if (normalizedInReplyTo) {
        runtimeCache?.threadByMessageId.set(normalizedInReplyTo, resolvedThread);
      }
    }
    normalizedReferences.forEach((reference) =>
      runtimeCache?.threadByMessageId.set(reference, resolvedThread),
    );
    return resolvedThread;
  }

  private async resolveContactLink(
    organizationId: string,
    fromEmail: string,
    fromName: string | undefined,
    options: SyncExecutionOptions,
  ): Promise<{ contactId: string | null; companyId: string | null }> {
    if (!this.crmService || !fromEmail || fromEmail === 'unknown@example.com') {
      return { contactId: null, companyId: null };
    }

    const cacheKey = `${organizationId}:${fromEmail.toLowerCase()}`;
    const cached = options.runtimeCache?.contactLinkByEmail.get(cacheKey);
    if (cached) {
      return cached;
    }

    const contactLink = await this.crmService
      .autoCreateContactIfEnabled(fromEmail, fromName, organizationId)
      .catch(() => ({ contactId: null, companyId: null }));
    options.runtimeCache?.contactLinkByEmail.set(cacheKey, contactLink);
    return contactLink;
  }

  private extractFastMessageContent(source: Buffer): {
    messageId: string | null;
    inReplyTo: string | null;
    references: string[];
    bodyText: string;
    bodyHtml: string | null;
    hasAttachments: boolean;
  } {
    const raw = source.toString('utf8');
    const separatorMatch = raw.match(/\r?\n\r?\n/);
    const separatorIndex = separatorMatch ? raw.indexOf(separatorMatch[0]) : -1;
    const headerEndIndex =
      separatorIndex >= 0 ? separatorIndex + separatorMatch![0].length : -1;
    const headers = separatorIndex >= 0 ? raw.slice(0, separatorIndex) : raw;
    const body = headerEndIndex >= 0 ? raw.slice(headerEndIndex) : raw;
    const contentType = this.extractHeaderValue(headers, 'content-type') || '';
    const messageId = normalizeRfcMessageId(
      this.extractHeaderValue(headers, 'message-id'),
    );
    const inReplyTo = normalizeRfcMessageId(
      this.extractHeaderValue(headers, 'in-reply-to'),
    );
    const referencesHeader = this.extractHeaderValue(headers, 'references');
    const references = Array.from(
      new Set(
        String(referencesHeader || '')
          .split(/\s+/)
          .map((value) => normalizeRfcMessageId(value))
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const cleanedBody = body
      .replace(/\r\n/g, '\n')
      .replace(/^--.*$/gm, ' ')
      .replace(/^(content-[^:]+|mime-version):.*$/gim, ' ')
      .replace(/=\n/g, '')
      .trim();
    const bodyHtml =
      /text\/html/i.test(contentType) && !/multipart\//i.test(contentType)
        ? cleanedBody.slice(0, 200000)
        : null;
    const bodyText = (bodyHtml ? bodyHtml.replace(/<[^>]+>/g, ' ') : cleanedBody)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50000);
    const hasAttachments =
      /content-disposition:\s*attachment/i.test(raw) ||
      /content-type:[^\r\n;]+;\s*(?:name|filename)\s*=/i.test(raw);

    return {
      messageId,
      inReplyTo,
      references,
      bodyText,
      bodyHtml,
      hasAttachments,
    };
  }

  private extractHeaderValue(headers: string, headerName: string): string | null {
    const lines = headers.replace(/\r\n/g, '\n').split('\n');
    const target = `${headerName.toLowerCase()}:`;
    let current: string | null = null;
    for (const line of lines) {
      if (/^[ \t]/.test(line) && current !== null) {
        current += ` ${line.trim()}`;
        continue;
      }
      if (line.toLowerCase().startsWith(target)) {
        current = line.slice(target.length).trim();
        continue;
      }
      if (current !== null) {
        break;
      }
    }
    return current;
  }

  private async enrichInteractiveMessageContent(
    messageId: string,
    source: Buffer,
    fallbackMessageId: string,
    organizationId: string,
  ): Promise<void> {
    try {
      const parsed = await simpleParser(source);
      const normalizedFallbackMessageId =
        normalizeRfcMessageId(fallbackMessageId) ?? fallbackMessageId;
      const parsedMessageId =
        normalizeRfcMessageId(parsed.messageId) ?? normalizedFallbackMessageId;
      const parsedReferences = Array.isArray(parsed.references)
        ? parsed.references.map((value) => String(value || '').trim()).filter(Boolean)
        : String(parsed.references || '')
            .split(/\s+/)
            .map((value) => value.trim())
            .filter(Boolean);
      const parsedAttachments = Array.isArray(parsed.attachments)
        ? parsed.attachments.filter((attachment) =>
            Buffer.isBuffer((attachment as any)?.content),
          )
        : [];

      let hasAttachments = parsedAttachments.length > 0;
      const existingAttachmentCount = await this.prisma.attachment.count({
        where: { messageId },
      });

      if (parsedAttachments.length > 0 && existingAttachmentCount === 0) {
        for (const parsedAttachment of parsedAttachments) {
          const filename = String(
            (parsedAttachment as any)?.filename || 'attachment.bin',
          ).trim();
          const contentType =
            String((parsedAttachment as any)?.contentType || '').trim() || null;
          const content = (parsedAttachment as any).content as Buffer;
          const storageKey = this.attachmentStorage.generateStorageKey(
            organizationId,
            filename,
          );
          await this.attachmentStorage.upload(
            storageKey,
            content,
            contentType || 'application/octet-stream',
          );
          await this.prisma.attachment.create({
            data: {
              messageId,
              filename,
              contentType,
              sizeBytes: Number(content.length || 0),
              storageKey,
            },
          });
        }
      } else if (existingAttachmentCount > 0) {
        hasAttachments = true;
      }

      await this.prisma.message.update({
        where: { id: messageId },
        data: {
          messageId: parsedMessageId,
          bodyText: String(parsed.text || '').slice(0, 50000),
          bodyHtml: parsed.html ? String(parsed.html).slice(0, 200000) : null,
          hasAttachments,
          references:
            parsedReferences.length > 0
              ? (parsedReferences as unknown as Prisma.InputJsonValue)
              : undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[email-sync] interactive enrichment parse failed message=${messageId}: ${String(error)}`,
      );
    }
  }

  private async hydrateAttachmentsFromSourceIfNeeded(
    messageId: string,
    source: Buffer | undefined,
    fallbackMessageId: string,
    organizationId: string,
    hasAttachments: boolean,
  ): Promise<void> {
    if (!hasAttachments || !source) {
      return;
    }
    const existingAttachmentCount = await this.prisma.attachment.count({
      where: { messageId },
    });
    if (existingAttachmentCount > 0) {
      return;
    }
    await this.enrichInteractiveMessageContent(
      messageId,
      source,
      fallbackMessageId,
      organizationId,
    );
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

