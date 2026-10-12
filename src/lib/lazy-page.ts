import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'lazy-page-reloaded-at';

/**
 * React.lazy for a route page, plus a `preload()` to fetch its chunk ahead of time.
 *
 * After a new deploy the old page chunks are gone, so an open tab can fail to load a
 * page it has not visited yet. Opening such a page reloads the app once (to pick up the
 * new build) instead of showing a blank screen; a second failure within a minute is
 * thrown. A failed background preload never reloads, it is just forgotten.
 */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  let pending: Promise<{ default: T }> | null = null;
  const preload = () => {
    pending ??= load().catch((err) => { pending = null; throw err; });
    return pending;
  };
  const Page = lazy(() => preload().catch((err) => {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
    if (Date.now() - last > 60_000) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
      window.location.reload();
      return new Promise<never>(() => {});
    }
    throw err;
  }));
  return Object.assign(Page, { preload });
}
