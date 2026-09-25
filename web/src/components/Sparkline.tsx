/**
 * A 12-or-so point trend line for stat tiles: no axes, no labels — shape only.
 * The final point carries a surface ring so it stays legible over the line.
 */
export function Sparkline({
  values,
  width = 104,
  height = 28,
  tone = 'var(--accent)',
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: string;
}) {
  if (values.length < 2) return <div style={{ height }} aria-hidden="true" />;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 3;
  const plotHeight = height - pad * 2;

  const points = values.map((value, index) => ({
    x: index * stepX,
    y: pad + plotHeight - ((value - min) / span) * plotHeight,
  }));

  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = points.at(-1)!;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} fill={tone} opacity="0.1" />
      <path d={line} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r="4" fill={tone} stroke="var(--surface)" strokeWidth="2" />
    </svg>
  );
}
