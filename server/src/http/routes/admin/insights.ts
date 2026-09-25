import type { FastifyInstance } from 'fastify';
import { providersRepo } from '../../../db/repositories/providers.js';
import { upstreamKeysRepo } from '../../../db/repositories/upstreamKeys.js';
import { virtualKeysRepo } from '../../../db/repositories/virtualKeys.js';
import { requestLogsRepo } from '../../../db/repositories/requestLogs.js';
import { statsRepo } from '../../../db/repositories/stats.js';
import { measureCapacity } from '../../../core/balancer.js';
import { usageWindows } from '../../../core/usageWindows.js';
import { MINUTE, parseWindow } from '../../../util/time.js';
import { serializeRequestLog } from '../../serializers.js';
import type { BucketPoint } from '../../../db/repositories/stats.js';

/** Aims for roughly 48 points across the chosen window, on a round interval. */
function chooseBucket(windowMs: number): number {
  const target = windowMs / 48;
  const candidates = [
    MINUTE,
    5 * MINUTE,
    15 * MINUTE,
    30 * MINUTE,
    60 * MINUTE,
    3 * 60 * MINUTE,
    6 * 60 * MINUTE,
    12 * 60 * MINUTE,
    24 * 60 * MINUTE,
  ];
  return candidates.find((candidate) => candidate >= target) ?? candidates.at(-1)!;
}

/**
 * Quiet buckets produce no rows, so they are filled with zeros here. Without
 * this the chart would plot uneven gaps as if they were consecutive.
 */
function fillBuckets(points: BucketPoint[], from: number, to: number, bucketMs: number): BucketPoint[] {
  const byStart = new Map(points.map((point) => [point.bucketStart, point]));
  const filled: BucketPoint[] = [];
  const first = Math.floor(from / bucketMs) * bucketMs;
  for (let start = first; start < to; start += bucketMs) {
    filled.push(
      byStart.get(start) ?? {
        bucketStart: start,
        requests: 0,
        succeeded: 0,
        failed: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        avgLatencyMs: 0,
      },
    );
  }
  return filled;
}

export async function registerInsightRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/overview', async (request) => {
    const { window } = request.query as { window?: string };
    const windowMs = parseWindow(window);
    const to = Date.now();
    const from = to - windowMs;

    const bucketMs = chooseBucket(windowMs);
    const upstreamKeys = upstreamKeysRepo.list();
    const virtualKeys = virtualKeysRepo.list();

    const upstreamUsage = new Map(statsRepo.byUpstreamKey(from, to).map((row) => [row.id, row]));
    const virtualUsage = new Map(statsRepo.byVirtualKey(from, to).map((row) => [row.id, row]));

    const capacities = upstreamKeys.map((key) => measureCapacity(key, to));
    const pool = {
      total: upstreamKeys.length,
      active: capacities.filter((capacity) => capacity.available).length,
      cooling: capacities.filter((capacity) => capacity.blockedBy === 'cooling_down').length,
      saturated: capacities.filter(
        (capacity) =>
          capacity.blockedBy && !['cooling_down', 'disabled'].includes(capacity.blockedBy),
      ).length,
      disabled: capacities.filter((capacity) => capacity.blockedBy === 'disabled').length,
      /** Requests the pool could still serve this minute, null if unlimited. */
      headroomPerMinute: capacities.some((capacity) => capacity.key.rpm_limit > 0)
        ? capacities.reduce(
            (sum, capacity) =>
              capacity.key.enabled && capacity.key.rpm_limit > 0
                ? sum + Math.max(0, capacity.key.rpm_limit - capacity.requestsUsed)
                : sum,
            0,
          )
        : null,
    };

    const liveRequests = upstreamKeys.reduce(
      (sum, key) => sum + usageWindows.requestsInWindow(key.id, to),
      0,
    );
    const liveTokens = upstreamKeys.reduce(
      (sum, key) => sum + usageWindows.tokensInWindow(key.id, to),
      0,
    );

    return {
      window: { from, to, bucketMs, label: window ?? '24h' },
      totals: statsRepo.totals(from, to),
      previousTotals: statsRepo.totals(from - windowMs, from),
      timeseries: fillBuckets(statsRepo.timeseries(from, to, bucketMs), from, to, bucketMs),
      models: statsRepo.byModel(from, to).slice(0, 8),
      errors: statsRepo.errorBreakdown(from, to).slice(0, 8),
      live: { requestsPerMinute: liveRequests, tokensPerMinute: liveTokens },
      pool,
      upstreamKeys: upstreamKeys.map((key) => {
        const capacity = measureCapacity(key, to);
        return {
          id: key.id,
          label: key.label,
          owner: key.owner,
          enabled: key.enabled === 1,
          rpmLimit: key.rpm_limit,
          requestsUsed: capacity.requestsUsed,
          load: capacity.load,
          blockedBy: capacity.blockedBy,
          usage: upstreamUsage.get(key.id) ?? null,
        };
      }),
      virtualKeys: virtualKeys.map((key) => ({
        id: key.id,
        name: key.name,
        owner: key.owner,
        enabled: key.enabled === 1,
        usage: virtualUsage.get(key.id) ?? null,
      })),
      providers: providersRepo.list().map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.base_url,
        isDefault: provider.is_default === 1,
      })),
    };
  });

  app.get('/api/logs', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const rows = requestLogsRepo.query({
      limit: query.limit ? Number(query.limit) : 60,
      before: query.before ? Number(query.before) : undefined,
      virtualKeyId: query.virtualKeyId,
      upstreamKeyId: query.upstreamKeyId,
      status: query.status === 'success' || query.status === 'error' ? query.status : undefined,
      model: query.model,
      search: query.search,
    });
    return {
      logs: rows.map(serializeRequestLog),
      nextCursor: rows.length ? rows.at(-1)!.id : null,
      models: statsRepo.distinctModels(),
    };
  });
}
