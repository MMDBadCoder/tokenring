export interface UsageTotals {
  requests: number;
  succeeded: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export type UpstreamKeyStatus = 'active' | 'saturated' | 'cooling' | 'disabled';

export interface UpstreamKey {
  id: string;
  providerId: string;
  providerName: string;
  label: string;
  owner: string;
  secretHint: string;
  rpmLimit: number;
  tpmLimit: number;
  dailyRequestLimit: number;
  weight: number;
  enabled: boolean;
  notes: string;
  lastUsedAt: number;
  lastError: string;
  lastErrorAt: number;
  consecutiveFailures: number;
  cooldownUntil: number;
  cooldownReason: string;
  createdAt: number;
  updatedAt: number;
  live: {
    status: UpstreamKeyStatus;
    blockedBy: string | null;
    readyAt: number | null;
    requestsUsed: number;
    tokensUsed: number;
    requestsToday: number;
    load: number;
  };
  usage: UsageTotals;
}

export interface VirtualKey {
  id: string;
  name: string;
  owner: string;
  keyHint: string;
  enabled: boolean;
  rpmLimit: number;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  allowedModels: string[];
  providerId: string | null;
  expiresAt: number;
  notes: string;
  lastUsedAt: number;
  createdAt: number;
  updatedAt: number;
  live: { requestsUsed: number; tokensToday: number; expired: boolean };
  usage: UsageTotals;
}

export interface RequestLog {
  id: number;
  createdAt: number;
  virtualKeyId: string | null;
  upstreamKeyId: string | null;
  providerId: string | null;
  method: string;
  path: string;
  model: string;
  statusCode: number;
  succeeded: boolean;
  streamed: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  tokenSource: string;
  latencyMs: number;
  ttfbMs: number;
  attempts: number;
  errorKind: string;
  errorMessage: string;
  clientIp: string;
}

export interface BucketPoint extends UsageTotals {
  bucketStart: number;
}

export interface Overview {
  window: { from: number; to: number; bucketMs: number; label: string };
  totals: UsageTotals;
  previousTotals: UsageTotals;
  timeseries: BucketPoint[];
  models: (UsageTotals & { id: string })[];
  errors: { kind: string; count: number }[];
  live: { requestsPerMinute: number; tokensPerMinute: number };
  pool: {
    total: number;
    active: number;
    cooling: number;
    saturated: number;
    disabled: number;
    headroomPerMinute: number | null;
  };
  upstreamKeys: {
    id: string;
    label: string;
    owner: string;
    enabled: boolean;
    rpmLimit: number;
    requestsUsed: number;
    load: number;
    blockedBy: string | null;
    usage: UsageTotals | null;
  }[];
  virtualKeys: {
    id: string;
    name: string;
    owner: string;
    enabled: boolean;
    usage: UsageTotals | null;
  }[];
  providers: { id: string; name: string; baseUrl: string; isDefault: boolean }[];
}

export const BALANCING_STRATEGIES = [
  'round_robin',
  'least_loaded',
  'weighted_random',
  'failover',
] as const;

export type BalancingStrategy = (typeof BALANCING_STRATEGIES)[number];

export interface RuntimeSettings {
  strategy: BalancingStrategy;
  maxAttempts: number;
  requestTimeoutMs: number;
  rateLimitCooldownSeconds: number;
  failureCooldownSeconds: number;
  failureThreshold: number;
  disableOnAuthError: boolean;
  waitForCapacityMs: number;
  injectUsageTracking: boolean;
  estimateMissingTokens: boolean;
  forwardRateLimitHeaders: boolean;
  logRetentionDays: number;
}
