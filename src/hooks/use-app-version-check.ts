import { useCallback, useEffect, useRef, useState } from 'react';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // poll every 5 min while app is open

/** Returns true when the deployed build id differs from the running one. */
export async function checkForNewVersion(currentBuildId: string): Promise<boolean> {
  if (import.meta.env.DEV) return false;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as { buildId?: string };
    return Boolean(data?.buildId && data.buildId !== currentBuildId);
  } catch {
    // network hiccup — don't nag the user over a failed check
    return false;
  }
}

/** Checks once and forces a hard reload if the deploy is newer. Used at login. */
export async function reloadIfStale(): Promise<void> {
  const stale = await checkForNewVersion(__APP_BUILD_ID__);
  if (stale) window.location.reload();
}

export function useAppVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const currentBuildId = useRef<string>(__APP_BUILD_ID__);

  const checkNow = useCallback(async () => {
    const stale = await checkForNewVersion(currentBuildId.current);
    if (stale) setUpdateAvailable(true);
    return stale;
  }, []);

  useEffect(() => {
    void checkNow(); // covers fresh app opens, including post-login

    const interval = setInterval(() => void checkNow(), CHECK_INTERVAL_MS);

    // Foreground return is the moment that matters most on mobile — a phone app can
    // sit backgrounded for days holding an old bundle.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void checkNow();
    };
    const onFocus = () => void checkNow();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [checkNow]);

  return { updateAvailable, checkNow };
}
