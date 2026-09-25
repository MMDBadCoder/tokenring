import { db } from '../database.js';

export interface UsageTotals {
  requests: number;
  succeeded: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
}

export interface BucketPoint extends UsageTotals {
  bucketStart: number;
}

export interface GroupedUsage extends UsageTotals {
  id: string;
}

const TOTALS_COLUMNS = `
  COUNT(*)                                AS requests,
  COALESCE(SUM(succeeded), 0)             AS succeeded,
  COUNT(*) - COALESCE(SUM(succeeded), 0)  AS failed,
  COALESCE(SUM(prompt_tokens), 0)         AS promptTokens,
  COALESCE(SUM(completion_tokens), 0)     AS completionTokens,
  COALESCE(SUM(total_tokens), 0)          AS totalTokens,
  COALESCE(CAST(AVG(NULLIF(latency_ms, 0)) AS INTEGER), 0) AS avgLatencyMs
`;

const EMPTY: UsageTotals = {
  requests: 0,
  succeeded: 0,
  failed: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  avgLatencyMs: 0,
};

export const statsRepo = {
  totals(from: number, to: number): UsageTotals {
    const row = db()
      .prepare(
        `SELECT ${TOTALS_COLUMNS} FROM request_logs WHERE created_at >= ? AND created_at < ?`,
      )
      .get(from, to) as UsageTotals | undefined;
    return row ?? { ...EMPTY };
  },

  timeseries(from: number, to: number, bucketMs: number): BucketPoint[] {
    return db()
      .prepare(
        `SELECT CAST(created_at / @bucket AS INTEGER) * @bucket AS bucketStart, ${TOTALS_COLUMNS}
         FROM request_logs
         WHERE created_at >= @from AND created_at < @to
         GROUP BY bucketStart
         ORDER BY bucketStart ASC`,
      )
      .all({ from, to, bucket: bucketMs }) as BucketPoint[];
  },

  byVirtualKey(from: number, to: number): GroupedUsage[] {
    return db()
      .prepare(
        `SELECT COALESCE(virtual_key_id, '') AS id, ${TOTALS_COLUMNS}
         FROM request_logs
         WHERE created_at >= ? AND created_at < ?
         GROUP BY virtual_key_id`,
      )
      .all(from, to) as GroupedUsage[];
  },

  byUpstreamKey(from: number, to: number): GroupedUsage[] {
    return db()
      .prepare(
        `SELECT COALESCE(upstream_key_id, '') AS id, ${TOTALS_COLUMNS}
         FROM request_logs
         WHERE created_at >= ? AND created_at < ?
         GROUP BY upstream_key_id`,
      )
      .all(from, to) as GroupedUsage[];
  },

  byModel(from: number, to: number): GroupedUsage[] {
    return db()
      .prepare(
        `SELECT COALESCE(NULLIF(model, ''), 'unknown') AS id, ${TOTALS_COLUMNS}
         FROM request_logs
         WHERE created_at >= ? AND created_at < ?
         GROUP BY COALESCE(NULLIF(model, ''), 'unknown')
         ORDER BY totalTokens DESC`,
      )
      .all(from, to) as GroupedUsage[];
  },

  /** Failure counts grouped by error kind, for the overview's health panel. */
  errorBreakdown(from: number, to: number): { kind: string; count: number }[] {
    return db()
      .prepare(
        `SELECT COALESCE(NULLIF(error_kind, ''), 'unknown') AS kind, COUNT(*) AS count
         FROM request_logs
         WHERE created_at >= ? AND created_at < ? AND succeeded = 0
         GROUP BY kind
         ORDER BY count DESC`,
      )
      .all(from, to) as { kind: string; count: number }[];
  },

  distinctModels(): string[] {
    return (
      db()
        .prepare(
          `SELECT DISTINCT model FROM request_logs WHERE model <> '' ORDER BY model ASC LIMIT 100`,
        )
        .all() as { model: string }[]
    ).map((row) => row.model);
  },
};
