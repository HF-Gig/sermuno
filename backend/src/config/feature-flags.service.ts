import { Injectable } from '@nestjs/common';

export interface FeatureFlags {
  ENABLE_IMAP_SYNC: boolean;
  ENABLE_CALENDAR: boolean;
  ENABLE_WEBHOOKS: boolean;
  ENABLE_STREAMING_SYNC: boolean;
  ENABLE_PUSH_NOTIFICATIONS: boolean;
  ENABLE_SLACK_NOTIFICATIONS: boolean;
  ENABLE_CRM_AUTO_CREATE: boolean;
}

const FLAG_KEYS: (keyof FeatureFlags)[] = [
  'ENABLE_IMAP_SYNC',
  'ENABLE_CALENDAR',
  'ENABLE_WEBHOOKS',
  'ENABLE_STREAMING_SYNC',
  'ENABLE_PUSH_NOTIFICATIONS',
  'ENABLE_SLACK_NOTIFICATIONS',
  'ENABLE_CRM_AUTO_CREATE',
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
    for (const [key, value] of Object.entries(updates) as [
      keyof FeatureFlags,
      boolean,
    ][]) {
      if (FLAG_KEYS.includes(key)) {
        process.env[key] = value ? 'true' : 'false';
      }
    }
    return this.getAll();
  }
}
