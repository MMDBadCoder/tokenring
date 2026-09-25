import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useResource } from '../lib/useResource';
import { full } from '../lib/format';
import type { BalancingStrategy, Provider, RuntimeSettings } from '../lib/types';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toaster';
import { Badge, Dialog, Field, Switch } from '../components/Primitives';
import { IconPlus, IconTrash } from '../components/Icons';

const STRATEGY_COPY: Record<BalancingStrategy, { title: string; blurb: string }> = {
  least_loaded: {
    title: 'Least loaded',
    blurb:
      'Sends each request to the key with the most headroom against its own limits. The best default when teammates have different plans.',
  },
  round_robin: {
    title: 'Round robin',
    blurb: 'Strict rotation through every key that currently has capacity. Predictable and easy to reason about.',
  },
  weighted_random: {
    title: 'Weighted random',
    blurb: 'Random choice in proportion to each key’s weight. Good when one account is much larger than the rest.',
  },
  failover: {
    title: 'Failover',
    blurb: 'Always prefers the highest-weight key and only moves on when it is exhausted. Use when one key should absorb everything.',
  },
};

const NUMBER_FIELDS: {
  key: keyof RuntimeSettings;
  label: string;
  help: string;
  suffix?: string;
  scale?: number;
}[] = [
  {
    key: 'maxAttempts',
    label: 'Attempts per request',
    help: 'How many different keys to try before giving up.',
  },
  {
    key: 'waitForCapacityMs',
    label: 'Wait for capacity',
    help: 'Hold a request this long when every key is saturated, instead of returning 429 straight away.',
    suffix: 'seconds',
    scale: 1_000,
  },
  {
    key: 'requestTimeoutMs',
    label: 'Upstream timeout',
    help: 'Abort an upstream call that produces no response in this time.',
    suffix: 'seconds',
    scale: 1_000,
  },
  {
    key: 'rateLimitCooldownSeconds',
    label: 'Rate-limit cooldown',
    help: 'Quarantine after a 429 that carries no Retry-After header.',
    suffix: 'seconds',
  },
  {
    key: 'failureCooldownSeconds',
    label: 'Failure cooldown',
    help: 'Quarantine after connection errors or 5xx responses.',
    suffix: 'seconds',
  },
  {
    key: 'failureThreshold',
    label: 'Failures before quarantine',
    help: 'Consecutive failures tolerated before a key is pulled from rotation.',
  },
  {
    key: 'logRetentionDays',
    label: 'Keep activity for',
    help: 'Older request logs are deleted automatically. 0 keeps everything.',
    suffix: 'days',
  },
];

const TOGGLES: { key: keyof RuntimeSettings; label: string; help: string }[] = [
  {
    key: 'disableOnAuthError',
    label: 'Disable a key when the provider rejects it',
    help: 'A 401 or 403 means the key is revoked or wrong. Turning this off leaves it in rotation.',
  },
  {
    key: 'injectUsageTracking',
    label: 'Ask for token counts on streamed replies',
    help: 'Adds stream_options.include_usage so streaming requests report real usage. Turn off if a client cannot handle the final usage chunk.',
  },
  {
    key: 'estimateMissingTokens',
    label: 'Estimate tokens when the provider reports none',
    help: 'Approximates from text length so usage charts stay meaningful. Estimated rows are marked with ≈.',
  },
  {
    key: 'forwardRateLimitHeaders',
    label: 'Forward upstream x-ratelimit-* headers',
    help: 'Off by default: those headers describe one pooled key, not the pool, and confuse clients that read them.',
  },
];

