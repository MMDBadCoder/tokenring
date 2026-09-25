import type { ServerResponse } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

import type { ProviderRow, UpstreamKeyRow, VirtualKeyRow } from '../db/types.js';
import { providersRepo } from '../db/repositories/providers.js';
import { upstreamKeysRepo } from '../db/repositories/upstreamKeys.js';
import { virtualKeysRepo } from '../db/repositories/virtualKeys.js';
import { requestLogsRepo } from '../db/repositories/requestLogs.js';
import { settingsRepo, type RuntimeSettings } from '../db/repositories/settings.js';
import { selectUpstreamKey } from './balancer.js';
import { usageWindows } from './usageWindows.js';
import { decryptSecret } from '../util/secrets.js';
import { MINUTE } from '../util/time.js';
import {
  ProxyError,
  forbidden,
  rateLimited,
  serviceUnavailable,
  badGateway,
} from './apiErrors.js';
import {
  SseUsageScanner,
  estimateTokensFromChars,
  extractUsageFromJsonBody,
  inspectRequest,
  measureCompletionChars,
  withUsageTracking,
  type TokenUsage,
} from './openaiProtocol.js';
import {
  classifyNetworkError,
  classifyStatus,
  copyResponseHeaders,
  dispatch,
  parseRetryAfter,
  type FailureKind,
} from './upstreamClient.js';

export interface ProxyContext {
  method: string;
  path: string;
  search: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer | null;
  clientIp: string;
  virtualKey: VirtualKeyRow;
}

const NO_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** Human-readable explanation for each way the pool can be unavailable. */
const UNAVAILABLE_MESSAGES: Record<string, string> = {
  no_keys: 'No upstream API key is configured for this provider.',
  disabled: 'Every upstream API key in the pool is disabled.',
  cooling_down: 'Every upstream API key is temporarily quarantined after errors.',
  rpm_exhausted: 'Every upstream API key has reached its per-minute request limit.',
  tpm_exhausted: 'Every upstream API key has reached its per-minute token limit.',
  daily_exhausted: 'Every upstream API key has reached its daily request limit.',
};

function assertVirtualKeyAllowed(
  virtualKey: VirtualKeyRow,
  model: string,
  at: number,
): void {
  if (!virtualKey.enabled) {
    throw forbidden('This TokenRing key has been disabled.', 'key_disabled');
  }
  if (virtualKey.expires_at > 0 && virtualKey.expires_at <= at) {
    throw forbidden('This TokenRing key has expired.', 'key_expired');
  }

  const allowed = virtualKey.allowed_models
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (model && allowed.length > 0 && !allowed.includes(model)) {
    throw forbidden(
      `Model "${model}" is not permitted for this key. Allowed: ${allowed.join(', ')}.`,
      'model_not_allowed',
    );
  }

  if (virtualKey.rpm_limit > 0) {
    const used = usageWindows.requestsInWindow(virtualKey.id, at);
    if (used >= virtualKey.rpm_limit) {
      throw rateLimited(
        `This TokenRing key is limited to ${virtualKey.rpm_limit} requests per minute.`,
        'key_rpm_exceeded',
        Math.max(0, usageWindows.nextSlotAt(virtualKey.id, at) - at),
      );
    }
  }
  if (virtualKey.daily_request_limit > 0) {
    const used = usageWindows.requestsToday(virtualKey.id, at);
    if (used >= virtualKey.daily_request_limit) {
      throw rateLimited(
        `This TokenRing key is limited to ${virtualKey.daily_request_limit} requests per day.`,
        'key_daily_requests_exceeded',
        Math.max(0, usageWindows.nextDayAt(at) - at),
      );
    }
  }
  if (virtualKey.daily_token_limit > 0) {
    const used = usageWindows.tokensToday(virtualKey.id, at);
    if (used >= virtualKey.daily_token_limit) {
      throw rateLimited(
        `This TokenRing key is limited to ${virtualKey.daily_token_limit} tokens per day.`,
        'key_daily_tokens_exceeded',
        Math.max(0, usageWindows.nextDayAt(at) - at),
      );
    }
  }
}

