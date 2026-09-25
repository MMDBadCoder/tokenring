import { full } from '../lib/format';

export interface BarRow {
  id: string;
  label: string;
  sublabel?: string;
  value: number;
  /** Optional secondary figure shown after the value, e.g. "· 18.2K tokens". */
  detail?: string;
  muted?: boolean;
}

/**
 * Magnitude across a handful of named things — one measure, so one hue.
 * Values are labelled at the bar tip rather than on a second axis.
 */
export function BarList({
  rows,
  valueLabel,
  emptyMessage,
}: {
  rows: BarRow[];
  valueLabel: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="empty" style={{ padding: '28px 16px' }}>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {rows.map((row) => (
        <div key={row.id}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              marginBottom: 5,
              fontSize: 13,
            }}
          >
            <span className="truncate" style={{ fontWeight: 560 }}>
              {row.label}
            </span>
            {row.sublabel && (
              <span className="muted truncate" style={{ fontSize: 12 }}>
                {row.sublabel}
              </span>
            )}
            <span
              className="tnum"
              style={{ marginLeft: 'auto', fontWeight: 580, whiteSpace: 'nowrap' }}
            >
              {full(row.value)}
              <span className="muted" style={{ fontWeight: 400 }}>
                {' '}
                {valueLabel}
              </span>
            </span>
          </div>
          <div
            style={{
              height: 8,
              borderRadius: 999,
              background: 'var(--surface-sunken)',
              overflow: 'hidden',
            }}
            role="img"
            aria-label={`${row.label}: ${full(row.value)} ${valueLabel}`}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.max(2, (row.value / max) * 100)}%`,
                borderRadius: '0 4px 4px 0',
                background: row.muted ? 'var(--text-muted)' : 'var(--accent)',
                opacity: row.muted ? 0.45 : 1,
                transition: 'width 300ms ease',
              }}
            />
          </div>
          {row.detail && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              {row.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
