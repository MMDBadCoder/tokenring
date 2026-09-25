import { useEffect, useRef, useState } from 'react';

/** Tracks an element's width so SVG charts render at true pixel size. */
export function useMeasuredWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

/** Axis ticks on round numbers — 0 / 500 / 1,000 rather than 0 / 437 / 874. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rawStep = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

/**
 * A bar with its data-end rounded and its baseline square.
 * `radius` is clamped so short bars don't turn into lozenges.
 */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  roundTop: boolean,
): string {
  if (height <= 0) return '';
  const r = roundTop ? Math.min(radius, width / 2, height) : 0;
  return [
    `M${x} ${y + height}`,
    `V${y + r}`,
    r ? `Q${x} ${y} ${x + r} ${y}` : '',
    `H${x + width - r}`,
    r ? `Q${x + width} ${y} ${x + width} ${y + r}` : '',
    `V${y + height}`,
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}
