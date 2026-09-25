import { Sparkline } from './Sparkline';
import { deltaOf, formatDelta } from '../lib/format';

/**
 * label · value · optional delta against the previous window · optional trend.
 * `upIsGood: false` flips the delta colour for measures where rising is bad.
 */
export function StatTile({
  label,
  value,
  current,
  previous,
  trend,
  footnote,
  upIsGood = true,
  hero = false,
}: {
  label: string;
  value: string;
  current?: number;
  previous?: number;
  trend?: number[];
  footnote?: string;
  upIsGood?: boolean;
  hero?: boolean;
}) {
  const delta =
    current !== undefined && previous !== undefined ? deltaOf(current, previous) : null;
  const direction = delta === null ? 'flat' : delta > 0.001 ? 'up' : delta < -0.001 ? 'down' : 'flat';
  const tone =
    direction === 'flat' ? 'flat' : (direction === 'up') === upIsGood ? 'up' : 'down';

  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${hero ? ' hero' : ''}`}>{value}</span>
      <div className="stat-foot">
        {delta !== null ? (
          <span className={`delta ${tone}`}>
            {direction === 'up' ? '▲' : direction === 'down' ? '▼' : '–'}
            {formatDelta(delta)}
          </span>
        ) : null}
        {footnote && <span className="muted">{footnote}</span>}
      </div>
      {trend && trend.length > 1 && (
        <div className="stat-spark">
          <Sparkline values={trend} />
        </div>
      )}
    </div>
  );
}
