export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function now(): number {
  return Date.now();
}

/** Start of the current UTC day, in epoch milliseconds. */
export function startOfUtcDay(at: number = Date.now()): number {
  return Math.floor(at / DAY) * DAY;
}

export function parseWindow(input: string | undefined, fallback = HOUR * 24): number {
  if (!input) return fallback;
  const match = /^(\d+)([mhd])$/.exec(input.trim());
  if (!match) return fallback;
  const amount = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;
  const scale = unit === 'm' ? MINUTE : unit === 'h' ? HOUR : DAY;
  return amount * scale;
}
