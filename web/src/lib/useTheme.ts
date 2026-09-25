import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'tokenring.theme';

function read(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Private browsing or blocked storage — fall back to the OS setting.
  }
  return 'system';
}

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [theme, setTheme] = useState<ThemeChoice>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    try {
      if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Persistence is a convenience; the current session still works.
    }
  }, [theme]);

  return [theme, useCallback((next: ThemeChoice) => setTheme(next), [])];
}
