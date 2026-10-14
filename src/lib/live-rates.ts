// Live costing rates (Odoo exchange rate, LaborTrax labor cost per man-hour).
//
// The live-rates-sync edge function writes the latest values into
// global_settings.live_*, and costing always uses them. Every engine path (through mergeSettingsWithInquiry) reads:
//   exchange_rate            ← live_exchange_rate (Odoo INR per USD)
//   indirect_overhead_per_mh ← live_burdened_per_mh (LaborTrax fully burdened ₹/MH)
//   direct wage per type     ← live_direct_rates[labor_type] (LaborTrax ₹/MH), else fallback_direct_rates[labor_type]
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
 * The rate list costing averages wages from, one entry per labor type: the live LaborTrax
 * rate, else the fallback ₹/hr set in Settings (global_settings.fallback_direct_rates), else
 * the old Labor Directory employee average (only until the fallback rates are saved).
 * Finishing auto-hours and direct cost read the same list, so they always agree.
 */
export function withLiveDirectRates<E extends { hourly_rate_inr: number; designations: string[] }>(
  employees: E[] | null | undefined,
  settings: Record<string, any> | null | undefined,
): E[] {
  const list = employees || [];
  const rates: Record<string, number> = {};
  for (const [t, v] of Object.entries((settings?.fallback_direct_rates || {}) as Record<string, unknown>)) { const n = pos(v); if (n != null) rates[t] = n; }
  if (settings?.__live_applied) {
    for (const [t, v] of Object.entries((settings.live_direct_rates || {}) as Record<string, unknown>)) { const n = pos(v); if (n != null) rates[t] = n; }
  }
  const types = Object.keys(rates);
  if (types.length === 0) return list;
  const set = new Set(types);
  return [
    ...list
      .map(e => ({ ...e, designations: (e.designations || []).filter(d => !set.has(d)) }))
      .filter(e => e.designations.length > 0),
    ...types.map(t => ({ hourly_rate_inr: rates[t], designations: [t] }) as unknown as E),
  ];
}

export function isLiveStale(at: string | null | undefined, now = new Date(), hours = LIVE_STALE_HOURS): boolean {
  if (!at) return true;
  const t = new Date(at).getTime();
  return !Number.isFinite(t) || now.getTime() - t > hours * 3_600_000;
}
