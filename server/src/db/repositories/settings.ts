import { db } from '../database.js';

export const BALANCING_STRATEGIES = [
  'round_robin',
  'least_loaded',
  'weighted_random',
  'failover',
] as const;

export type BalancingStrategy = (typeof BALANCING_STRATEGIES)[number];

export interface RuntimeSettings {
  /** How the next upstream key is chosen for each request. */
  strategy: BalancingStrategy;
  /** Distinct upstream keys to try before giving up on a request. */
  maxAttempts: number;
  /** Abort an upstream request that produces no response within this budget. */
  requestTimeoutMs: number;
  /** Fallback quarantine length after a 429 that carries no Retry-After. */
  rateLimitCooldownSeconds: number;
  /** Quarantine length after connection errors or 5xx responses. */
  failureCooldownSeconds: number;
  /** Consecutive failures tolerated before a key is quarantined. */
  failureThreshold: number;
  /** Disable a key outright when the upstream rejects its credentials. */
  disableOnAuthError: boolean;
  /** Hold a request while every key is saturated, instead of returning 429. */
  waitForCapacityMs: number;
  /** Ask the upstream for token counts on streamed responses. */
  injectUsageTracking: boolean;
  /** Approximate token counts when the upstream reports none. */
  estimateMissingTokens: boolean;
  /** Forward the upstream's own x-ratelimit-* headers to the client. */
  forwardRateLimitHeaders: boolean;
  /** Days of request history to keep. 0 keeps everything. */
  logRetentionDays: number;
}

export const DEFAULT_SETTINGS: RuntimeSettings = {
  strategy: 'least_loaded',
  maxAttempts: 3,
  requestTimeoutMs: 120_000,
  rateLimitCooldownSeconds: 20,
  failureCooldownSeconds: 30,
  failureThreshold: 3,
  disableOnAuthError: true,
  waitForCapacityMs: 10_000,
  injectUsageTracking: true,
  estimateMissingTokens: true,
  forwardRateLimitHeaders: false,
  logRetentionDays: 30,
};

const INTERNAL_PREFIX = 'internal.';

function coerce<K extends keyof RuntimeSettings>(
  key: K,
  raw: string,
): RuntimeSettings[K] | undefined {
  const fallback = DEFAULT_SETTINGS[key];
  if (typeof fallback === 'number') {
    const parsed = Number(raw);
    return (Number.isFinite(parsed) ? parsed : fallback) as RuntimeSettings[K];
  }
  if (typeof fallback === 'boolean') {
    return (raw === 'true') as RuntimeSettings[K];
  }
  if (key === 'strategy') {
    return (BALANCING_STRATEGIES.includes(raw as BalancingStrategy)
      ? raw
      : fallback) as RuntimeSettings[K];
  }
  return raw as RuntimeSettings[K];
}

export const settingsRepo = {
  all(): RuntimeSettings {
    const rows = db().prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    const result = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key.startsWith(INTERNAL_PREFIX)) continue;
      if (!(row.key in DEFAULT_SETTINGS)) continue;
      const key = row.key as keyof RuntimeSettings;
      const value = coerce(key, row.value);
      if (value !== undefined) (result as Record<string, unknown>)[key] = value;
    }
    return result;
  },

  save(patch: Partial<RuntimeSettings>): RuntimeSettings {
    const statement = db().prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    const timestamp = Date.now();
    db().transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
        statement.run(key, String(value), timestamp);
      }
    })();
    return settingsRepo.all();
  },

  getInternal(key: string): string | undefined {
    const row = db()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(INTERNAL_PREFIX + key) as { value: string } | undefined;
    return row?.value;
  },

  setInternal(key: string, value: string): void {
    db()
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(INTERNAL_PREFIX + key, value, Date.now());
  },
};