function resolveProvider(virtualKey: VirtualKeyRow): ProviderRow {
  const provider = virtualKey.provider_id
    ? providersRepo.get(virtualKey.provider_id)
    : providersRepo.getDefault();
  if (!provider) {
    throw serviceUnavailable(
      'No upstream provider is configured. Add one in the TokenRing dashboard.',
      'no_provider',
    );
  }
  return provider;
}

/** Applies the cooldown / quarantine policy after a key misbehaves. */
function penaliseKey(
  key: UpstreamKeyRow,
  failure: FailureKind,
  detail: string,
  retryAfterMs: number | null,
  settings: RuntimeSettings,
): void {
  const at = Date.now();
  if (failure === 'auth_failed' && settings.disableOnAuthError) {
    upstreamKeysRepo.disable(key.id, 'auth_failed', detail);
    return;
  }
  if (failure === 'rate_limited') {
    const cooldown = retryAfterMs ?? settings.rateLimitCooldownSeconds * 1000;
    upstreamKeysRepo.markFailure(key.id, at + cooldown, 'rate_limited', detail);
    return;
  }
  // Transient failures only quarantine once a key fails repeatedly.
  const failures = key.consecutive_failures + 1;
  const cooldownUntil =
    failures >= settings.failureThreshold ? at + settings.failureCooldownSeconds * 1000 : 0;
  upstreamKeysRepo.markFailure(key.id, cooldownUntil, failure, detail);
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '';
  }
}

function sendError(res: ServerResponse, error: ProxyError): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (error.retryAfterMs !== undefined) {
    headers['retry-after'] = String(Math.ceil(error.retryAfterMs / 1000));
  }
  res.writeHead(error.status, headers);
  res.end(JSON.stringify(error.toBody()));
}

interface Attempt {
  key: UpstreamKeyRow;
  failure: FailureKind;
  detail: string;
}

/**
 * Runs one client request end to end: picks a key, forwards, retries on a
 * different key when the upstream rejects us, streams the reply back, and
 * records exactly what it cost.
 */
