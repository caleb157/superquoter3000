import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useState backed by sessionStorage. Persists per-tab so list filters/scroll
 * survive Back navigation but don't leak across browser sessions.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `pds:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // ignore quota / serialization errors
    }
  }, [storageKey, value]);

  return [value, setValue];
}

/**
 * Restores window scroll position on mount and saves it on unmount + scroll.
 * Intended for list pages so returning from a detail page lands you back at
 * the same row.
 */
export function useScrollRestoration(key: string, ready: boolean = true) {
  const storageKey = `pds-scroll:${key}`;
  const restoredKey = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (restoredKey.current === storageKey) return;
    let cancelled = false;
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      if (raw !== null) {
        const y = Number(raw);
        if (!Number.isNaN(y) && y > 0) {
          // Content may still be laying out (async lists, images, tabs).
          // Poll for up to ~1.2s until the document is tall enough, then scroll.
          const start = performance.now();
          const tryScroll = () => {
            if (cancelled) return;
            const maxY = Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight,
            ) - window.innerHeight;
            if (maxY >= y - 4 || performance.now() - start > 1200) {
              window.scrollTo(0, y);
              return;
            }
            requestAnimationFrame(tryScroll);
          };
          requestAnimationFrame(tryScroll);
        } else {
          window.scrollTo(0, 0);
        }
      } else {
        window.scrollTo(0, 0);
      }
    } catch {
      // ignore
    }
    restoredKey.current = storageKey;
    return () => { cancelled = true; };
  }, [ready, storageKey]);


  useEffect(() => {
    const save = () => {
      try {
        window.sessionStorage.setItem(storageKey, String(window.scrollY));
      } catch {
        // ignore
      }
    };
    window.addEventListener('scroll', save, { passive: true });
    window.addEventListener('beforeunload', save);
    return () => {
      save();
      window.removeEventListener('scroll', save);
      window.removeEventListener('beforeunload', save);
    };
  }, [storageKey]);

  return useCallback(() => {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey]);
}
