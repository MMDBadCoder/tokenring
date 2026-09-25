import { MINUTE, startOfUtcDay } from '../util/time.js';
import { requestLogsRepo } from '../db/repositories/requestLogs.js';

interface Event {
  at: number;
  tokens: number;
}

/**
 * In-memory usage accounting for rate-limit decisions.
 *
 * Holds a one-minute sliding window of requests and tokens plus a rolling
 * per-UTC-day counter, for both upstream and virtual keys. The database stays
 * the durable record; this exists so the hot path never touches disk.
 */
export class UsageWindows {
  private readonly minuteEvents = new Map<string, Event[]>();
  private readonly dayRequests = new Map<string, number>();
  private readonly dayTokens = new Map<string, number>();
  private dayStart = startOfUtcDay();

  /** Replays today's request log so restarts do not hand out free capacity. */
  hydrate(at: number = Date.now()): void {
    this.dayStart = startOfUtcDay(at);
    for (const row of requestLogsRepo.since(this.dayStart)) {
      for (const id of [row.upstream_key_id, row.virtual_key_id]) {
        if (!id) continue;
        this.bumpDay(id, row.total_tokens);
        if (at - row.created_at < MINUTE) {
          this.eventsFor(id).push({ at: row.created_at, tokens: row.total_tokens });
        }
      }
    }
  }

  /** Counts a request the moment it is dispatched, before tokens are known. */
  recordRequest(id: string, at: number = Date.now()): void {
    this.rolloverIfNeeded(at);
    this.eventsFor(id).push({ at, tokens: 0 });
    this.bumpDay(id, 0);
  }

  /** Attaches token usage to the request recorded at `at`, once it completes. */
  recordTokens(id: string, tokens: number, at: number): void {
    if (tokens <= 0) return;
    this.rolloverIfNeeded();
    const events = this.eventsFor(id);
    const event = events.findLast((candidate) => candidate.at === at) ?? events.at(-1);
    if (event) event.tokens += tokens;
    this.dayTokens.set(id, (this.dayTokens.get(id) ?? 0) + tokens);
  }

  requestsInWindow(id: string, at: number = Date.now()): number {
    return this.window(id, at).length;
  }

  tokensInWindow(id: string, at: number = Date.now()): number {
    return this.window(id, at).reduce((sum, event) => sum + event.tokens, 0);
  }

  requestsToday(id: string, at: number = Date.now()): number {
    this.rolloverIfNeeded(at);
    return this.dayRequests.get(id) ?? 0;
  }

  tokensToday(id: string, at: number = Date.now()): number {
    this.rolloverIfNeeded(at);
    return this.dayTokens.get(id) ?? 0;
  }

  /** When the oldest in-window event expires — i.e. when capacity frees up. */
  nextSlotAt(id: string, at: number = Date.now()): number {
    const oldest = this.window(id, at)[0];
    return oldest ? oldest.at + MINUTE : at;
  }

  nextDayAt(at: number = Date.now()): number {
    return startOfUtcDay(at) + 24 * 60 * MINUTE;
  }

  forget(id: string): void {
    this.minuteEvents.delete(id);
    this.dayRequests.delete(id);
    this.dayTokens.delete(id);
  }

  private window(id: string, at: number): Event[] {
    const cutoff = at - MINUTE;
    const events = this.eventsFor(id);
    let firstLive = 0;
    while (firstLive < events.length && events[firstLive]!.at <= cutoff) firstLive += 1;
    if (firstLive > 0) events.splice(0, firstLive);
    return events;
  }

  private eventsFor(id: string): Event[] {
    let events = this.minuteEvents.get(id);
    if (!events) {
      events = [];
      this.minuteEvents.set(id, events);
    }
    return events;
  }

  private bumpDay(id: string, tokens: number): void {
    this.dayRequests.set(id, (this.dayRequests.get(id) ?? 0) + 1);
    if (tokens > 0) this.dayTokens.set(id, (this.dayTokens.get(id) ?? 0) + tokens);
  }

  private rolloverIfNeeded(at: number = Date.now()): void {
    const today = startOfUtcDay(at);
    if (today === this.dayStart) return;
    this.dayStart = today;
    this.dayRequests.clear();
    this.dayTokens.clear();
  }
}

export const usageWindows = new UsageWindows();
