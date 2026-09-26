import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useResource } from '../lib/useResource';
import { clockTime, duration, full, humanise, relativeTime } from '../lib/format';
import type { RequestLog, UpstreamKey, VirtualKey } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { Badge, Dialog, EmptyState, Segmented } from '../components/Primitives';
import { IconRefresh } from '../components/Icons';

type StatusFilter = 'all' | 'success' | 'error';

function statusBadge(log: RequestLog) {
  if (log.succeeded) return <Badge tone="good">{log.statusCode}</Badge>;
  if (log.statusCode === 429) return <Badge tone="warning">429</Badge>;
  return <Badge tone="critical">{log.statusCode || 'error'}</Badge>;
}

// One page's worth of rows in the DOM at a time -- this is a live activity
// feed, and letting "load more" accumulate forever (the previous design) is
// exactly how the page ends up rendering thousands of rows and turns heavy.
const PAGE_SIZE = 60;

export function Activity() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(
    (params.get('status') as StatusFilter) || 'all',
  );
  const [model, setModel] = useState(params.get('model') ?? '');
  const [virtualKeyId, setVirtualKeyId] = useState(params.get('virtualKeyId') ?? '');
  const [upstreamKeyId, setUpstreamKeyId] = useState(params.get('upstreamKeyId') ?? '');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<RequestLog | null>(null);

  // pageIndex 0 is the live page (no cursor -- always the newest rows).
  // cursorStack[i] is the "before" cursor that fetches page i, so "Newer"
  // can go back to an already-known page without re-fetching from the start.
  const [pageIndex, setPageIndex] = useState(0);
  const [cursorStack, setCursorStack] = useState<Array<number | undefined>>([undefined]);

  // Keep the URL in step so a filtered view can be shared or reloaded.
  useEffect(() => {
    const next = new URLSearchParams();
    if (status !== 'all') next.set('status', status);
    if (model) next.set('model', model);
    if (virtualKeyId) next.set('virtualKeyId', virtualKeyId);
    if (upstreamKeyId) next.set('upstreamKeyId', upstreamKeyId);
    setParams(next, { replace: true });
    // A changed filter invalidates every cursor computed under the old one.
    setPageIndex(0);
    setCursorStack([undefined]);
  }, [status, model, virtualKeyId, upstreamKeyId, setParams]);

  const logs = useResource(
    () =>
      api.logs({
        limit: PAGE_SIZE,
        before: cursorStack[pageIndex],
        status: status === 'all' ? undefined : status,
        model: model || undefined,
        virtualKeyId: virtualKeyId || undefined,
        upstreamKeyId: upstreamKeyId || undefined,
        search: search || undefined,
      }),
    [pageIndex, cursorStack, status, model, virtualKeyId, upstreamKeyId, search],
    // Polling only makes sense on the live page -- refreshing a historical
    // page on a timer would just replace what the operator is looking at
    // with... the same historical page, for no benefit and a wasted request.
    { pollMs: pageIndex === 0 ? 10_000 : undefined },
  );

  const virtualKeys = useResource(() => api.virtualKeys('30d'), []);
  const upstreamKeys = useResource(() => api.upstreamKeys('30d'), []);

  const virtualById = useMemo(
    () => new Map((virtualKeys.data?.keys ?? []).map((key: VirtualKey) => [key.id, key])),
    [virtualKeys.data],
  );
  const upstreamById = useMemo(
    () => new Map((upstreamKeys.data?.keys ?? []).map((key: UpstreamKey) => [key.id, key])),
    [upstreamKeys.data],
  );

  const rows = logs.data?.logs ?? [];
  const hasOlder = rows.length >= PAGE_SIZE && logs.data?.nextCursor != null;
  const hasNewer = pageIndex > 0;

  function goOlder() {
    const cursor = logs.data?.nextCursor;
    if (cursor == null) return;
    setCursorStack((stack) => {
      const withThis = stack.slice(0, pageIndex + 1);
      withThis[pageIndex + 1] = cursor;
      return withThis;
    });
    setPageIndex((index) => index + 1);
  }
  function goNewer() {
    setPageIndex((index) => Math.max(0, index - 1));
  }

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Every proxied request, with the key that served it and what it cost."
        actions={
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => void logs.reload()}
            aria-label="Refresh"
          >
            <IconRefresh />
          </button>
        }
      />

      <div className="page">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <Segmented<StatusFilter>
            ariaLabel="Outcome"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All' },
              { value: 'success', label: 'Succeeded' },
              { value: 'error', label: 'Failed' },
            ]}
          />

          <select
            className="select"
            style={{ width: 'auto', minWidth: 150 }}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            aria-label="Model"
          >
            <option value="">All models</option>
            {(logs.data?.models ?? []).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 170 }}
            value={virtualKeyId}
            onChange={(event) => setVirtualKeyId(event.target.value)}
            aria-label="TokenRing key"
          >
            <option value="">All TokenRing keys</option>
            {(virtualKeys.data?.keys ?? []).map((key) => (
              <option key={key.id} value={key.id}>
                {key.name}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 170 }}
            value={upstreamKeyId}
            onChange={(event) => setUpstreamKeyId(event.target.value)}
            aria-label="Upstream key"
          >
            <option value="">All upstream keys</option>
            {(upstreamKeys.data?.keys ?? []).map((key) => (
              <option key={key.id} value={key.id}>
                {key.label}
              </option>
            ))}
          </select>

          <input
            className="input"
            style={{ width: 'auto', minWidth: 180, flex: 1, maxWidth: 280 }}
            placeholder="Search path or error…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search"
          />
        </div>

        <div className="card">
          {rows.length === 0 ? (
            <EmptyState
              title="Nothing here yet"
              message={
                logs.initial
                  ? 'Loading recent requests…'
                  : 'No requests match these filters. Once an agent starts calling the proxy, every request lands here.'
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>TokenRing key</th>
                    <th>Model</th>
                    <th>Served by</th>
                    <th>Status</th>
                    <th className="num">Tokens</th>
                    <th className="num">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((log) => (
                    <tr key={log.id} className="clickable" onClick={() => setSelected(log)}>
                      <td className="muted tnum" title={new Date(log.createdAt).toLocaleString()}>
                        {clockTime(log.createdAt)}
                      </td>
                      <td>
                        {virtualById.get(log.virtualKeyId ?? '')?.name ?? (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="mono">{log.model || <span className="muted">—</span>}</td>
                      <td>
                        {upstreamById.get(log.upstreamKeyId ?? '')?.label ?? (
                          <span className="muted">—</span>
                        )}
                        {log.attempts > 1 && (
                          <span className="row-sub"> after {log.attempts} tries</span>
                        )}
                      </td>
                      <td>
                        {statusBadge(log)}
                        {log.streamed && (
                          <span className="row-sub" style={{ marginLeft: 6 }}>
                            stream
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {log.totalTokens ? full(log.totalTokens) : <span className="muted">—</span>}
                        {log.tokenSource === 'estimated' && (
                          <span className="muted" title="Estimated — the upstream reported no usage">
                            {' '}
                            ≈
                          </span>
                        )}
                      </td>
                      <td className="num">{duration(log.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(hasNewer || hasOlder) && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 14,
                borderTop: '1px solid var(--border)',
              }}
            >
              <button type="button" className="btn btn-sm" disabled={!hasNewer} onClick={goNewer}>
                ← Newer
              </button>
              <span className="muted" style={{ fontSize: 13 }}>
                {pageIndex === 0 ? 'Latest' : `Page ${pageIndex + 1}`}
              </span>
              <button type="button" className="btn btn-sm" disabled={!hasOlder || logs.loading} onClick={goOlder}>
                {logs.loading && pageIndex > 0 ? 'Loading…' : 'Older →'}
              </button>
            </div>
          )}
        </div>
      </div>

      {selected && (
        <Dialog
          wide
          title="Request detail"
          description={new Date(selected.createdAt).toLocaleString()}
          onClose={() => setSelected(null)}
          footer={
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              Close
            </button>
          }
        >
          <dl className="detail-grid">
            <dt>Endpoint</dt>
            <dd className="mono">
              {selected.method} {selected.path}
            </dd>

            <dt>Outcome</dt>
            <dd>
              {statusBadge(selected)}
              {selected.errorKind && ` · ${humanise(selected.errorKind)}`}
            </dd>

            {selected.errorMessage && (
              <>
                <dt>Message</dt>
                <dd style={{ color: 'var(--critical)' }}>{selected.errorMessage}</dd>
              </>
            )}

            <dt>Model</dt>
            <dd className="mono">{selected.model || '—'}</dd>

            <dt>TokenRing key</dt>
            <dd>{virtualById.get(selected.virtualKeyId ?? '')?.name ?? '—'}</dd>

            <dt>Upstream key</dt>
            <dd>
              {upstreamById.get(selected.upstreamKeyId ?? '')?.label ?? '—'}
              {selected.attempts > 1 && ` (attempt ${selected.attempts})`}
            </dd>

            <dt>Tokens</dt>
            <dd className="tnum">
              {full(selected.promptTokens)} in · {full(selected.completionTokens)} out ·{' '}
              {full(selected.totalTokens)} total
              {selected.tokenSource === 'estimated' && (
                <span className="muted"> (estimated)</span>
              )}
            </dd>

            <dt>Latency</dt>
            <dd className="tnum">
              {duration(selected.latencyMs)} total
              {selected.ttfbMs > 0 && ` · ${duration(selected.ttfbMs)} to first byte`}
            </dd>

            <dt>Streamed</dt>
            <dd>{selected.streamed ? 'Yes' : 'No'}</dd>

            <dt>Client</dt>
            <dd className="mono">{selected.clientIp || '—'}</dd>

            <dt>Received</dt>
            <dd>{relativeTime(selected.createdAt)}</dd>
          </dl>
        </Dialog>
      )}
    </>
  );
}
