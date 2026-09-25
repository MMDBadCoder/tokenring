import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** True only on the very first load, so refreshes don't blank the page. */
  initial: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads data, keeps the previous value visible while refreshing, and can poll.
 * `deps` re-runs the loader the way `useEffect` deps do.
 */
export function useResource<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: { pollMs?: number } = {},
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initial, setInitial] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loaderRef.current();
      setData(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
      setInitial(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!options.pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, options.pollMs);
    return () => clearInterval(timer);
  }, [reload, options.pollMs]);

  return { data, error, loading, initial, reload };
}
