import { useState } from 'react';
import { api } from '../lib/api';
import { useResource } from '../lib/useResource';
import { WINDOW_OPTIONS, useWindowRange, type WindowValue } from '../lib/useWindow';
import { compact, duration, formatLimit, full, humanise, relativeTime } from '../lib/format';
import type { Provider, UpstreamKey } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toaster';
import {
  Badge,
  Dialog,
  EmptyState,
  Field,
  Meter,
  Segmented,
  Switch,
} from '../components/Primitives';
import { IconBolt, IconEdit, IconPlus, IconRefresh, IconTrash } from '../components/Icons';

interface Draft {
  id?: string;
  providerId: string;
  label: string;
  owner: string;
  secret: string;
  rpmLimit: string;
  tpmLimit: string;
  dailyRequestLimit: string;
  weight: string;
  enabled: boolean;
  notes: string;
}

const emptyDraft = (providerId: string): Draft => ({
  providerId,
  label: '',
  owner: '',
  secret: '',
  rpmLimit: '',
  tpmLimit: '',
  dailyRequestLimit: '',
  weight: '1',
  enabled: true,
  notes: '',
});

const toDraft = (key: UpstreamKey): Draft => ({
  id: key.id,
  providerId: key.providerId,
  label: key.label,
  owner: key.owner,
  secret: '',
  rpmLimit: key.rpmLimit ? String(key.rpmLimit) : '',
  tpmLimit: key.tpmLimit ? String(key.tpmLimit) : '',
  dailyRequestLimit: key.dailyRequestLimit ? String(key.dailyRequestLimit) : '',
  weight: String(key.weight),
  enabled: key.enabled,
  notes: key.notes,
});

const numberOrZero = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

function statusBadge(key: UpstreamKey) {
  if (!key.enabled) {
    return <Badge tone="neutral">{key.cooldownReason === 'auth_failed' ? 'Rejected' : 'Disabled'}</Badge>;
  }
  if (key.live.status === 'cooling') return <Badge tone="serious">Cooling down</Badge>;
  if (key.live.status === 'saturated') return <Badge tone="warning">{humanise(key.live.blockedBy ?? 'At limit')}</Badge>;
  return <Badge tone="good">Ready</Badge>;
}