export async function runProxyRequest(ctx: ProxyContext, res: ServerResponse): Promise<void> {
  const settings = settingsRepo.all();
  const requestAt = Date.now();
  const inspected = inspectRequest(ctx.body);

  const log = {
    createdAt: requestAt,
    virtualKeyId: ctx.virtualKey.id,
    upstreamKeyId: null as string | null,
    providerId: null as string | null,
    method: ctx.method,
    path: ctx.path,
    model: inspected.model,
    statusCode: 0,
    succeeded: false,
    streamed: inspected.stream,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    tokenSource: 'none' as 'upstream' | 'estimated' | 'none',
    latencyMs: 0,
    ttfbMs: 0,
    attempts: 0,
    errorKind: '',
    errorMessage: '',
    clientIp: ctx.clientIp,
  };

  const finish = (): void => {
    log.latencyMs = Date.now() - requestAt;
    requestLogsRepo.insert(log);
  };

  const fail = (error: ProxyError): void => {
    log.statusCode = error.status;
    log.errorKind = error.code;
    log.errorMessage = error.message;
    finish();
    sendError(res, error);
  };

  let provider: ProviderRow;
  try {
    assertVirtualKeyAllowed(ctx.virtualKey, inspected.model, requestAt);
    provider = resolveProvider(ctx.virtualKey);
  } catch (error) {
    fail(error as ProxyError);
    return;
  }
  log.providerId = provider.id;

  // The client's own body is reused verbatim on every retry.
  let outgoingBody = ctx.body;
  if (settings.injectUsageTracking && inspected.json) {
    outgoingBody = withUsageTracking(inspected.json) ?? ctx.body;
  }

  usageWindows.recordRequest(ctx.virtualKey.id, requestAt);
  virtualKeysRepo.markUsed(ctx.virtualKey.id, requestAt);

  const tried = new Set<string>();
  const waitDeadline = requestAt + settings.waitForCapacityMs;
  let lastAttempt: Attempt | null = null;

  for (let attempt = 1; attempt <= settings.maxAttempts; attempt += 1) {
    const candidates = upstreamKeysRepo.listUsable(provider.id);
    let selection = selectUpstreamKey(candidates, settings.strategy, {
      excluded: tried,
      cursorKey: provider.id,
    });

    // Every key is saturated: hold the request briefly rather than failing it.
    while (selection.kind === 'unavailable' && selection.reason !== 'no_keys') {
      const now = Date.now();
      const waitFor = Math.min(selection.readyAt - now, waitDeadline - now, 1000);
      if (waitFor <= 0) break;
      await sleep(waitFor);
      selection = selectUpstreamKey(upstreamKeysRepo.listUsable(provider.id), settings.strategy, {
        excluded: tried,
        cursorKey: provider.id,
      });
    }

    if (selection.kind === 'unavailable') {
      // Fall back to reporting the last real upstream failure when there was one.
      if (lastAttempt) {
        fail(
          badGateway(
            `Upstream request failed (${lastAttempt.failure}) on every available key. ${lastAttempt.detail}`.trim(),
            lastAttempt.failure,
          ),
        );
        return;
      }
      const retryAfterMs = Number.isFinite(selection.readyAt)
        ? Math.max(0, selection.readyAt - Date.now())
        : MINUTE;
      log.attempts = attempt - 1;
      fail(
        selection.reason === 'no_keys'
          ? serviceUnavailable(UNAVAILABLE_MESSAGES.no_keys!, 'no_upstream_key')
          : rateLimited(
              `${UNAVAILABLE_MESSAGES[selection.reason] ?? 'The key pool is saturated.'} Try again shortly.`,
              'pool_exhausted',
              retryAfterMs,
            ),
      );
      return;
    }

    const key = selection.capacity.key;
    tried.add(key.id);
    log.attempts = attempt;
    log.upstreamKeyId = key.id;

    const dispatchedAt = Date.now();
    usageWindows.recordRequest(key.id, dispatchedAt);
    upstreamKeysRepo.markUsed(key.id, dispatchedAt);

    let result;
    try {
      result = await dispatch({
        baseUrl: provider.base_url,
        path: ctx.path,
        search: ctx.search,
        method: ctx.method,
        headers: ctx.headers,
        body: outgoingBody,
        secret: decryptSecret(key.secret_encrypted),
        timeoutMs: settings.requestTimeoutMs,
      });
    } catch (error) {
      const failure = classifyNetworkError(error);
      const detail = error instanceof Error ? error.message : String(error);
      penaliseKey(key, failure, detail, null, settings);
      lastAttempt = { key, failure, detail };
      continue;
    }

    const { response, ttfbMs, abort } = result;
    log.ttfbMs = ttfbMs;
    const failure = classifyStatus(response.status);

    if (failure) {
      const detail = await readErrorDetail(response);
      abort();
      penaliseKey(key, failure, detail, parseRetryAfter(response.headers.get('retry-after')), settings);
      lastAttempt = { key, failure, detail };

      if (attempt < settings.maxAttempts) continue;

      // Out of attempts: hand the upstream's own error back, unchanged.
      log.statusCode = response.status;
      log.errorKind = failure;
      log.errorMessage = detail;
      finish();
      if (!res.headersSent) {
        res.writeHead(response.status, {
          'content-type': response.headers.get('content-type') ?? 'application/json',
        });
      }
      res.end(detail);
      return;
    }

    upstreamKeysRepo.markSuccess(key.id);
    log.statusCode = response.status;
    log.succeeded = response.status < 400;

    await deliver(response, res, {
      log,
      settings,
      inspected,
      virtualKeyId: ctx.virtualKey.id,
      upstreamKeyId: key.id,
      requestAt,
      dispatchedAt,
      onDone: () => {
        abort();
        finish();
      },
    });
    return;
  }

  if (lastAttempt) {
    fail(
      badGateway(
        `Upstream request failed (${lastAttempt.failure}) after ${settings.maxAttempts} attempts. ${lastAttempt.detail}`.trim(),
        lastAttempt.failure,
      ),
    );
    return;
  }
  fail(serviceUnavailable(UNAVAILABLE_MESSAGES.no_keys!, 'no_upstream_key'));
}

