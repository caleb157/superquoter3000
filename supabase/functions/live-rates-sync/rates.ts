// Pure math for live-rates-sync, kept free of Deno APIs so vitest can cover it
// (src/lib/__tests__/live-rates.test.ts).

const num = (v: unknown) => (v == null || v === false ? 0 : Number(v) || 0);

/**
 * INR per 1 unit of an Odoo currency. Odoo's `rate` is units of the currency per
 * 1 unit of the company currency (INR), so INR per unit is its inverse;
 * `inverse_rate` is the same number pre-inverted and is the fallback.
 */
export function inrPerUnitFromOdoo(row: { rate?: unknown; inverse_rate?: unknown }): number {
  const r = num(row?.rate);
  if (r > 0) return 1 / r;
  const inv = num(row?.inverse_rate);
  return inv > 0 ? inv : 0;
}

/** The last `months` complete calendar months before `today` (YYYY-MM-DD, end inclusive). */
export function laborWindow(today: string, months = 6): { from: string; to: string } {
  const d = new Date(today.slice(0, 10) + 'T00:00:00Z');
  const firstOfThisMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = new Date(firstOfThisMonth.getTime() - 86400000);
  const from = new Date(Date.UTC(firstOfThisMonth.getUTCFullYear(), firstOfThisMonth.getUTCMonth() - months, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const pick = (e: any, keys: string[]) => {
  for (const k of keys) if (e?.[k] != null && e[k] !== '') return e[k];
  return null;
};

/** Man-hours of one LaborTrax entry (same reading as odoo-analytics-sync). */
export function entryManHours(e: any): number {
  let hours = num(pick(e, ['man_hours', 'hours', 'duration_hours', 'total_hours']));
  if (!hours) {
    const mins = num(pick(e, ['minutes', 'duration_minutes']));
    if (mins) hours = mins / 60;
  }
  const workers = num(pick(e, ['workers', 'num_workers', 'headcount'])) || 1;
  if (e?.man_hours == null && workers > 1 && e?.hours != null) hours *= workers;
  return hours;
}

export type LaborRates = {
  hours: number;
  burdenedPerMh: number;
  directPerMh: number;
  overheadPerMh: number;
  entryCount: number;
};

/**
 * Per-man-hour labor cost over the window. Fully burdened = direct wages +
 * allocated overhead, so the overhead share is what costing adds on top of the
 * department wages it already charges.
 */
export function laborRatesFromEntries(entries: any[], window: { from: string; to: string }): LaborRates {
  let hours = 0, direct = 0, overhead = 0, burdened = 0, entryCount = 0;
  for (const e of entries || []) {
    const date = String(pick(e, ['date', 'work_date', 'entry_date', 'end_time', 'start_time', 'created_at']) ?? '').slice(0, 10);
    if (!date || date < window.from || date > window.to) continue;
    const h = entryManHours(e);
    if (!(h > 0)) continue;
    const d = num(e.direct_labor_cost);
    const o = num(e.allocated_overhead_cost);
    const b = e.fully_burdened_cost != null ? num(e.fully_burdened_cost) : d + o;
    hours += h; direct += d; overhead += o; burdened += b; entryCount++;
  }
  const per = (x: number) => (hours > 0 ? x / hours : 0);
  return {
    hours,
    burdenedPerMh: per(burdened),
    directPerMh: per(direct),
    // Prefer burdened − direct so the two always add up to the burdened figure.
    overheadPerMh: burdened > 0 ? per(burdened - direct) : per(overhead),
    entryCount,
  };
}
