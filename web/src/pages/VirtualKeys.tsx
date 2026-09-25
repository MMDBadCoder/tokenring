import { useState } from 'react';
import { api } from '../lib/api';
import { useResource } from '../lib/useResource';
import { WINDOW_OPTIONS, useWindowRange, type WindowValue } from '../lib/useWindow';
import { compact, formatLimit, full, relativeTime } from '../lib/format';
import type { VirtualKey } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toaster';
import {
  Badge,
  CopyField,
  Dialog,
  EmptyState,
  Field,
  Segmented,
  Switch,
} from '../components/Primitives';
import { IconEdit, IconPlus, IconRefresh, IconTrash } from '../components/Icons';

interface Draft {
  id?: string;
  name: string;
  owner: string;
  rpmLimit: string;
  dailyRequestLimit: string;
  dailyTokenLimit: string;
  allowedModels: string;
  expiresAt: string;
  notes: string;
  enabled: boolean;
}

const emptyDraft: Draft = {
  name: '',
  owner: '',
  rpmLimit: '',
  dailyRequestLimit: '',
  dailyTokenLimit: '',
  allowedModels: '',
  expiresAt: '',
  notes: '',
  enabled: true,
};

const toDraft = (key: VirtualKey): Draft => ({
  id: key.id,
  name: key.name,
  owner: key.owner,
  rpmLimit: key.rpmLimit ? String(key.rpmLimit) : '',
  dailyRequestLimit: key.dailyRequestLimit ? String(key.dailyRequestLimit) : '',
  dailyTokenLimit: key.dailyTokenLimit ? String(key.dailyTokenLimit) : '',
  allowedModels: key.allowedModels.join(', '),
  expiresAt: key.expiresAt ? new Date(key.expiresAt).toISOString().slice(0, 10) : '',
  notes: key.notes,
  enabled: key.enabled,
});

const numberOrZero = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

function statusBadge(key: VirtualKey) {
  if (!key.enabled) return <Badge tone="neutral">Disabled</Badge>;
  if (key.live.expired) return <Badge tone="critical">Expired</Badge>;
  return <Badge tone="good">Active</Badge>;
}

