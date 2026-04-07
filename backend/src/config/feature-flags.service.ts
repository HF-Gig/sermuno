import { BadRequestException, Injectable } from '@nestjs/common';

export interface FeatureFlags {
  ENABLE_IMAP_SYNC: boolean;
  ENABLE_CALENDAR: boolean;
  ENABLE_WEBHOOKS: boolean;
  ENABLE_STREAMING_SYNC: boolean;
  ENABLE_BACKPRESSURE: boolean;
  ENABLE_SMART_BACKOFF: boolean;
  ENABLE_PUSH_NOTIFICATIONS: boolean;
  ENABLE_SLACK_NOTIFICATIONS: boolean;
  ENABLE_CRM_AUTO_CREATE: boolean;
  DISABLE_IMAP_SYNC: boolean;
  DISABLE_SMTP_SEND: boolean;
  DISABLE_RULES_EVALUATION: boolean;
  DISABLE_THREADING: boolean;
}

const FLAG_KEYS: (keyof FeatureFlags)[] = [
  'ENABLE_IMAP_SYNC',
  'ENABLE_CALENDAR',
  'ENABLE_WEBHOOKS',
  'ENABLE_STREAMING_SYNC',
  'ENABLE_BACKPRESSURE',
  'ENABLE_SMART_BACKOFF',
  'ENABLE_PUSH_NOTIFICATIONS',
  'ENABLE_SLACK_NOTIFICATIONS',
  'ENABLE_CRM_AUTO_CREATE',
  'DISABLE_IMAP_SYNC',
  'DISABLE_SMTP_SEND',
  'DISABLE_RULES_EVALUATION',
  'DISABLE_THREADING',
];

/** Flags that default to TRUE when env var is absent */
const DEFAULT_TRUE_FLAGS = new Set<keyof FeatureFlags>([
  'ENABLE_IMAP_SYNC',
  'ENABLE_CALENDAR',
  'ENABLE_WEBHOOKS',
  'ENABLE_CRM_AUTO_CREATE',
]);

function readFlag(key: keyof FeatureFlags): boolean {
  const val = process.env[key];
  if (val === undefined) {
    return DEFAULT_TRUE_FLAGS.has(key);
  }
  return val !== 'false' && val !== '0';
}

function isKnownFlagKey(key: string): key is keyof FeatureFlags {
  return FLAG_KEYS.includes(key as keyof FeatureFlags);
}

@Injectable()
export class FeatureFlagsService {
  /** Read all feature flags from env at call time (never cached at build time). */
  getAll(): FeatureFlags {
    const flags = {} as FeatureFlags;
    for (const key of FLAG_KEYS) {
      flags[key] = readFlag(key);
    }
    return flags;
  }

  /** Read a single flag. */
  get(key: keyof FeatureFlags): boolean {
    return readFlag(key);
  }

  /** Alias for get() — returns true if the flag is enabled. */
  isEnabled(key: keyof FeatureFlags): boolean {
    return readFlag(key);
  }

  /**
   * Mutate process.env in-memory to toggle flags.
   * Returns the resulting flag state.
   */
  patch(updates: Partial<Record<keyof FeatureFlags, boolean>>): FeatureFlags {
    const unknownKeys = Object.keys(updates).filter(
      (key) => !isKnownFlagKey(key),
    );
    if (unknownKeys.length > 0) {
      throw new BadRequestException(
        `Unknown feature flag key(s): ${unknownKeys.join(', ')}`,
      );
    }

    for (const [rawKey, rawValue] of Object.entries(updates)) {
      if (!isKnownFlagKey(rawKey)) continue;
      if (typeof rawValue !== 'boolean') {
        throw new BadRequestException(
          `Feature flag "${rawKey}" must be a boolean value`,
        );
      }
      process.env[rawKey] = rawValue ? 'true' : 'false';
    }
    return this.getAll();
  }
}
