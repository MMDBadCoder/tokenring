/**
 * Everything TokenRing needs to know about the OpenAI wire format.
 *
 * The proxy is deliberately shallow: it forwards bytes untouched unless a
 * setting asks otherwise, and only reads the few fields it needs for routing
 * and accounting (`model`, `stream`, `usage`).
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface InspectedRequest {
  json: Record<string, unknown> | null;
  model: string;
  stream: boolean;
  /** Characters of prompt text, used only when the upstream reports no usage. */
  promptChars: number;
}

/** Roughly four characters per token — close enough for a fallback estimate. */
export function estimateTokensFromChars(chars: number): number {
  return Math.max(0, Math.ceil(chars / 4));
}

function countPromptChars(json: Record<string, unknown>): number {
  let chars = 0;
  const visit = (value: unknown): void => {
    if (typeof value === 'string') chars += value.length;
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const field of ['messages', 'prompt', 'input']) {
    if (field in json) visit(json[field]);
  }
  return chars;
}

export function inspectRequest(body: Buffer | null): InspectedRequest {
  if (!body || body.length === 0) {
    return { json: null, model: '', stream: false, promptChars: 0 };
  }
  try {
    const json = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { json: null, model: '', stream: false, promptChars: 0 };
    }
    return {
      json,
      model: typeof json.model === 'string' ? json.model : '',
      stream: json.stream === true,
      promptChars: countPromptChars(json),
    };
  } catch {
    return { json: null, model: '', stream: false, promptChars: 0 };
  }
}

/**
 * Asks the upstream to append a usage chunk to a streamed response.
 * Returns the re-serialised body, or null when nothing needed changing.
 */
export function withUsageTracking(json: Record<string, unknown>): Buffer | null {
  if (json.stream !== true) return null;
  const existing = json.stream_options;
  if (existing && typeof existing === 'object' && 'include_usage' in existing) return null;
  const next = {
    ...json,
    stream_options: { ...(existing as object | undefined), include_usage: true },
  };
  return Buffer.from(JSON.stringify(next), 'utf8');
}

export function extractUsage(payload: unknown): TokenUsage | null {
  if (!payload || typeof payload !== 'object') return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return null;

  const read = (...names: string[]): number => {
    for (const name of names) {
      const value = (usage as Record<string, unknown>)[name];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return 0;
  };

  // `input_tokens`/`output_tokens` cover the Responses API spelling.
  const promptTokens = read('prompt_tokens', 'input_tokens');
  const completionTokens = read('completion_tokens', 'output_tokens');
  const totalTokens = read('total_tokens') || promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return null;
  return { promptTokens, completionTokens, totalTokens };
}

/** Characters of generated text in a non-streamed reply, for fallback estimates. */
export function measureCompletionChars(body: Buffer): number {
  try {
    const json = JSON.parse(body.toString('utf8')) as { choices?: unknown };
    if (!Array.isArray(json.choices)) return 0;
    let chars = 0;
    for (const choice of json.choices) {
      const message = (choice as { message?: { content?: unknown } }).message;
      const text = (choice as { text?: unknown }).text;
      if (typeof text === 'string') chars += text.length;
      if (typeof message?.content === 'string') chars += message.content.length;
    }
    return chars;
  } catch {
    return 0;
  }
}

export function extractUsageFromJsonBody(body: Buffer): TokenUsage | null {
  try {
    return extractUsage(JSON.parse(body.toString('utf8')));
  } catch {
    return null;
  }
}

/**
 * Reads a `text/event-stream` response as it flows past, keeping only the token
 * usage and the volume of generated text. Never buffers the whole response.
 */
export class SseUsageScanner {
  private pending = '';
  private usage: TokenUsage | null = null;
  private completionChars = 0;

  push(chunk: Uint8Array): void {
    this.pending += Buffer.from(chunk).toString('utf8');
    let newline = this.pending.indexOf('\n');
    while (newline !== -1) {
      this.consumeLine(this.pending.slice(0, newline).trim());
      this.pending = this.pending.slice(newline + 1);
      newline = this.pending.indexOf('\n');
    }
    // Guard against a pathological stream with no newlines at all.
    if (this.pending.length > 1_000_000) this.pending = '';
  }

  finish(): void {
    if (this.pending.trim()) this.consumeLine(this.pending.trim());
    this.pending = '';
  }

  getUsage(): TokenUsage | null {
    return this.usage;
  }

  getCompletionChars(): number {
    return this.completionChars;
  }

  private consumeLine(line: string): void {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const usage = extractUsage(parsed);
    if (usage) this.usage = usage;
    this.completionChars += measureDeltaChars(parsed);
  }
}

function measureDeltaChars(parsed: unknown): number {
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return 0;
  let chars = 0;
  for (const choice of choices) {
    const delta = (choice as { delta?: unknown; text?: unknown }).delta;
    const text = (choice as { text?: unknown }).text;
    if (typeof text === 'string') chars += text.length;
    if (delta && typeof delta === 'object') {
      const content = (delta as { content?: unknown }).content;
      if (typeof content === 'string') chars += content.length;
    }
  }
  return chars;
}
