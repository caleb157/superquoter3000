// Live costing results kept between page visits, so going back to the Inquiries or
// Products list shows its numbers at once instead of re-running the costing engine.
//
// An entry is used for at most TTL_MS. Opening an inquiry (or its costing / PD / planner
// pages) drops that inquiry's entries, because that is where its numbers change; opening a
// product, an assembly or Settings drops everything. noteRouteForLiveCosts() is called on
// every page change (AppLayout).

const TTL_MS = 10 * 60_000;

type Entry = { at: number; inquiryId: string | null; value: unknown };

const entries = new Map<string, Entry>();

function getFresh<T>(key: string): T | undefined {
  const e = entries.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > TTL_MS) { entries.delete(key); return undefined; }
  return e.value as T;
}

/** Cached values for these ids under `kind`, fresh ones only. */
export function getLiveCosts<T>(kind: string, ids: string[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const id of ids) {
    const v = getFresh<T>(`${kind}:${id}`);
    if (v !== undefined) out[id] = v;
  }
  return out;
}

/** Store values by id; `inquiryOf` names each value's inquiry so it can be dropped with it. */
export function setLiveCosts<T>(kind: string, values: Record<string, T>, inquiryOf: (id: string, v: T) => string | null): void {
  const at = Date.now();
  for (const [id, value] of Object.entries(values)) {
    entries.set(`${kind}:${id}`, { at, inquiryId: inquiryOf(id, value), value });
  }
}

/** Drop one inquiry's cached results, or everything when no id is given. */
export function invalidateLiveCosts(inquiryId?: string): void {
  if (!inquiryId) { entries.clear(); return; }
  for (const [key, e] of entries) if (e.inquiryId === inquiryId) entries.delete(key);
}

/** Drops whatever the page being opened can change. */
export function noteRouteForLiveCosts(pathname: string): void {
  const inquiry = pathname.match(/^\/inquiry\/([^/?#]+)/);
  if (inquiry) { invalidateLiveCosts(inquiry[1]); return; }
  if (/^\/(product|assembly|settings)(\/|$)/.test(pathname)) invalidateLiveCosts();
}