export function VirtualKeys({ baseUrl, onChanged }: { baseUrl: string; onChanged: () => void }) {
  const toast = useToast();
  const [range, setRange] = useWindowRange();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revealed, setRevealed] = useState<{ token: string; name: string; rotated: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<VirtualKey | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<VirtualKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const keys = useResource(() => api.virtualKeys(range), [range], { pollMs: 20_000 });
  const rows = keys.data?.keys ?? [];

  async function save() {
    if (!draft) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      name: draft.name.trim(),
      owner: draft.owner.trim(),
      rpmLimit: numberOrZero(draft.rpmLimit),
      dailyRequestLimit: numberOrZero(draft.dailyRequestLimit),
      dailyTokenLimit: numberOrZero(draft.dailyTokenLimit),
      allowedModels: draft.allowedModels
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
      expiresAt: draft.expiresAt ? new Date(`${draft.expiresAt}T23:59:59`).getTime() : 0,
      notes: draft.notes.trim(),
      enabled: draft.enabled,
    };

    try {
      if (draft.id) {
        await api.updateVirtualKey(draft.id, payload);
        toast.success(`Updated ${payload.name}.`);
      } else {
        const created = await api.createVirtualKey(payload);
        setRevealed({ token: created.token, name: created.key.name, rotated: false });
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

  async function rotate(key: VirtualKey) {
    try {
      const result = await api.rotateVirtualKey(key.id);
      setConfirmRotate(null);
      setRevealed({ token: result.token, name: result.key.name, rotated: true });
      await keys.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not rotate the key.');
    }
  }

  async function remove(key: VirtualKey) {
    try {
      await api.deleteVirtualKey(key.id);
      toast.success(`Revoked ${key.name}.`);
      setConfirmDelete(null);
      await keys.reload();
      onChanged();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not revoke the key.');
    }
  }

  async function toggle(key: VirtualKey) {
    try {
      await api.updateVirtualKey(key.id, { enabled: !key.enabled });
      await keys.reload();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not update the key.');
    }
  }

  return (
    <>
      <PageHeader
        title="TokenRing keys"
        subtitle="The keys you hand out. Each one is tracked separately, so you always know who spent what."
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
                setDraft({ ...emptyDraft });
              }}
            >
              <IconPlus />
              Generate key
            </button>
          </>
        }
      />

      <div className="page">
        <div className="card">
          {rows.length === 0 ? (
            <EmptyState
              title="No keys issued yet"
              message="Generate one key per person or agent. They point their OpenAI client at TokenRing and never touch a real provider key."
              action={
                <button type="button" className="btn btn-primary" onClick={() => setDraft({ ...emptyDraft })}>
                  <IconPlus />
                  Generate the first key
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
                    <th className="num">Requests</th>
                    <th className="num">Tokens</th>
                    <th className="num">Failed</th>
                    <th>Limits</th>
                    <th>Last used</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((key) => (
                    <tr key={key.id}>
                      <td>
                        <div className="row-title">{key.name}</div>
                        <div className="row-sub">
                          <span className="mono">{key.keyHint}</span>
                          {key.owner && ` · ${key.owner}`}
                        </div>
                      </td>
                      <td>{statusBadge(key)}</td>
                      <td className="num">{full(key.usage.requests)}</td>
                      <td className="num">{compact(key.usage.totalTokens)}</td>
                      <td className="num">
                        {key.usage.failed > 0 ? (
                          <span style={{ color: 'var(--critical)' }}>{full(key.usage.failed)}</span>
                        ) : (
                          <span className="muted">0</span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {key.rpmLimit || key.dailyRequestLimit || key.dailyTokenLimit ? (
                          <>
                            {key.rpmLimit > 0 && <div>{key.rpmLimit}/min</div>}
                            {key.dailyRequestLimit > 0 && <div>{full(key.dailyRequestLimit)} req/day</div>}
                            {key.dailyTokenLimit > 0 && (
                              <div>
                                {compact(key.live.tokensToday)}/{compact(key.dailyTokenLimit)} tok today
                              </div>
                            )}
                          </>
                        ) : (
                          'none'
                        )}
                      </td>
                      <td className="muted">{relativeTime(key.lastUsedAt)}</td>
                      <td className="actions">
                        <div style={{ display: 'inline-flex', gap: 2 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Issue a new token"
                            onClick={() => setConfirmRotate(key)}
                          >
                            <IconRefresh />
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
                            title="Revoke"
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
      </div>

      {draft && (
        <Dialog
          title={draft.id ? 'Edit key' : 'Generate a TokenRing key'}
          description={
            draft.id
              ? 'Quotas apply from the next request.'
              : 'The key is shown once, right after it is created.'
          }
          onClose={() => setDraft(null)}
          footer={
            <>
              {formError && <span className="spacer" style={{ color: 'var(--critical)', fontSize: 12.5 }}>{formError}</span>}
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !draft.name.trim()}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : draft.id ? 'Save changes' : 'Generate key'}
              </button>
            </>
          }
        >
          <div className="grid grid-form">
            <Field label="Name" help="The agent or app this key is for.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  autoFocus
                  value={draft.name}
                  placeholder="Research agent"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              )}
            </Field>
            <Field label="Owner" help="Who to ask about this key.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  value={draft.owner}
                  placeholder="Sara"
                  onChange={(event) => setDraft({ ...draft, owner: event.target.value })}
                />
              )}
            </Field>
          </div>

          <div className="grid grid-form">
            <Field label="Requests per minute" help="Blank = no limit.">
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
            <Field label="Requests per day" help="Blank = no limit.">
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
            <Field label="Tokens per day" help="Keeps one agent from draining the pool.">
              {(id) => (
                <input
                  id={id}
                  className="input tnum"
                  inputMode="numeric"
                  value={draft.dailyTokenLimit}
                  placeholder="unlimited"
                  onChange={(event) => setDraft({ ...draft, dailyTokenLimit: event.target.value })}
                />
              )}
            </Field>
            <Field label="Expires on" help="Blank = never.">
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="date"
                  value={draft.expiresAt}
                  onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
                />
              )}
            </Field>
          </div>

          <Field
            label="Allowed models"
            help="Comma separated. Blank allows every model the provider offers."
          >
            {(id) => (
              <input
                id={id}
                className="input mono"
                value={draft.allowedModels}
                placeholder="gpt-4o-mini, gpt-4o"
                onChange={(event) => setDraft({ ...draft, allowedModels: event.target.value })}
              />
            )}
          </Field>

          <Field label="Notes" help="Optional.">
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
            label="Accept requests from this key"
          />
        </Dialog>
      )}

      {revealed && (
        <Dialog
          wide
          title={revealed.rotated ? 'New key issued' : 'Key generated'}
          description="This is the only time the key is shown. TokenRing stores a hash, not the key itself."
          onClose={() => setRevealed(null)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setRevealed(null)}>
              Done
            </button>
          }
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              {revealed.name}
            </div>
            <CopyField value={revealed.token} label="API key" />
          </div>

          {revealed.rotated && (
            <p style={{ fontSize: 13, color: 'var(--serious)' }}>
              The previous key stopped working immediately. Update the agent before its next run.
            </p>
          )}

          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Environment variables
            </div>
            <pre className="code">
              <span className="k">OPENAI_BASE_URL</span>={baseUrl}/v1{'\n'}
              <span className="k">OPENAI_API_KEY</span>={revealed.token}
            </pre>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Python
            </div>
            <pre className="code">
              <span className="c">from</span> openai <span className="c">import</span> OpenAI{'\n\n'}
              client = OpenAI({'\n'}
              {'    '}base_url=<span className="k">&quot;{baseUrl}/v1&quot;</span>,{'\n'}
              {'    '}api_key=<span className="k">&quot;{revealed.token}&quot;</span>,{'\n'}
              ){'\n'}
            </pre>
          </div>
        </Dialog>
      )}

      {confirmRotate && (
        <Dialog
          title={`Issue a new key for ${confirmRotate.name}?`}
          description="The current key stops working the moment the new one is created."
          onClose={() => setConfirmRotate(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmRotate(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void rotate(confirmRotate)}>
                Rotate key
              </button>
            </>
          }
        >
          <dl className="detail-grid">
            <dt>Current key</dt>
            <dd className="mono">{confirmRotate.keyHint}</dd>
            <dt>Last used</dt>
            <dd>{relativeTime(confirmRotate.lastUsedAt)}</dd>
          </dl>
        </Dialog>
      )}

      {confirmDelete && (
        <Dialog
          title={`Revoke ${confirmDelete.name}?`}
          description="Requests using this key are refused immediately. Its history stays in the activity log."
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void remove(confirmDelete)}>
                Revoke key
              </button>
            </>
          }
        >
          <dl className="detail-grid">
            <dt>Key</dt>
            <dd className="mono">{confirmDelete.keyHint}</dd>
            <dt>Owner</dt>
            <dd>{confirmDelete.owner || '—'}</dd>
            <dt>Requests in window</dt>
            <dd>{full(confirmDelete.usage.requests)}</dd>
            <dt>Daily token limit</dt>
            <dd>{formatLimit(confirmDelete.dailyTokenLimit, 'tokens')}</dd>
          </dl>
        </Dialog>
      )}
    </>
  );
}
