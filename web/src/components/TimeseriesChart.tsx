import { useState } from 'react';
import { axisLabel, bucketRangeLabel, compact, full } from '../lib/format';
import { barPath, niceTicks, useMeasuredWidth } from '../lib/chart';

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

const MARGIN = { top: 12, right: 8, bottom: 26, left: 46 };
const PLOT_HEIGHT = 190;
const MAX_BAR = 24;
const GAP = 2; // surface gap between stacked segments

/**
 * Stacked columns over time, with a crosshair and a tooltip on hover.
 *
 * Series stack in the order given; only the top visible segment is rounded, so
 * the column reads as one mark with a single rounded data-end.
 */
export function TimeseriesChart({
  buckets,
  series,
  bucketMs,
  valueLabel,
  emptyMessage,
}: {
  buckets: number[];
  series: Series[];
  bucketMs: number;
  valueLabel: string;
  emptyMessage: string;
}) {
  const [container, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plotWidth = Math.max(120, width - MARGIN.left - MARGIN.right);
  const height = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;

  const totals = buckets.map((_, index) =>
    series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0),
  );
  const hasData = totals.some((value) => value > 0);
  const ticks = niceTicks(Math.max(...totals, 0));
  const scaleMax = ticks.at(-1) || 1;

  const band = buckets.length > 0 ? plotWidth / buckets.length : plotWidth;
  const barWidth = Math.max(2, Math.min(MAX_BAR, band * 0.66));
  const yOf = (value: number) => MARGIN.top + PLOT_HEIGHT - (value / scaleMax) * PLOT_HEIGHT;
  const xOf = (index: number) => MARGIN.left + band * index + band / 2;

  // Roughly one label every 90px, so ticks never collide.
  const labelStride = Math.max(1, Math.ceil(buckets.length / Math.max(2, Math.floor(plotWidth / 90))));

  return (
    <div className="chart" ref={container}>
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((item) => (
            <span key={item.key}>
              <i className="legend-swatch" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      )}

      {!hasData ? (
        <div className="empty" style={{ height: PLOT_HEIGHT }}>
          <p>{emptyMessage}</p>
        </div>
      ) : (
        <svg
          height={height}
          viewBox={`0 0 ${Math.max(width, 200)} ${height}`}
          role="img"
          aria-label={`${valueLabel} over time`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={yOf(tick)}
                y2={yOf(tick)}
                stroke={tick === 0 ? 'var(--axis)' : 'var(--gridline)'}
                strokeWidth="1"
              />
              <text
                x={MARGIN.left - 8}
                y={yOf(tick) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-muted)"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {compact(tick)}
              </text>
            </g>
          ))}

          {hover !== null && (
            <line
              x1={xOf(hover)}
              x2={xOf(hover)}
              y1={MARGIN.top}
              y2={MARGIN.top + PLOT_HEIGHT}
              stroke="var(--text-muted)"
              strokeWidth="1"
              opacity="0.5"
            />
          )}

          {buckets.map((bucket, index) => {
            let cursor = 0;
            const segments = series
              .map((item) => {
                const value = item.values[index] ?? 0;
                if (value <= 0) return null;
                const base = cursor;
                cursor += value;
                return { item, value, base, top: cursor };
              })
              .filter(Boolean) as { item: Series; value: number; base: number; top: number }[];

            const topIndex = segments.length - 1;
            return (
              <g key={bucket} opacity={hover === null || hover === index ? 1 : 0.55}>
                {segments.map((segment, order) => {
                  const y = yOf(segment.top);
                  const rawHeight = yOf(segment.base) - y;
                  const barHeight = order === topIndex ? rawHeight : Math.max(1, rawHeight - GAP);
                  return (
                    <path
                      key={segment.item.key}
                      d={barPath(
                        xOf(index) - barWidth / 2,
                        y,
                        barWidth,
                        barHeight,
                        4,
                        order === topIndex,
                      )}
                      fill={segment.item.color}
                    />
                  );
                })}
              </g>
            );
          })}

          {buckets.map((bucket, index) =>
            index % labelStride === 0 ? (
              <text
                key={`label-${bucket}`}
                x={xOf(index)}
                y={MARGIN.top + PLOT_HEIGHT + 17}
                textAnchor="middle"
                fontSize="11"
                fill="var(--text-muted)"
              >
                {axisLabel(bucket, bucketMs)}
              </text>
            ) : null,
          )}

          {/* Full-height hit bands: easier to hover than the bars themselves. */}
          {buckets.map((bucket, index) => (
            <rect
              key={`hit-${bucket}`}
              x={MARGIN.left + band * index}
              y={MARGIN.top}
              width={band}
              height={PLOT_HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          ))}
        </svg>
      )}

      {hover !== null && hasData && buckets[hover] !== undefined && (
        <div
          className="tooltip"
          style={{
            left: `${Math.min(Math.max(xOf(hover), 76), Math.max(width - 76, 76))}px`,
            top: `${MARGIN.top + (series.length > 1 ? 30 : 0)}px`,
          }}
        >
          <div className="tooltip-title">{bucketRangeLabel(buckets[hover]!, bucketMs)}</div>
          {series.map((item) => (
            <div className="tooltip-row" key={item.key}>
              <span className="label">
                <i className="legend-swatch" style={{ background: item.color }} />
                {item.label}
              </span>
              <span className="value">{full(item.values[hover] ?? 0)}</span>
            </div>
          ))}
          {series.length > 1 && (
            <div className="tooltip-row" style={{ marginTop: 4 }}>
              <span className="label">Total</span>
              <span className="value">{full(totals[hover] ?? 0)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