interface DeliverOptions {
  log: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    tokenSource: 'upstream' | 'estimated' | 'none';
    streamed: boolean;
    succeeded: boolean;
    errorKind: string;
    errorMessage: string;
  };
  settings: RuntimeSettings;
  inspected: { promptChars: number; model: string };
  virtualKeyId: string;
  upstreamKeyId: string;
  requestAt: number;
  dispatchedAt: number;
  onDone: () => void;
}

/** Forwards the upstream response to the client and books the tokens it used. */
async function deliver(
  response: Response,
  res: ServerResponse,
  options: DeliverOptions,
): Promise<void> {
  const { log, settings, inspected } = options;
  const contentType = response.headers.get('content-type') ?? '';
  const headers = copyResponseHeaders(response, {
    forwardRateLimitHeaders: settings.forwardRateLimitHeaders,
  });

  const book = (usage: TokenUsage, source: 'upstream' | 'estimated' | 'none'): void => {
    log.promptTokens = usage.promptTokens;
    log.completionTokens = usage.completionTokens;
    log.totalTokens = usage.totalTokens;
    log.tokenSource = source;
    usageWindows.recordTokens(options.upstreamKeyId, usage.totalTokens, options.dispatchedAt);
    usageWindows.recordTokens(options.virtualKeyId, usage.totalTokens, options.requestAt);
  };

  // Only completion-style calls have tokens to estimate; `GET /v1/models`
  // and similar metadata endpoints are left at zero.
  const canEstimate = settings.estimateMissingTokens && inspected.model !== '';

  const estimate = (completionChars: number): TokenUsage => {
    const promptTokens = estimateTokensFromChars(inspected.promptChars);
    const completionTokens = estimateTokensFromChars(completionChars);
    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
  };

  if (!response.body) {
    res.writeHead(response.status, headers);
    res.end();
    options.onDone();
    return;
  }

  const isEventStream = contentType.includes('text/event-stream');
  const isJson = contentType.includes('application/json');

  if (isJson && !isEventStream) {
    const buffer = Buffer.from(await response.arrayBuffer());
    const usage = extractUsageFromJsonBody(buffer);
    if (usage) book(usage, 'upstream');
    else if (canEstimate) book(estimate(measureCompletionChars(buffer)), 'estimated');
    else book(NO_USAGE, 'none');

    res.writeHead(response.status, { ...headers, 'content-length': String(buffer.byteLength) });
    res.end(buffer);
    options.onDone();
    return;
  }

  log.streamed = isEventStream;
  const scanner = isEventStream ? new SseUsageScanner() : null;
  res.writeHead(response.status, headers);

  const reader = response.body.getReader();
  let clientGone = false;
  const onClose = (): void => {
    clientGone = true;
    void reader.cancel().catch(() => undefined);
  };
  res.on('close', onClose);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || clientGone) break;
      scanner?.push(value);
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => res.once('drain', resolve));
      }
    }
    scanner?.finish();
  } catch (error) {
    log.succeeded = false;
    log.errorKind = 'stream_interrupted';
    log.errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    res.off('close', onClose);
  }

  if (clientGone) {
    log.succeeded = false;
    log.errorKind = log.errorKind || 'client_disconnected';
  }

  const usage = scanner?.getUsage();
  if (usage) book(usage, 'upstream');
  else if (canEstimate) book(estimate(scanner?.getCompletionChars() ?? 0), 'estimated');
  else book(NO_USAGE, 'none');

  if (!res.writableEnded) res.end();
  options.onDone();
}
