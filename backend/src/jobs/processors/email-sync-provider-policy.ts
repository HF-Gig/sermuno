import type { ConfigService } from '@nestjs/config';

export type EmailSyncProviderKey =
  | 'gmail'
  | 'outlook'
  | 'stratoIonos'
  | 'yahoo'
  | 'default';

export interface EmailSyncProviderPolicy {
  key: EmailSyncProviderKey;
  label: string;
  batchSize: number;
  delayMs: number;
  rateLimit: {
    capacity: number;
    refillPerSecond: number;
  };
}

export interface EmailSyncProviderSource {
  provider?: string | null;
  oauthProvider?: string | null;
  imapHost?: string | null;
  smtpHost?: string | null;
  email?: string | null;
}

interface EmailSyncProviderDefaults {
  label: string;
  configKey: string;
  batchSize: number;
  delayMs: number;
  rateLimit: {
    capacity: number;
    refillPerSecond: number;
  };
}

const PROVIDER_DEFAULTS: Record<
  EmailSyncProviderKey,
  EmailSyncProviderDefaults
> = {
  gmail: {
    label: 'Gmail',
    configKey: 'gmail',
    batchSize: 5000,
    delayMs: 100,
    rateLimit: {
      capacity: 300,
      refillPerSecond: 3.33,
    },
  },
  outlook: {
    label: 'Outlook 365',
    configKey: 'outlook',
    batchSize: 2000,
    delayMs: 500,
    rateLimit: {
      capacity: 150,
      refillPerSecond: 1.67,
    },
  },
  stratoIonos: {
    label: 'Strato/Ionos',
    configKey: 'stratoIonos',
    batchSize: 500,
    delayMs: 1000,
    rateLimit: {
      capacity: 60,
      refillPerSecond: 0.5,
    },
  },
  yahoo: {
    label: 'Yahoo',
    configKey: 'yahoo',
    batchSize: 1500,
    delayMs: 400,
    rateLimit: {
      capacity: 100,
      refillPerSecond: 1,
    },
  },
  default: {
    label: 'Default',
    configKey: 'default',
    batchSize: 1000,
    delayMs: 250,
    rateLimit: {
      capacity: 100,
      refillPerSecond: 1,
    },
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeString(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function emailDomain(email: string | null | undefined): string {
  const normalized = normalizeString(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex < 0 || atIndex === normalized.length - 1) {
    return '';
  }

  return normalized.slice(atIndex + 1);
}

function hostSignals(source: EmailSyncProviderSource): string[] {
  return [
    normalizeString(source.imapHost),
    normalizeString(source.smtpHost),
    emailDomain(source.email),
  ].filter(Boolean);
}

function hasHostMatch(signals: string[], patterns: string[]): boolean {
  return signals.some((signal) =>
    patterns.some(
      (pattern) => signal === pattern || signal.endsWith(`.${pattern}`),
    ),
  );
}

function hasFragmentMatch(signals: string[], fragments: string[]): boolean {
  return signals.some((signal) =>
    fragments.some((fragment) => signal.includes(fragment)),
  );
}

function readNumber(
  configService: ConfigService,
  path: string,
  fallback: number,
): number {
  const rawValue = configService.get<number | string | undefined>(path);
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const parsed =
    typeof rawValue === 'number' ? rawValue : Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readInteger(
  configService: ConfigService,
  path: string,
  fallback: number,
): number {
  return Math.max(1, Math.round(readNumber(configService, path, fallback)));
}

export function detectEmailSyncProvider(
  source: EmailSyncProviderSource,
): EmailSyncProviderKey {
  const provider = normalizeString(source.provider);
  const oauthProvider = normalizeString(source.oauthProvider);
  const signals = hostSignals(source);

  if (
    provider === 'gmail' ||
    oauthProvider === 'gmail' ||
    hasHostMatch(signals, ['gmail.com', 'googlemail.com']) ||
    hasFragmentMatch(signals, ['imap.gmail', 'smtp.gmail'])
  ) {
    return 'gmail';
  }

  if (
    provider === 'outlook' ||
    oauthProvider === 'microsoft' ||
    hasHostMatch(signals, [
      'office365.com',
      'outlook.com',
      'hotmail.com',
      'live.com',
      'msn.com',
    ]) ||
    hasFragmentMatch(signals, [
      'office365',
      'outlook.office365',
      'smtp.office365',
      'outlook.',
      'hotmail.',
      'live.',
      'msn.',
    ])
  ) {
    return 'outlook';
  }

  if (
    hasHostMatch(signals, ['ionos.com', 'strato.com', 'strato.de']) ||
    hasFragmentMatch(signals, [
      'ionos',
      'strato',
      '1und1',
      '1and1',
      'kundenserver',
    ])
  ) {
    return 'stratoIonos';
  }

  if (
    hasHostMatch(signals, ['yahoo.com', 'ymail.com', 'rocketmail.com']) ||
    hasFragmentMatch(signals, ['yahoo', 'ymail', 'rocketmail'])
  ) {
    return 'yahoo';
  }

  return 'default';
}

export function resolveEmailSyncProviderPolicy(
  configService: ConfigService,
  source: EmailSyncProviderSource,
): EmailSyncProviderPolicy {
  const providerKey = detectEmailSyncProvider(source);
  const defaults = PROVIDER_DEFAULTS[providerKey];
  const defaultRateLimit = PROVIDER_DEFAULTS.default.rateLimit;
  const basePath = `emailSync.providers.${defaults.configKey}`;
  const defaultCapacity = readInteger(
    configService,
    'emailSync.providers.default.rateLimit.capacity',
    defaultRateLimit.capacity,
  );
  const defaultRefillPerSecond = readNumber(
    configService,
    'emailSync.providers.default.rateLimit.refillPerSecond',
    defaultRateLimit.refillPerSecond,
  );

  return {
    key: providerKey,
    label: defaults.label,
    batchSize: readInteger(
      configService,
      `${basePath}.batchSize`,
      defaults.batchSize,
    ),
    delayMs: readInteger(
      configService,
      `${basePath}.delayMs`,
      defaults.delayMs,
    ),
    rateLimit: {
      capacity: readInteger(
        configService,
        `${basePath}.rateLimit.capacity`,
        providerKey === 'yahoo' ? defaultCapacity : defaults.rateLimit.capacity,
      ),
      refillPerSecond: readNumber(
        configService,
        `${basePath}.rateLimit.refillPerSecond`,
        providerKey === 'yahoo'
          ? defaultRefillPerSecond
          : defaults.rateLimit.refillPerSecond,
      ),
    },
  };
}

interface TokenBucketState {
  tokens: number;
  lastRefillAt: number;
  nextAllowedAt: number;
}

export class EmailSyncTokenBucketRateLimiter {
  private readonly buckets = new Map<string, TokenBucketState>();

  async acquire(
    bucketKey: string,
    policy: Pick<EmailSyncProviderPolicy, 'delayMs' | 'rateLimit'>,
  ): Promise<void> {
    const capacity = Math.max(1, Math.round(policy.rateLimit.capacity));
    const refillPerSecond = Math.max(policy.rateLimit.refillPerSecond, 0.0001);
    const refillPerMs = refillPerSecond / 1000;
    const delayMs = Math.max(0, Math.round(policy.delayMs));

    for (;;) {
      const now = Date.now();
      const bucket = this.refillBucket(bucketKey, now, capacity, refillPerMs);
      const waitForDelay = Math.max(0, bucket.nextAllowedAt - now);

      if (bucket.tokens >= 1 && waitForDelay === 0) {
        bucket.tokens -= 1;
        bucket.nextAllowedAt = now + delayMs;
        return;
      }

      const waitForToken =
        bucket.tokens >= 1 ? 0 : Math.ceil((1 - bucket.tokens) / refillPerMs);
      await delay(Math.max(waitForDelay, waitForToken, 1));
    }
  }

  reset(): void {
    this.buckets.clear();
  }

  private refillBucket(
    bucketKey: string,
    now: number,
    capacity: number,
    refillPerMs: number,
  ): TokenBucketState {
    const existing = this.buckets.get(bucketKey);
    if (!existing) {
      const initialState: TokenBucketState = {
        tokens: capacity,
        lastRefillAt: now,
        nextAllowedAt: now,
      };
      this.buckets.set(bucketKey, initialState);
      return initialState;
    }

    const elapsedMs = Math.max(0, now - existing.lastRefillAt);
    if (elapsedMs > 0) {
      existing.tokens = Math.min(
        capacity,
        existing.tokens + elapsedMs * refillPerMs,
      );
      existing.lastRefillAt = now;
    }

    return existing;
  }
}

export const sharedEmailSyncRateLimiter = new EmailSyncTokenBucketRateLimiter();