export function Settings() {
  const toast = useToast();
  const settings = useResource(() => api.settings(), []);
  const providers = useResource(() => api.providers(), []);

  const [form, setForm] = useState<RuntimeSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [providerDraft, setProviderDraft] = useState<Partial<Provider> | null>(null);
  const [confirmProvider, setConfirmProvider] = useState<Provider | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(settings.data.settings);
  }, [settings.data]);

  const dirty =
    form !== null &&
    settings.data !== null &&
    JSON.stringify(form) !== JSON.stringify(settings.data.settings);

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await api.saveSettings(form);
      await settings.reload();
      toast.success('Settings saved. They apply to the next request.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function saveProvider() {
    if (!providerDraft?.name || !providerDraft.baseUrl) return;
    try {
      if (providerDraft.id) {
        await api.updateProvider(providerDraft.id, providerDraft);
      } else {
        await api.createProvider(providerDraft);
      }
      setProviderDraft(null);
      await providers.reload();
      toast.success('Provider saved.');
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not save the provider.');
    }
  }

  async function removeProvider(provider: Provider) {
    try {
      await api.deleteProvider(provider.id);
      setConfirmProvider(null);
      await providers.reload();
      toast.success(`Removed ${provider.name}.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not remove the provider.');
    }
  }

  async function makeDefault(provider: Provider) {
    await api.updateProvider(provider.id, { isDefault: true }).catch(() => undefined);
    await providers.reload();
  }

  async function prune() {
    try {
      const result = await api.pruneLogs();
      toast.success(
        result.deleted > 0
          ? `Deleted ${full(result.deleted)} old log entries.`
          : 'Nothing was old enough to delete.',
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'Could not prune the logs.');
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="How TokenRing chooses keys, recovers from failures, and accounts for usage."
        actions={
          dirty ? (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setForm(settings.data?.settings ?? null)}
              >
                Discard
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>
              All changes saved
            </span>
          )
        }
      />

      <div className="page" style={{ maxWidth: 940 }}>
        {form && (
          <>
            <section>
              <div className="section-head">
                <h2>Balancing strategy</h2>
                <span className="hint">Applied to the next request — no restart needed.</span>
              </div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))' }}>
                {(Object.keys(STRATEGY_COPY) as BalancingStrategy[]).map((strategy) => {
                  const active = form.strategy === strategy;
                  return (
                    <button
                      key={strategy}
                      type="button"
                      className="card card-pad"
                      onClick={() => setForm({ ...form, strategy })}
                      style={{
                        textAlign: 'left',
                        cursor: 'pointer',
                        borderColor: active ? 'var(--accent)' : undefined,
                        boxShadow: active ? '0 0 0 3px var(--accent-ring)' : undefined,
                        background: active ? 'var(--accent-wash)' : undefined,
                      }}
                      aria-pressed={active}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontWeight: 620 }}>{STRATEGY_COPY[strategy].title}</span>
                        {active && <Badge tone="accent">In use</Badge>}
                      </div>
                      <p className="secondary" style={{ fontSize: 12.5 }}>
                        {STRATEGY_COPY[strategy].blurb}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="page-section">
              <div className="section-head">
                <h2>Retries and recovery</h2>
              </div>
              <div className="card card-pad">
                <div className="grid grid-form">
                  {NUMBER_FIELDS.map((field) => {
                    const scale = field.scale ?? 1;
                    const value = (form[field.key] as number) / scale;
                    return (
                      <Field key={String(field.key)} label={field.label} help={field.help}>
                        {(id) => (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              id={id}
                              className="input tnum"
                              inputMode="numeric"
                              value={String(value)}
                              onChange={(event) => {
                                const parsed = Number(event.target.value);
                                if (!Number.isFinite(parsed) || parsed < 0) return;
                                setForm({ ...form, [field.key]: Math.round(parsed * scale) });
                              }}
                            />
                            {field.suffix && (
                              <span className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                                {field.suffix}
                              </span>
                            )}
                          </div>
                        )}
                      </Field>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="page-section">
              <div className="section-head">
                <h2>Behaviour</h2>
              </div>
              <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {TOGGLES.map((toggle) => (
                  <div key={String(toggle.key)}>
                    <Switch
                      checked={form[toggle.key] as boolean}
                      onChange={(next) => setForm({ ...form, [toggle.key]: next })}
                      label={toggle.label}
                    />
                    <p className="muted" style={{ fontSize: 12, marginTop: 4, marginLeft: 43 }}>
                      {toggle.help}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="page-section">
          <div className="section-head">
            <h2>Providers</h2>
            <span className="hint">Where pooled keys are forwarded. The base URL should include /v1.</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setProviderDraft({ name: '', baseUrl: 'https://' })}
            >
              <IconPlus />
              Add provider
            </button>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Base URL</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(providers.data?.providers ?? []).map((provider) => (
                    <tr key={provider.id}>
                      <td>
                        <span className="row-title">{provider.name}</span>{' '}
                        {provider.isDefault && <Badge tone="accent">Default</Badge>}
                      </td>
                      <td className="mono">{provider.baseUrl}</td>
                      <td className="actions">
                        {!provider.isDefault && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void makeDefault(provider)}
                          >
                            Make default
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setProviderDraft(provider)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm btn-icon"
                          aria-label={`Remove ${provider.name}`}
                          onClick={() => setConfirmProvider(provider)}
                        >
                          <IconTrash />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section className="page-section">
          <div className="section-head">
            <h2>Maintenance</h2>
          </div>
          <div className="card card-pad" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <button type="button" className="btn" onClick={() => void prune()}>
              Prune activity now
            </button>
            <button type="button" className="btn" onClick={() => setPasswordOpen(true)}>
              Change dashboard password
            </button>
          </div>
        </section>
      </div>

      {providerDraft && (
        <Dialog
          title={providerDraft.id ? 'Edit provider' : 'Add provider'}
          description="Requests are forwarded to this base URL with a pooled key attached."
          onClose={() => setProviderDraft(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setProviderDraft(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void saveProvider()}>
                Save provider
              </button>
            </>
          }
        >
          <Field label="Name" help="Just a label for the dashboard.">
            {(id) => (
              <input
                id={id}
                className="input"
                autoFocus
                value={providerDraft.name ?? ''}
                placeholder="OpenAI"
                onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}
              />
            )}
          </Field>
          <Field label="Base URL" help="Include the version segment, e.g. https://api.openai.com/v1">
            {(id) => (
              <input
                id={id}
                className="input mono"
                value={providerDraft.baseUrl ?? ''}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })}
              />
            )}
          </Field>
        </Dialog>
      )}

      {confirmProvider && (
        <Dialog
          title={`Remove ${confirmProvider.name}?`}
          description="Only possible once no upstream keys point at it."
          onClose={() => setConfirmProvider(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmProvider(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => void removeProvider(confirmProvider)}>
                Remove provider
              </button>
            </>
          }
        >
          <p className="secondary" style={{ fontSize: 13 }}>
            <span className="mono">{confirmProvider.baseUrl}</span>
          </p>
        </Dialog>
      )}

      {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} />}
    </>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await api.changePassword(current, next);
      toast.success('Password changed. Sign in again with the new one.');
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the password.');
    }
  }

  return (
    <Dialog
      title="Change dashboard password"
      description="Every signed-in session is ended, including this one."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!current || next.length < 8}
            onClick={() => void submit()}
          >
            Change password
          </button>
        </>
      }
    >
      <Field label="Current password" error={error ?? undefined}>
        {(id) => (
          <input
            id={id}
            className="input"
            type="password"
            autoFocus
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        )}
      </Field>
      <Field label="New password" help="At least 8 characters.">
        {(id) => (
          <input
            id={id}
            className="input"
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}
