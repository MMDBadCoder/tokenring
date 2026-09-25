import { db } from '../database.js';
import type { RequestLogRow } from '../types.js';

export interface RequestLogInput {
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
  tokenSource: 'upstream' | 'estimated' | 'none';
  latencyMs: number;
  ttfbMs: number;
  attempts: number;
  errorKind: string;
  errorMessage: string;
  clientIp: string;
}

export interface LogQuery {
  limit?: number;
  before?: number;
  virtualKeyId?: string;
  upstreamKeyId?: string;
  status?: 'success' | 'error';
  model?: string;
  search?: string;
}

export const requestLogsRepo = {
  insert(input: RequestLogInput): number {
    const result = db()
      .prepare(
        `INSERT INTO request_logs
           (created_at, virtual_key_id, upstream_key_id, provider_id, method, path, model,
            status_code, succeeded, streamed, prompt_tokens, completion_tokens, total_tokens,
            token_source, latency_ms, ttfb_ms, attempts, error_kind, error_message, client_ip)
         VALUES
           (@created_at, @virtual_key_id, @upstream_key_id, @provider_id, @method, @path, @model,
            @status_code, @succeeded, @streamed, @prompt_tokens, @completion_tokens, @total_tokens,
            @token_source, @latency_ms, @ttfb_ms, @attempts, @error_kind, @error_message, @client_ip)`,
      )
      .run({
        created_at: input.createdAt,
        virtual_key_id: input.virtualKeyId,
        upstream_key_id: input.upstreamKeyId,
        provider_id: input.providerId,
        method: input.method,
        path: input.path,
        model: input.model,
        status_code: input.statusCode,
        succeeded: input.succeeded ? 1 : 0,
        streamed: input.streamed ? 1 : 0,
        prompt_tokens: input.promptTokens,
        completion_tokens: input.completionTokens,
        total_tokens: input.totalTokens,
        token_source: input.tokenSource,
        latency_ms: input.latencyMs,
        ttfb_ms: input.ttfbMs,
        attempts: input.attempts,
        error_kind: input.errorKind.slice(0, 64),
        error_message: input.errorMessage.slice(0, 500),
        client_ip: input.clientIp,
      });
    return Number(result.lastInsertRowid);
  },

  query(options: LogQuery): RequestLogRow[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };

    if (options.before) {
      clauses.push('id < @before');
      params.before = options.before;
    }
    if (options.virtualKeyId) {
      clauses.push('virtual_key_id = @virtualKeyId');
      params.virtualKeyId = options.virtualKeyId;
    }
    if (options.upstreamKeyId) {
      clauses.push('upstream_key_id = @upstreamKeyId');
      params.upstreamKeyId = options.upstreamKeyId;
    }
    if (options.status === 'success') clauses.push('succeeded = 1');
    if (options.status === 'error') clauses.push('succeeded = 0');
    if (options.model) {
      clauses.push('model = @model');
      params.model = options.model;
    }
    if (options.search) {
      clauses.push('(path LIKE @search OR model LIKE @search OR error_message LIKE @search)');
      params.search = `%${options.search}%`;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db()
      .prepare(`SELECT * FROM request_logs ${where} ORDER BY id DESC LIMIT @limit`)
      .all(params) as RequestLogRow[];
  },

  get(id: number): RequestLogRow | undefined {
    return db().prepare('SELECT * FROM request_logs WHERE id = ?').get(id) as
      | RequestLogRow
      | undefined;
  },

  /** Recent rows used to rebuild in-memory rate windows after a restart. */
  since(timestamp: number): Pick<
    RequestLogRow,
    'created_at' | 'upstream_key_id' | 'virtual_key_id' | 'total_tokens'
  >[] {
    return db()
      .prepare(
        `SELECT created_at, upstream_key_id, virtual_key_id, total_tokens
         FROM request_logs WHERE created_at >= ? ORDER BY created_at ASC`,
      )
      .all(timestamp) as Pick<
      RequestLogRow,
      'created_at' | 'upstream_key_id' | 'virtual_key_id' | 'total_tokens'
    >[];
  },

  prune(olderThan: number): number {
    return db().prepare('DELETE FROM request_logs WHERE created_at < ?').run(olderThan).changes;
  },
};
