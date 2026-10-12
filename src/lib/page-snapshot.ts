// The last data a list page loaded, kept in memory for this session. Coming back to the
// page shows the snapshot at once while the page reloads fresh data in the background
// (and replaces it), instead of a blank "Loading…" every visit.

const MAX_AGE_MS = 30 * 60_000;

const snapshots = new Map<string, { at: number; value: unknown }>();

export function readSnapshot<T>(key: string): T | undefined {
  const s = snapshots.get(key);
  if (!s) return undefined;
  if (Date.now() - s.at > MAX_AGE_MS) { snapshots.delete(key); return undefined; }
  return s.value as T;
}

export function writeSnapshot<T>(key: string, value: T): void {
  snapshots.set(key, { at: Date.now(), value });
}

/** Forget every snapshot (on sign-out, so the next person never sees them). */
export function clearSnapshots(): void {
  snapshots.clear();
}