export function UpstreamKeys({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [range, setRange] = useWindowRange();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UpstreamKey | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const keys = useResource(() => api.upstreamKeys(range), [range], { pollMs: 15_000 });
  const providers = useResource(() => api.providers(), []);
  const providerList: Provider[] = providers.data?.providers ?? [];
  const defaultProviderId = providerList.find((provider) => provider.isDefault)?.id ?? providerList[0]?.id ?? '';

  async function save() {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      providerId: draft.providerId || defaultProviderId,
      label: draft.label.trim(),
      owner: draft.owner.trim(),
      rpmLimit: numberOrZero(draft.rpmLimit),
      tpmLimit: numberOrZero(draft.tpmLimit),
      dailyRequestLimit: numberOrZero(draft.dailyRequestLimit),
      weight: Math.max(1, numberOrZero(draft.weight) || 1),
      enabled: draft.enabled,
      notes: draft.notes.trim(),
      ...(draft.secret.trim() ? { secret: draft.secret.trim() } : {}),
    };

    try {
      if (draft.id) {
        await api.updateUpstreamKey(draft.id, payload);
        toast.success(`Updated ${payload.label}.`);
      } else {
        await api.createUpstreamKey(payload);
        toast.success(`Added ${payload.label} to the pool.`);
      }
      setDraft(null);
      await keys.reload();
      onChanged();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Could not save the key.');
    } finally {
      setSaving(false);
    }
  }

  async function test(key: UpstreamKey) {
    setTesting(key.id);
    try {
      const result = await api.testUpstreamKey(key.id);
      if (result.ok) toast.success(`${key.label}: ${result.message} (${duration(result.latencyMs)})`);
      else toast.error(`${key.label}: ${result.message}`);
      await keys.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The test could not run.');
    } finally {
      setTesting(null);
    }
  }

  async function remove(key: UpstreamKey) {
    try {
      await api.deleteUpstreamKey(key.id);
      toast.success(`Removed ${key.label}.`);
      setConfirmDelete(null);
      await keys.reload();
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not remove the key.');
    }
  }

  async function toggle(key: UpstreamKey) {
    try {
      await api.updateUpstreamKey(key.id, { enabled: !key.enabled });
      await keys.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not update the key.');
    }
  }

  async function clearCooldown(key: UpstreamKey) {
    try {
      await api.resetUpstreamKey(key.id);
      toast.success(`${key.label} is back in rotation.`);
      await keys.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not clear the cooldown.');
    }
  }

  const rows = keys.data?.keys ?? [];

  return (
    <>
      <PageHeader
        title="Upstream keys"
        subtitle="The real provider keys your team pools together. Secrets are encrypted at rest and never shown again."
        actions={
          <>
            <Segmented<WindowValue>
              ariaLabel="Time range"
              value={range}
              onChange={setRange}
              options={WINDOW_OPTIONS.map((option) => ({ ...option }))}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setFormError(null);
                setDraft(emptyDraft(defaultProviderId));
              }}
              disabled={providerList.length === 0}
            >
              <IconPlus />
              Add key
            </button>
          </>
        }
      />

      <div className="page">
        <div className="card">
          {rows.length === 0 ? (
            <EmptyState
              title="The pool is empty"
              message="Add one key per teammate. TokenRing spreads traffic across them, skips any that hit their rate limit, and puts them back when the limit resets."
              action={
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setDraft(emptyDraft(defaultProviderId))}
                  disabled={providerList.length === 0}
                >
                  <IconPlus />
                  Add the first key
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data wide">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Status</th>
                    <th style={{ minWidth: 168 }}>This minute</th>
                    <th className="num">Requests</th>
                    <th className="num">Tokens</th>
                    <th className="num">Avg latency</th>
                    <th>Last used</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((key) => (
                    <tr key={key.id}>
                      <td>
                        <div className="row-title">{key.label}</div>
                        <div className="row-sub">
                          <span className="mono">{key.secretHint}</span>
                          {key.owner && ` · ${key.owner}`}
                          {providerList.length > 1 && ` · ${key.providerName}`}
                        </div>
                      </td>
                      <td>
                        {statusBadge(key)}
                        {key.lastError && !key.enabled && (
                          <div className="row-sub truncate" style={{ maxWidth: 220 }} title={key.lastError}>
                            {key.lastError}
                          </div>
                        )}
                      </td>
                      <td>
                        <Meter
                          value={key.live.load}
                          detail={
                            key.rpmLimit > 0
                              ? `${key.live.requestsUsed}/${key.rpmLimit} rpm`
                              : `${key.live.requestsUsed} rpm`
                          }
                          label={key.tpmLimit > 0 ? `${compact(key.live.tokensUsed)}/${compact(key.tpmLimit)} tpm` : ''}
                        />
                      </td>
                      <td className="num">{full(key.usage.requests)}</td>
                      <td className="num">{compact(key.usage.totalTokens)}</td>
                      <td className="num">{duration(key.usage.avgLatencyMs)}</td>
                      <td className="muted">{relativeTime(key.lastUsedAt)}</td>
                      <td className="actions">
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          {key.live.status === 'cooling' && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm btn-icon"
                              title="Return to rotation now"
                              onClick={() => void clearCooldown(key)}
                            >
                              <IconRefresh />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Test against the provider"
                            disabled={testing === key.id}
                            onClick={() => void test(key)}
                          >
                            <IconBolt />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Edit"
                            onClick={() => {
                              setFormError(null);
                              setDraft(toDraft(key));
                            }}
                          >
                            <IconEdit />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Remove"
                            onClick={() => setConfirmDelete(key)}
                          >
                            <IconTrash />
                          </button>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          <Switch
                            checked={key.enabled}
                            onChange={() => void toggle(key)}
                            label={<span className="muted" style={{ fontSize: 11.5 }}>Enabled</span>}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <p className="muted page-section" style={{ fontSize: 12.5 }}>
            Rate limits are what TokenRing balances against. Leave one blank to mean “no limit
            known”, and the key will simply take its turn in the rotation.
          </p>
        )}
      </div>

      {draft && (
        <Dialog
          title={draft.id ? 'Edit upstream key' : 'Add upstream key'}
          description={
            draft.id
              ? 'Leave the secret blank to keep the stored one.'
              : 'Paste a real provider key. It is encrypted before it touches disk.'
          }
          onClose={() => setDraft(null)}
          footer={
            <>
              {formError && <span className="error spacer" style={{ color: 'var(--critical)' }}>{formError}</span>}
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !draft.label.trim() || (!draft.id && !draft.secret.trim())}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Add to pool'}
              </button>
            </>
          }
        >
          <div className="grid grid-form">
            <Field label="Label" help="How you recognise this key.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={draft.label}
                  autoFocus
                  placeholder="Ali's work key"
                  onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                />
              )}
            </Field>
            <Field label="Owner" help="Who this key belongs to.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={draft.owner}
                  placeholder="Ali"
                  onChange={(event) => setDraft({ ...draft, owner: event.target.value })}
                />
              )}
            </Field>
          </div>

          <Field
            label={draft.id ? 'Replace secret' : 'Provider API key'}
            help={draft.id ? 'Leave blank to keep the current secret.' : 'Stored encrypted; only a masked hint is ever displayed.'}
          >
            {(id) => (
              <input
                id={id}
                className="input mono"
                type="password"
                autoComplete="off"
                value={draft.secret}
                placeholder="sk-…"
                onChange={(event) => setDraft({ ...draft, secret: event.target.value })}
              />
            )}
          </Field>

          {providerList.length > 1 && (
            <Field label="Provider" help="Which upstream this key authenticates against.">
              {(id) => (
                <select
                  id={id}
                  className="select"
                  value={draft.providerId}
                  onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}
                >
                  {providerList.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} — {provider.baseUrl}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <div className="grid grid-form">
            <Field label="Requests per minute" help="The provider's limit. Blank = unknown.">
              {(id) => (
                <input
                  id={id}
                  className="input tnum"
                  inputMode="numeric"
                  value={draft.rpmLimit}
                  placeholder="unlimited"
                  onChange={(event) => setDraft({ ...draft, rpmLimit: event.target.value })}
                />
              )}
            </Field>
            <Field label="Tokens per minute" help="Blank = unknown.">
              {(id) => (
                <input
                  id={id}
                  className="input tnum"
                  inputMode="numeric"
                  value={draft.tpmLimit}
                  placeholder="unlimited"
                  onChange={(event) => setDraft({ ...draft, tpmLimit: event.target.value })}
                />
              )}
            </Field>
            <Field label="Requests per day" help="Blank = unlimited.">
              {(id) => (
                <input
                  id={id}
                  className="input tnum"
                  inputMode="numeric"
                  value={draft.dailyRequestLimit}
                  placeholder="unlimited"
                  onChange={(event) => setDraft({ ...draft, dailyRequestLimit: event.target.value })}
                />
              )}
            </Field>
            <Field label="Weight" help="Higher means a larger share of traffic.">
              {(id) => (
                <input
                  id={id}
                  className="input tnum"
                  inputMode="numeric"
                  value={draft.weight}
                  onChange={(event) => setDraft({ ...draft, weight: event.target.value })}
                />
              )}
            </Field>
          </div>

          <Field label="Notes" help="Optional. Renewal dates, plan tier, anything worth remembering.">
            {(id) => (
              <textarea
                id={id}
                className="textarea"
                value={draft.notes}
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            )}
          </Field>

          <Switch
            checked={draft.enabled}
            onChange={(enabled) => setDraft({ ...draft, enabled })}
            label="Available for routing"
          />
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog
          title={`Remove ${confirmDelete.label}?`}
          description="The stored secret is deleted. Past usage stays in the activity log."
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void remove(confirmDelete)}>
                Remove key
              </button>
            </>
          }
        >
          <dl className="detail-grid">
            <dt>Owner</dt>
            <dd>{confirmDelete.owner || '—'}</dd>
            <dt>Secret</dt>
            <dd className="mono">{confirmDelete.secretHint}</dd>
            <dt>Rate limit</dt>
            <dd>{formatLimit(confirmDelete.rpmLimit, 'requests/min')}</dd>
            <dt>Requests in window</dt>
            <dd>{full(confirmDelete.usage.requests)}</dd>
          </dl>
        </Dialog>
      )}
    </>
  );
}
