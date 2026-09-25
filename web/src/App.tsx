import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { api } from './lib/api';
import { AppShell } from './components/AppShell';
import { Toaster } from './components/Toaster';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { UpstreamKeys } from './pages/UpstreamKeys';
import { VirtualKeys } from './pages/VirtualKeys';
import { Activity } from './pages/Activity';
import { Settings } from './pages/Settings';

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [counts, setCounts] = useState({ upstreamKeys: 0, virtualKeys: 0 });

  useEffect(() => {
    api
      .session()
      .then((result) => setAuthenticated(result.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  const refreshCounts = useCallback(async () => {
    try {
      const [upstream, virtual] = await Promise.all([
        api.upstreamKeys('24h'),
        api.virtualKeys('24h'),
      ]);
      setCounts({ upstreamKeys: upstream.keys.length, virtualKeys: virtual.keys.length });
    } catch {
      // Counts are decoration; a failure here must not block the dashboard.
    }
  }, []);

  useEffect(() => {
    if (authenticated) void refreshCounts();
  }, [authenticated, refreshCounts]);

  async function signOut() {
    await api.logout().catch(() => undefined);
    setAuthenticated(false);
  }

  if (authenticated === null) return <div className="login" />;
  if (!authenticated) return <Login onSignedIn={() => setAuthenticated(true)} />;

  const baseUrl = window.location.origin;

  return (
    <Toaster>
      <AppShell counts={counts} baseUrl={baseUrl} onSignOut={signOut}>
        <Routes>
          <Route path="/" element={<Overview baseUrl={baseUrl} />} />
          <Route path="/upstream-keys" element={<UpstreamKeys onChanged={refreshCounts} />} />
          <Route path="/keys" element={<VirtualKeys baseUrl={baseUrl} onChanged={refreshCounts} />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </Toaster>
  );
}
