import { Agent, fetch, type Response } from 'undici';

// Disable hidden response-header/body idle limits. Our per-request timer owns
// the entire response deadline; connection establishment still has a 10s limit.
const upstreamAgent = new Agent({
  headersTimeout: 0,
  bodyTimeout: 0,
  connect: { timeout: 10_000 },
});

export async function closeUpstreamClient(): Promise<void> {
  await upstreamAgent.close();
}

/** Headers that belong to a single hop and must never be forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

/** Client headers TokenRing replaces or recomputes on the way out. */
const STRIPPED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP,
  'authorization',
  'host',
  'content-length',
  'accept-encoding',
  'cookie',
  'api-key',
  'x-api-key',
]);

const STRIPPED_RESPONSE_HEADERS = new Set([...HOP_BY_HOP, 'content-encoding', 'content-length']);

export type FailureKind =
  | 'rate_limited'
  | 'auth_failed'
  | 'upstream_error'
  | 'network_error'
  | 'timeout';

export interface DispatchRequest {
  baseUrl: string;
  path: string;
  search: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer | null;
  secret: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface DispatchResult {
  response: Response;
  ttfbMs: number;
  dispose: () => void;
}

export function buildUpstreamUrl(baseUrl: string, path: string, search: string): string {
  // Clients talk to `<proxy>/v1/...`; the provider base URL already carries its
  // own version segment, so the `/v1` prefix is stripped before joining.
  const suffix = path.replace(/^\/v1(?=\/|$)/, '') || '/';
  return `${baseUrl.replace(/\/+$/, '')}${suffix}${search}`;
}

export function buildForwardHeaders(
  incoming: Record<string, string | string[] | undefined>,
  secret: string,
  body: Buffer | null,
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set('authorization', `Bearer ${secret}`);
  headers.set('accept-encoding', 'identity');
  if (body) headers.set('content-length', String(body.byteLength));
  return headers;
}

export function copyResponseHeaders(
  response: Response,
  options: { forwardRateLimitHeaders: boolean },
): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(lower)) return;
    if (!options.forwardRateLimitHeaders && lower.startsWith('x-ratelimit-')) return;
    headers[name] = value;
  });
  return headers;
}

export async function dispatch(request: DispatchRequest): Promise<DispatchResult> {
  const controller = new AbortController();
  const timer = request.timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error('timeout')), request.timeoutMs)
    : undefined;
  timer?.unref();
  const onAbort = (): void => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', onAbort, { once: true });
  if (request.signal?.aborted) onAbort();
  const dispose = (): void => {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
    // Also release a response body abandoned by the caller.
    controller.abort();
  };
  const startedAt = Date.now();

  try {
    const response = await fetch(
      buildUpstreamUrl(request.baseUrl, request.path, request.search),
      {
        method: request.method,
        headers: buildForwardHeaders(request.headers, request.secret, request.body),
        body: request.body ?? undefined,
        signal: controller.signal,
        redirect: 'follow',
        dispatcher: upstreamAgent,
      },
    );
    return {
      response,
      ttfbMs: Date.now() - startedAt,
      // Keep the deadline active until the complete body has been delivered.
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export function classifyStatus(status: number): FailureKind | null {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_failed';
  if (status >= 500) return 'upstream_error';
  return null;
}

export function classifyNetworkError(error: unknown): FailureKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout/i.test(message)) return 'timeout';
  return 'network_error';
}

/** Reads `Retry-After` in either of its two legal forms, in milliseconds. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}
