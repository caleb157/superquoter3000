// Live costing rates (Odoo exchange rate, LaborTrax labor cost per man-hour).
//
// The live-rates-sync edge function writes the latest values into
// global_settings.live_*, and costing always uses them. Every engine path (through mergeSettingsWithInquiry) reads:
//   exchange_rate            ← live_exchange_rate (Odoo INR per USD)
//   indirect_overhead_per_mh ← live_burdened_per_mh (LaborTrax fully burdened ₹/MH)
//   direct wage per type     ← live_direct_rates[labor_type] (LaborTrax ₹/MH), else the employee average
// A per-inquiry override still wins, and a missing live value (never synced) falls back to
// the stored global_settings value, which is no longer edited in the UI.
// Pure (no supabase): the costing engine imports it. Syncing lives in live-rates-sync.ts.

export const LIVE_STALE_HOURS = 12;

export type LiveLaborDetail = {
  window: { from: string; to: string };
  /** Direct wages per type use a shorter recent window; types with no hours there fall back to `window`. */
  direct_window?: { from: string; to: string };
  direct_hours?: number;
  /** 'labortrax' = LaborTrax's own fully burdened figure; 'entries' = fallback average of labor entries. */
  burdened_source?: 'labortrax' | 'entries';
  direct_source?: Record<string, '3w' | '6m'>;
  hours: number;
  entries: number;
  burdened_per_mh: number;
  direct_per_mh: number;
  overhead_per_mh: number;
  categories: { category: string; laborType: string | null; hours: number; directPerMh: number }[];
};

const pos = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Last-resort INR per USD, used only when neither a live nor a stored rate exists (never after the first sync). */
export const FX_FALLBACK_INR_PER_USD = 90;

/** The given INR-per-USD rate, or the last-resort fallback with a console warning. */
export function fxOrFallback(rate: unknown): number {
  const n = pos(rate);
  if (n) return n;
  console.warn(`No exchange rate found; using ₹${FX_FALLBACK_INR_PER_USD}/USD`);
  return FX_FALLBACK_INR_PER_USD;
}

/** Global settings with the live values swapped in. Idempotent. */
export function applyLiveRates<T extends Record<string, any>>(gs: T | null | undefined): T {
  const base = (gs || {}) as any;
  if (base.__live_applied) return base as T;
  return {
    ...base,
    __live_applied: true,
    exchange_rate: pos(base.live_exchange_rate) ?? base.exchange_rate,
    indirect_overhead_per_mh: pos(base.live_burdened_per_mh) ?? base.indirect_overhead_per_mh,
  } as T;
}

/**
 * The employee list costing averages wages from, with each labor type that has a
 * live LaborTrax rate replaced by that rate. Types with no live rate keep the
 * employee average, so finishing auto-hours and direct cost use the same rate.
 */
export function withLiveDirectRates<E extends { hourly_rate_inr: number; designations: string[] }>(
  employees: E[] | null | undefined,
  settings: Record<string, any> | null | undefined,
): E[] {
  const list = employees || [];
  if (!settings?.__live_applied) return list;
  const rates = (settings.live_direct_rates || {}) as Record<string, unknown>;
  const live = Object.entries(rates).filter(([, v]) => pos(v) != null);
  if (live.length === 0) return list;
  const liveTypes = new Set(live.map(([t]) => t));
  return [
    ...list
      .map(e => ({ ...e, designations: (e.designations || []).filter(d => !liveTypes.has(d)) }))
      .filter(e => e.designations.length > 0),
    ...live.map(([t, v]) => ({ hourly_rate_inr: Number(v), designations: [t] }) as unknown as E),
  ];
}

export function isLiveStale(at: string | null | undefined, now = new Date(), hours = LIVE_STALE_HOURS): boolean {
  if (!at) return true;
  const t = new Date(at).getTime();
  return !Number.isFinite(t) || now.getTime() - t > hours * 3_600_000;
}
