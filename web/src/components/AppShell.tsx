import { NavLink } from 'react-router-dom';
import { CopyField, Segmented } from './Primitives';
import {
  BrandMark,
  IconActivity,
  IconGauge,
  IconKey,
  IconLogout,
  IconSettings,
  IconUpstream,
} from './Icons';
import { useTheme, type ThemeChoice } from '../lib/useTheme';

export interface ShellCounts {
  upstreamKeys: number;
  virtualKeys: number;
}

const NAV = [
  { to: '/', label: 'Overview', icon: IconGauge, end: true, count: null },
  { to: '/upstream-keys', label: 'Upstream keys', icon: IconUpstream, end: false, count: 'upstreamKeys' },
  { to: '/keys', label: 'TokenRing keys', icon: IconKey, end: false, count: 'virtualKeys' },
  { to: '/activity', label: 'Activity', icon: IconActivity, end: false, count: null },
  { to: '/settings', label: 'Settings', icon: IconSettings, end: false, count: null },
] as const;

export function AppShell({
  counts,
  baseUrl,
  onSignOut,
  children,
}: {
  counts: ShellCounts;
  baseUrl: string;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [theme, setTheme] = useTheme();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <div>
            <div className="brand-name">TokenRing</div>
            <div className="brand-sub">API key pool</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            const count = item.count ? counts[item.count] : null;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                <Icon />
                {item.label}
                {count !== null && count > 0 && <span className="nav-count">{count}</span>}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="endpoint-card">
            <div className="eyebrow">Base URL for your agents</div>
            <CopyField value={`${baseUrl}/v1`} label="base URL" wrap />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Segmented<ThemeChoice>
              ariaLabel="Colour theme"
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: '☀' },
                { value: 'system', label: 'Auto' },
                { value: 'dark', label: '☾' },
              ]}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSignOut}
              style={{ marginLeft: 'auto' }}
            >
              <IconLogout />
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className="main">{children}</div>
    </div>
  );
}
