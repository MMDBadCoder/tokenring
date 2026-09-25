import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useResource } from '../lib/useResource';
import { WINDOW_OPTIONS, useWindowRange, type WindowValue } from '../lib/useWindow';
import { compact, duration, full, humanise, percent } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { StatTile } from '../components/StatTile';
import { TimeseriesChart } from '../components/TimeseriesChart';
import { BarList } from '../components/BarList';
import { Badge, CopyField, EmptyState, Meter, Segmented } from '../components/Primitives';
import { IconRefresh } from '../components/Icons';

/** Saturation is expected under load; connection failures are not. */
const FAILURE_TONE: Record<string, 'warning' | 'critical'> = {
  rate_limited: 'warning',
  pool_exhausted: 'warning',
  key_rpm_exceeded: 'warning',
  key_daily_requests_exceeded: 'warning',
  key_daily_tokens_exceeded: 'warning',
};

export function Overview({ baseUrl }: { baseUrl: string }) {
  const [range, setRange] = useWindowRange();
  const { data, error, initial, reload } = useResource(() => api.overview(range), [range], {
    pollMs: 15_000,
  });

  const header = (
    <PageHeader
      title="Overview"
      subtitle="Traffic, token spend, and the health of every key in the pool."
      actions={
        <>
          <Segmented<WindowValue>
            ariaLabel="Time range"
            value={range}
            onChange={setRange}
            options={WINDOW_OPTIONS.map((option) => ({ ...option }))}
          />
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => void reload()} aria-label="Refresh">
            <IconRefresh />
          </button>
        </>
      }
    />
  );

  if (initial && !data) {
    return (
      <>
        {header}
        <div className="page">
          <div className="card">
            <EmptyState title="Loading" message="Fetching the latest numbers…" />
          </div>
        </div>
      </>
    );
  }

  if (error && !data) {
    return (
      <>
        {header}
        <div className="page">
          <div className="card">
            <EmptyState title="Could not load the overview" message={error} />
          </div>
        </div>
      </>
    );
  }

  if (!data) return header;

  const { totals, previousTotals, timeseries, pool, live } = data;
  const buckets = timeseries.map((point) => point.bucketStart);
  const successRate = totals.requests ? totals.succeeded / totals.requests : 1;
  const previousSuccessRate = previousTotals.requests
    ? previousTotals.succeeded / previousTotals.requests
    : 1;
  const trend = timeseries.slice(-12).map((point) => point.requests);

  // A handful of requests in the previous period cannot support a percentage —
  // comparing against it produces numbers like "+1780x" that mean nothing.
  const comparable = previousTotals.requests >= 20;
  const versus = comparable ? 'vs previous period' : undefined;

  const keyRows = [...data.upstreamKeys]
    .sort((a, b) => (b.usage?.requests ?? 0) - (a.usage?.requests ?? 0))
    .map((key) => ({
      id: key.id,
      label: key.label,
      sublabel: key.owner || undefined,
      value: key.usage?.requests ?? 0,
      detail: `${compact(key.usage?.totalTokens ?? 0)} tokens · ${
        key.rpmLimit > 0 ? `${key.requestsUsed}/${key.rpmLimit} this minute` : 'no rate limit set'
      }`,
      muted: !key.enabled,
    }));

  const virtualRows = [...data.virtualKeys]
    .sort((a, b) => (b.usage?.totalTokens ?? 0) - (a.usage?.totalTokens ?? 0))
    .map((key) => ({
      id: key.id,
      label: key.name,
      sublabel: key.owner || undefined,
      value: key.usage?.totalTokens ?? 0,
      detail: `${full(key.usage?.requests ?? 0)} requests`,
      muted: !key.enabled,
    }));

  return (
    <>
      {header}
      <div className="page">
        {pool.total === 0 && (
          <div className="card card-pad" style={{ marginBottom: 20 }}>
            <div className="section-head">
              <h2>Finish setting up TokenRing</h2>
            </div>
            <p className="secondary" style={{ marginBottom: 14, fontSize: 13.5 }}>
              The pool has no upstream keys yet, so requests cannot be forwarded. Add the real
              provider keys your team owns, then issue a TokenRing key to each agent.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Link className="btn btn-primary" to="/upstream-keys">
                Add an upstream key
              </Link>
              <Link className="btn" to="/keys">
                Issue a TokenRing key
              </Link>
            </div>
          </div>
        )}

        <div className="grid grid-stats">
          <StatTile
            label="Requests"
            value={compact(totals.requests)}
            current={comparable ? totals.requests : undefined}
            previous={comparable ? previousTotals.requests : undefined}
            trend={trend}
            footnote={versus}
            hero
          />
          <StatTile
            label="Tokens"
            value={compact(totals.totalTokens)}
            current={comparable ? totals.totalTokens : undefined}
            previous={comparable ? previousTotals.totalTokens : undefined}
            footnote={`${compact(totals.promptTokens)} in · ${compact(totals.completionTokens)} out`}
          />
          <StatTile
            label="Success rate"
            value={percent(successRate, 1)}
            current={comparable ? successRate : undefined}
            previous={comparable ? previousSuccessRate : undefined}
            footnote={`${full(totals.failed)} failed`}
          />
          <StatTile
            label="Average latency"
            value={duration(totals.avgLatencyMs)}
            current={comparable ? totals.avgLatencyMs : undefined}
            previous={comparable ? previousTotals.avgLatencyMs : undefined}
            upIsGood={false}
            footnote="end to end"
          />
          <StatTile
            label="Live throughput"
            value={`${full(live.requestsPerMinute)}/min`}
            footnote={
              pool.headroomPerMinute === null
                ? `${compact(live.tokensPerMinute)} tokens this minute`
                : `${full(pool.headroomPerMinute)} requests of headroom left`
            }
          />
        </div>

        <div className="grid grid-charts page-section">
          <div className="card">
            <div className="card-head">
              <h3>Requests over time</h3>
              <span className="spacer" />
              <span className="muted" style={{ fontSize: 12 }}>
                {full(totals.requests)} total
              </span>
            </div>
            <div className="card-pad">
              <TimeseriesChart
                buckets={buckets}
                bucketMs={data.window.bucketMs}
                valueLabel="Requests"
                emptyMessage="No requests in this window yet."
                series={[
                  {
                    key: 'succeeded',
                    label: 'Succeeded',
                    color: 'var(--series-1)',
                    values: timeseries.map((point) => point.succeeded),
                  },
                  {
                    key: 'failed',
                    label: 'Failed',
                    color: 'var(--critical)',
                    values: timeseries.map((point) => point.failed),
                  },
                ]}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Tokens over time</h3>
              <span className="spacer" />
              <span className="muted" style={{ fontSize: 12 }}>
                {full(totals.totalTokens)} total
              </span>
            </div>
            <div className="card-pad">
              <TimeseriesChart
                buckets={buckets}
                bucketMs={data.window.bucketMs}
                valueLabel="Tokens"
                emptyMessage="No token usage recorded in this window."
                series={[
                  {
                    key: 'tokens',
                    label: 'Tokens',
                    color: 'var(--series-1)',
                    values: timeseries.map((point) => point.totalTokens),
                  },
                ]}
              />
            </div>
          </div>
        </div>

        <div className="page-section">
          <div className="section-head">
            <h2>Pool health</h2>
            <span className="hint">
              {pool.active} of {pool.total} keys ready
              {pool.cooling > 0 && ` · ${pool.cooling} cooling down`}
              {pool.saturated > 0 && ` · ${pool.saturated} at their limit`}
              {pool.disabled > 0 && ` · ${pool.disabled} disabled`}
            </span>
            <span className="spacer" />
            <Link className="btn btn-sm" to="/upstream-keys">
              Manage keys
            </Link>
          </div>

          <div className="card card-pad">
            {data.upstreamKeys.length === 0 ? (
              <EmptyState
                title="No upstream keys yet"
                message="Add the provider keys your team already owns — TokenRing rotates between them automatically."
                action={
                  <Link className="btn btn-primary" to="/upstream-keys">
                    Add an upstream key
                  </Link>
                }
              />
            ) : (
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                {data.upstreamKeys.map((key) => (
                  <div key={key.id}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 8,
                      }}
                    >
                      <span className="truncate" style={{ fontWeight: 580 }}>
                        {key.label}
                      </span>
                      {!key.enabled ? (
                        <Badge tone="neutral">Disabled</Badge>
                      ) : key.blockedBy ? (
                        <Badge tone={key.blockedBy === 'cooling_down' ? 'serious' : 'warning'}>
                          {humanise(key.blockedBy)}
                        </Badge>
                      ) : (
                        <Badge tone="good">Ready</Badge>
                      )}
                    </div>
                    <Meter
                      value={key.load}
                      label={key.owner || 'Unassigned'}
                      detail={
                        key.rpmLimit > 0
                          ? `${key.requestsUsed}/${key.rpmLimit} rpm`
                          : `${key.requestsUsed} rpm`
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-halves page-section">
          <div className="card">
            <div className="card-head">
              <h3>Requests by upstream key</h3>
            </div>
            <div className="card-pad">
              <BarList
                rows={keyRows}
                valueLabel="requests"
                emptyMessage="No traffic attributed to an upstream key yet."
              />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Token spend by TokenRing key</h3>
              <span className="spacer" />
              <Link className="btn btn-sm btn-ghost" to="/keys">
                Manage
              </Link>
            </div>
            <div className="card-pad">
              <BarList
                rows={virtualRows}
                valueLabel="tokens"
                emptyMessage="No TokenRing keys have been used in this window."
              />
            </div>
          </div>
        </div>

        <div className="grid grid-halves page-section">
          <div className="card">
            <div className="card-head">
              <h3>Models</h3>
            </div>
            <div className="table-wrap">
              {data.models.length === 0 ? (
                <div className="empty" style={{ padding: '28px 16px' }}>
                  <p>No model usage recorded yet.</p>
                </div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th className="num">Requests</th>
                      <th className="num">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((model) => (
                      <tr key={model.id}>
                        <td className="mono">{model.id}</td>
                        <td className="num">{full(model.requests)}</td>
                        <td className="num">{full(model.totalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Failures</h3>
              <span className="spacer" />
              <Link className="btn btn-sm btn-ghost" to="/activity?status=error">
                Inspect
              </Link>
            </div>
            <div className="table-wrap">
              {data.errors.length === 0 ? (
                <div className="empty" style={{ padding: '28px 16px' }}>
                  <p>No failures in this window. </p>
                </div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Reason</th>
                      <th className="num">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.errors.map((entry) => (
                      <tr key={entry.kind}>
                        <td>
                          <Badge tone={FAILURE_TONE[entry.kind] ?? 'critical'}>
                            {humanise(entry.kind)}
                          </Badge>
                        </td>
                        <td className="num">{full(entry.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="page-section">
          <div className="section-head">
            <h2>Point your agent here</h2>
            <span className="hint">Any OpenAI-compatible client works unchanged.</span>
          </div>
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <CopyField value={`${baseUrl}/v1`} label="base URL" />
            <p className="muted" style={{ fontSize: 12.5 }}>
              Use a TokenRing key as the API key. Requests are forwarded to{' '}
              <span className="mono">
                {data.providers.find((provider) => provider.isDefault)?.baseUrl ?? 'your provider'}
              </span>{' '}
              using whichever pooled key has capacity.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
