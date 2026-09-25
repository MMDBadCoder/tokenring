/** 1,284 · 12.9K · 4.2M — compact enough for a stat tile, exact when small. */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1_000) return String(Math.round(value));
  if (abs < 1_000_000) return `${trim(value / 1_000)}K`;
  if (abs < 1_000_000_000) return `${trim(value / 1_000_000)}M`;
  return `${trim(value / 1_000_000_000)}B`;
}

function trim(value: number): string {
  return value.toFixed(Math.abs(value) < 10 ? 1 : 0).replace(/\.0$/, '');
}

export function full(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : '—';
}

export function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function duration(ms: number): string {
  if (!ms) return '—';
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

export function relativeTime(timestamp: number): string {
  if (!timestamp) return 'never';
  const delta = Date.now() - timestamp;
  if (delta < 0) return `in ${duration(-delta)}`;
  if (delta < 45_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.round(delta / 86_400_000)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Axis labels: a bare time inside a day, a date once the window is longer. */
export function axisLabel(timestamp: number, bucketMs: number): string {
  const date = new Date(timestamp);
  if (bucketMs >= 86_400_000) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function bucketRangeLabel(timestamp: number, bucketMs: number): string {
  const start = new Date(timestamp);
  const end = new Date(timestamp + bucketMs);
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (bucketMs >= 86_400_000) {
    return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return `${start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${time(start)}–${time(end)}`;
}

/**
 * Change against the previous period. Returns null when there is no honest
 * comparison to make — no previous data, or a base so small that the
 * percentage would be theatre rather than information.
 */
export function deltaOf(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/** Percentages past 10x read better as a multiplier. */
export function formatDelta(delta: number): string {
  const magnitude = Math.abs(delta);
  if (magnitude >= 10) return `${(magnitude + 1).toFixed(0)}x`;
  return percent(magnitude, magnitude < 0.1 ? 1 : 0);
}

/** Turns "rate_limited" into "Rate limited" for badges and tables. */
export function humanise(value: string): string {
  if (!value) return '';
  const spaced = value.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatLimit(value: number, unit: string): string {
  return value > 0 ? `${full(value)} ${unit}` : 'unlimited';
}
