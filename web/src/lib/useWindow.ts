import { useCallback, useEffect, useState } from 'react';

export const WINDOW_OPTIONS = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
] as const;

export type WindowValue = (typeof WINDOW_OPTIONS)[number]['value'];

const STORAGE_KEY = 'tokenring.window';
const listeners = new Set<(value: WindowValue) => void>();

function read(): WindowValue {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (WINDOW_OPTIONS.some((option) => option.value === stored)) return stored as WindowValue;
  } catch {
    // Storage is optional; the default window still applies.
  }
  return '24h';
}

/** One time range shared by every page, so switching tabs keeps the context. */
export function useWindowRange(): [WindowValue, (next: WindowValue) => void] {
  const [value, setValue] = useState<WindowValue>(read);

  useEffect(() => {
    const listener = (next: WindowValue) => setValue(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const update = useCallback((next: WindowValue) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore — the in-memory value is what the page reads.
    }
    for (const listener of listeners) listener(next);
  }, []);

  return [value, update];
}
