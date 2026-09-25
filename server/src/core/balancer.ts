import type { UpstreamKeyRow } from '../db/types.js';
import type { BalancingStrategy } from '../db/repositories/settings.js';
import { usageWindows } from './usageWindows.js';

export type BlockedReason =
  | 'disabled'
  | 'cooling_down'
  | 'rpm_exhausted'
  | 'tpm_exhausted'
  | 'daily_exhausted';

export interface KeyCapacity {
  key: UpstreamKeyRow;
  requestsUsed: number;
  tokensUsed: number;
  requestsToday: number;
  /** 0 = idle, 1 = at its limit. Unlimited keys are ranked by raw throughput. */
  load: number;
  available: boolean;
  blockedBy: BlockedReason | null;
  /** Epoch ms at which this key can serve again. */
  readyAt: number;
}

export function measureCapacity(key: UpstreamKeyRow, at: number = Date.now()): KeyCapacity {
  const requestsUsed = usageWindows.requestsInWindow(key.id, at);
  const tokensUsed = usageWindows.tokensInWindow(key.id, at);
  const requestsToday = usageWindows.requestsToday(key.id, at);

  const ratios: number[] = [];
  if (key.rpm_limit > 0) ratios.push(requestsUsed / key.rpm_limit);
  if (key.tpm_limit > 0) ratios.push(tokensUsed / key.tpm_limit);
  if (key.daily_request_limit > 0) ratios.push(requestsToday / key.daily_request_limit);

  // Without declared limits, spread by throughput per unit of weight instead.
  const load = ratios.length
    ? Math.max(...ratios)
    : requestsUsed / Math.max(1, key.weight) / 100;

  let blockedBy: BlockedReason | null = null;
  let readyAt = at;

  if (!key.enabled) {
    blockedBy = 'disabled';
    readyAt = Number.POSITIVE_INFINITY;
  } else if (key.cooldown_until > at) {
    blockedBy = 'cooling_down';
    readyAt = key.cooldown_until;
  } else if (key.rpm_limit > 0 && requestsUsed >= key.rpm_limit) {
    blockedBy = 'rpm_exhausted';
    readyAt = usageWindows.nextSlotAt(key.id, at);
  } else if (key.tpm_limit > 0 && tokensUsed >= key.tpm_limit) {
    blockedBy = 'tpm_exhausted';
    readyAt = usageWindows.nextSlotAt(key.id, at);
  } else if (key.daily_request_limit > 0 && requestsToday >= key.daily_request_limit) {
    blockedBy = 'daily_exhausted';
    readyAt = usageWindows.nextDayAt(at);
  }

  return {
    key,
    requestsUsed,
    tokensUsed,
    requestsToday,
    load: Number(load.toFixed(4)),
    available: blockedBy === null,
    blockedBy,
    readyAt,
  };
}

const rotationCursors = new Map<string, number>();

function roundRobin(candidates: KeyCapacity[], cursorKey: string): KeyCapacity {
  const cursor = rotationCursors.get(cursorKey) ?? 0;
  rotationCursors.set(cursorKey, cursor + 1);
  return candidates[cursor % candidates.length]!;
}

function leastLoaded(candidates: KeyCapacity[]): KeyCapacity {
  return candidates.reduce((best, candidate) => {
    if (candidate.load !== best.load) return candidate.load < best.load ? candidate : best;
    // Equal load: prefer the key that has been idle longest.
    return candidate.key.last_used_at < best.key.last_used_at ? candidate : best;
  });
}

function weightedRandom(candidates: KeyCapacity[]): KeyCapacity {
  const total = candidates.reduce((sum, candidate) => sum + Math.max(1, candidate.key.weight), 0);
  let ticket = Math.random() * total;
  for (const candidate of candidates) {
    ticket -= Math.max(1, candidate.key.weight);
    if (ticket <= 0) return candidate;
  }
  return candidates.at(-1)!;
}

function failover(candidates: KeyCapacity[]): KeyCapacity {
  return candidates.reduce((best, candidate) => {
    if (candidate.key.weight !== best.key.weight) {
      return candidate.key.weight > best.key.weight ? candidate : best;
    }
    return candidate.key.created_at < best.key.created_at ? candidate : best;
  });
}

export type Selection =
  | { kind: 'selected'; capacity: KeyCapacity }
  | { kind: 'unavailable'; reason: BlockedReason | 'no_keys'; readyAt: number };

/**
 * Picks the upstream key that should serve the next request.
 *
 * `excluded` carries keys already tried for this request, so a retry always
 * lands on a different credential.
 */
export function selectUpstreamKey(
  keys: UpstreamKeyRow[],
  strategy: BalancingStrategy,
  options: { excluded?: Set<string>; cursorKey?: string; at?: number } = {},
): Selection {
  const at = options.at ?? Date.now();
  const excluded = options.excluded ?? new Set<string>();

  const pool = keys.filter((key) => !excluded.has(key.id));
  if (pool.length === 0) {
    return { kind: 'unavailable', reason: 'no_keys', readyAt: at };
  }

  const capacities = pool.map((key) => measureCapacity(key, at));
  const available = capacities.filter((capacity) => capacity.available);

  if (available.length === 0) {
    const soonest = capacities.reduce((best, candidate) =>
      candidate.readyAt < best.readyAt ? candidate : best,
    );
    return {
      kind: 'unavailable',
      reason: soonest.blockedBy ?? 'no_keys',
      readyAt: soonest.readyAt,
    };
  }

  // Keep ordering deterministic so round-robin and failover are reproducible.
  available.sort((a, b) => a.key.created_at - b.key.created_at);

  const cursorKey = options.cursorKey ?? 'global';
  switch (strategy) {
    case 'round_robin':
      return { kind: 'selected', capacity: roundRobin(available, cursorKey) };
    case 'weighted_random':
      return { kind: 'selected', capacity: weightedRandom(available) };
    case 'failover':
      return { kind: 'selected', capacity: failover(available) };
    case 'least_loaded':
    default:
      return { kind: 'selected', capacity: leastLoaded(available) };
  }
}
