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

/** The last `days` full days before `today` (YYYY-MM-DD, end inclusive). */
export function recentDaysWindow(today: string, days = 21): { from: string; to: string } {
  const d = new Date(today.slice(0, 10) + 'T00:00:00Z');
  const to = new Date(d.getTime() - 86400000);
  const from = new Date(d.getTime() - days * 86400000);
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

export type CategoryRate = { category: string; laborType: string | null; hours: number; directPerMh: number };

export type LaborRates = {
  hours: number;
  burdenedPerMh: number;
  directPerMh: number;
  overheadPerMh: number;
  entryCount: number;
  /** Direct wages per man-hour for each HQ labor type LaborTrax has hours for. */
  directByType: Record<string, number>;
  /** Every LaborTrax work-order category seen, with the HQ labor type it fed (null = unmatched). */
  categories: CategoryRate[];
};

/**
 * HQ labor type for a LaborTrax work-order category: the first type whose name
 * appears in the category (case-insensitive), e.g. "Finishing - Polish" → Finishing.
 */
export function laborTypeForCategory(category: string, laborTypes: string[]): string | null {
  const c = (category || '').toLowerCase();
  if (!c) return null;
  return laborTypes.find(t => c.includes(t.toLowerCase())) ?? null;
}

/**
 * Per-man-hour labor cost over the window: the fully burdened rate (what HQ
 * charges as indirect overhead per man-hour) plus direct wages per HQ labor type.
 */
export function laborRatesFromEntries(
  entries: any[],
  window: { from: string; to: string },
  laborTypes: string[] = [],
): LaborRates {
  let hours = 0, direct = 0, overhead = 0, burdened = 0, entryCount = 0;
  const byCat = new Map<string, { hours: number; direct: number }>();
  for (const e of entries || []) {
    const date = String(pick(e, ['date', 'work_date', 'entry_date', 'end_time', 'start_time', 'created_at']) ?? '').slice(0, 10);
    if (!date || date < window.from || date > window.to) continue;
    const h = entryManHours(e);
    if (!(h > 0)) continue;
    const d = num(e.direct_labor_cost);
    const o = num(e.allocated_overhead_cost);
    const b = e.fully_burdened_cost != null ? num(e.fully_burdened_cost) : d + o;
    hours += h; direct += d; overhead += o; burdened += b; entryCount++;
    const cat = String(pick(e, ['work_order_category', 'work_order', 'work_order_name', 'work_center', 'category']) ?? '').trim();
    if (cat) {
      const g = byCat.get(cat) ?? { hours: 0, direct: 0 };
      g.hours += h; g.direct += d;
      byCat.set(cat, g);
    }
  }
  const per = (x: number) => (hours > 0 ? x / hours : 0);

  const typeTotals = new Map<string, { hours: number; direct: number }>();
  const categories: CategoryRate[] = [...byCat.entries()]
    .map(([category, g]) => {
      const laborType = laborTypeForCategory(category, laborTypes);
      if (laborType && g.direct > 0) {
        const t = typeTotals.get(laborType) ?? { hours: 0, direct: 0 };
        t.hours += g.hours; t.direct += g.direct;
        typeTotals.set(laborType, t);
      }
      return { category, laborType, hours: g.hours, directPerMh: g.hours > 0 ? g.direct / g.hours : 0 };
    })
    .sort((a, b) => b.hours - a.hours);
  const directByType: Record<string, number> = {};
  for (const [t, g] of typeTotals) if (g.hours > 0) directByType[t] = g.direct / g.hours;

  return {
    hours,
    burdenedPerMh: per(burdened),
    directPerMh: per(direct),
    // Prefer burdened − direct so the two always add up to the burdened figure.
    overheadPerMh: burdened > 0 ? per(burdened - direct) : per(overhead),
    entryCount,
    directByType,
    categories,
  };
}

export type OdooCurrency = { code: string; name: string | null; symbol: string | null; inrPerUnit: number };
export type CurrencyRow = { code: string; units_per_inr_base: number | null; import_rate: number | null; symbol?: string | null };

/**
 * How the currencies table follows Odoo: every currency active in Odoo gets its name and
 * rate (scaled by units_per_inr_base) and is added if missing. A symbol already set is kept,
 * because Odoo writes "$" for USD, AUD and CAD alike and quotes need them told apart. A currency Odoo
 * no longer has active loses its rate, which hides it from pickers without deleting it
 * (old quotes keep their own frozen rate). INR is the base and is never touched.
 */
export function planCurrencySync(existing: CurrencyRow[], odoo: OdooCurrency[], today: string) {
  const have = new Map(existing.map(c => [c.code.toUpperCase(), c]));
  const live = new Set<string>();
  const updates: { code: string; patch: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];
  for (const o of odoo) {
    const code = o.code.toUpperCase();
    if (code === 'INR' || !(o.inrPerUnit > 0)) continue;
    live.add(code);
    const row = have.get(code);
    const units = Number(row?.units_per_inr_base) || 1;
    const rate = +(o.inrPerUnit * units).toFixed(4);
    const fromOdoo: Record<string, unknown> = { import_rate: rate, export_rate: rate, effective_start_date: today };
    if (o.name) fromOdoo.name = o.name;
    if (o.symbol && !row?.symbol) fromOdoo.symbol = o.symbol;
    if (row) updates.push({ code: row.code, patch: fromOdoo });
    else inserts.push({ code, name: o.name || code, symbol: o.symbol || null, units_per_inr_base: 1, sort_priority: 100, is_featured: false, ...fromOdoo });
  }
  for (const c of existing) {
    const code = c.code.toUpperCase();
    if (code === 'INR' || live.has(code) || c.import_rate == null) continue;
    updates.push({ code: c.code, patch: { import_rate: null, export_rate: null } });
  }
  return { updates, inserts };
}
