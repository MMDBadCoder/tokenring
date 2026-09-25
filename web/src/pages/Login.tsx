import { useState } from 'react';
import { api } from '../lib/api';
import { BrandMark } from '../components/Icons';
import { Field } from '../components/Primitives';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSignedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="card login-card">
        <div className="card-pad">
          <div className="login-brand">
            <BrandMark size={40} />
            <h1>TokenRing</h1>
            <p>Sign in to manage the key pool.</p>
          </div>

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field
              label="Dashboard password"
              error={error ?? undefined}
              help="Set with TOKENRING_ADMIN_PASSWORD, or printed to the server console on first boot."
            >
              {(id) => (
                <input
                  id={id}
                  className="input"
                  type="password"
                  value={password}
                  autoFocus
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>
            <button type="submit" className="btn btn-primary" disabled={busy || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
