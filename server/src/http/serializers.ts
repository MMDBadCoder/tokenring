import type { ProviderRow, RequestLogRow, UpstreamKeyRow, VirtualKeyRow } from '../db/types.js';
import { measureCapacity, type KeyCapacity } from '../core/balancer.js';
import type { UsageTotals } from '../db/repositories/stats.js';

export type UpstreamKeyStatus = 'active' | 'saturated' | 'cooling' | 'disabled';

export const EMPTY_USAGE: UsageTotals = {
  requests: 0,
  succeeded: 0,
  failed: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  avgLatencyMs: 0,
};

function statusOf(capacity: KeyCapacity): UpstreamKeyStatus {
  if (!capacity.key.enabled) return 'disabled';
  if (capacity.blockedBy === 'cooling_down') return 'cooling';
  if (capacity.blockedBy) return 'saturated';
  return 'active';
}

export function serializeProvider(row: ProviderRow) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeUpstreamKey(
  row: UpstreamKeyRow,
  options: { providerName?: string; usage?: UsageTotals; at?: number } = {},
) {
  const capacity = measureCapacity(row, options.at ?? Date.now());
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: options.providerName ?? '',
    label: row.label,
    owner: row.owner,
    secretHint: row.secret_hint,
    rpmLimit: row.rpm_limit,
    tpmLimit: row.tpm_limit,
    dailyRequestLimit: row.daily_request_limit,
    weight: row.weight,
    enabled: row.enabled === 1,
    notes: row.notes,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    consecutiveFailures: row.consecutive_failures,
    cooldownUntil: row.cooldown_until,
    cooldownReason: row.cooldown_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    live: {
      status: statusOf(capacity),
      blockedBy: capacity.blockedBy,
      readyAt: Number.isFinite(capacity.readyAt) ? capacity.readyAt : null,
      requestsUsed: capacity.requestsUsed,
      tokensUsed: capacity.tokensUsed,
      requestsToday: capacity.requestsToday,
      load: capacity.load,
    },
    usage: options.usage ?? EMPTY_USAGE,
  };
}

export function serializeVirtualKey(
  row: VirtualKeyRow,
  options: { usage?: UsageTotals; requestsUsed?: number; tokensToday?: number } = {},
) {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    keyHint: row.key_hint,
    enabled: row.enabled === 1,
    rpmLimit: row.rpm_limit,
    dailyRequestLimit: row.daily_request_limit,
    dailyTokenLimit: row.daily_token_limit,
    allowedModels: row.allowed_models ? row.allowed_models.split(',').filter(Boolean) : [],
    providerId: row.provider_id,
    expiresAt: row.expires_at,
    notes: row.notes,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    live: {
      requestsUsed: options.requestsUsed ?? 0,
      tokensToday: options.tokensToday ?? 0,
      expired: row.expires_at > 0 && row.expires_at <= Date.now(),
    },
    usage: options.usage ?? EMPTY_USAGE,
  };
}

export function serializeRequestLog(row: RequestLogRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    virtualKeyId: row.virtual_key_id,
    upstreamKeyId: row.upstream_key_id,
    providerId: row.provider_id,
    method: row.method,
    path: row.path,
    model: row.model,
    statusCode: row.status_code,
    succeeded: row.succeeded === 1,
    streamed: row.streamed === 1,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    tokenSource: row.token_source,
    latencyMs: row.latency_ms,
    ttfbMs: row.ttfb_ms,
    attempts: row.attempts,
    errorKind: row.error_kind,
    errorMessage: row.error_message,
    clientIp: row.client_ip,
  };
}
