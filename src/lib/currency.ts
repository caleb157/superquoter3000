// Canonical multi-currency math + formatting.
// All display/conversion sites should route through this module.
//
// Conventions:
//   - `units_per_inr_base` lets us store rates for high-volume currencies like
//     JPY/KRW as "INR per 100 yen" without losing precision. So
//     inr_per_one_unit = row.import_rate / row.units_per_inr_base.
//   - `import` rate = DKT receives this currency (customer pays us). Default for
//     customer-facing quotes.
//   - `export` rate = DKT pays out this currency (paying a foreign vendor).
//   - INR is the base; always returns 1.
import { supabase } from '@/integrations/supabase/client';

export type CurrencyRow = {
  code: string;
  name: string;
  symbol: string | null;
  units_per_inr_base: number;
  import_rate: number | null;
  export_rate: number | null;
  is_featured: boolean;
  sort_priority: number;
};

export type CurrencyMap = Record<string, CurrencyRow>;

let cache: CurrencyMap | null = null;
let inflight: Promise<CurrencyMap> | null = null;
const subs = new Set<(m: CurrencyMap) => void>();

export async function loadCurrencyMap(force = false): Promise<CurrencyMap> {
  if (!force && cache) return cache;
  if (!force && inflight) return inflight;
  inflight = (async () => {
    const { data } = await (supabase as any).from('currencies').select('*');
    const map: CurrencyMap = {};
    (data ?? []).forEach((c: any) => {
      map[c.code] = {
        code: c.code,
        name: c.name,
        symbol: c.symbol ?? null,
        units_per_inr_base: Number(c.units_per_inr_base ?? 1) || 1,
        import_rate: c.import_rate == null ? null : Number(c.import_rate),
        export_rate: c.export_rate == null ? null : Number(c.export_rate),
        is_featured: !!c.is_featured,
        sort_priority: Number(c.sort_priority ?? 100),
      };
    });
    cache = map;
    inflight = null;
    subs.forEach(fn => fn(map));
    return map;
  })();
  return inflight;
}

export function invalidateCurrencyCache() {
  cache = null;
  // Re-prime so synchronous consumers using the cached map pick up new data soon.
  loadCurrencyMap(true);
}

export function getCachedCurrencyMap(): CurrencyMap | null {
  return cache;
}

export function subscribeCurrencyMap(fn: (m: CurrencyMap) => void): () => void {
  subs.add(fn);
  return () => { subs.delete(fn); };
}

/**
 * INR per one unit of the given currency code, for the requested rate direction.
 * Returns 1 for INR. Returns NaN if the currency or its rate is missing.
 */
export function inrPerUnit(
  map: CurrencyMap | null | undefined,
  code: string,
  direction: 'import' | 'export' = 'import',
): number {
  if (!code || code === 'INR') return 1;
  const row = map?.[code];
  if (!row) return NaN;
  const rate = direction === 'import' ? row.import_rate : row.export_rate;
  if (rate == null || rate === 0) return NaN;
  const baseUnits = row.units_per_inr_base || 1;
  return rate / baseUnits;
}

/** Convert INR amount to the given currency. */
export function convertFromInr(
  map: CurrencyMap | null | undefined,
  amountInr: number,
  toCode: string,
  direction: 'import' | 'export' = 'import',
): number {
  if (!toCode || toCode === 'INR') return amountInr;
  const r = inrPerUnit(map, toCode, direction);
  if (!isFinite(r) || r === 0) return 0;
  return amountInr / r;
}

/** Convert a foreign currency amount to INR. */
export function convertToInr(
  map: CurrencyMap | null | undefined,
  amount: number,
  fromCode: string,
  direction: 'import' | 'export' = 'import',
): number {
  if (!fromCode || fromCode === 'INR') return amount;
  const r = inrPerUnit(map, fromCode, direction);
  if (!isFinite(r)) return 0;
  return amount * r;
}

/** Whether the given currency has a usable import rate configured. */
export function hasImportRate(map: CurrencyMap | null | undefined, code: string): boolean {
  if (!code || code === 'INR') return true;
  return isFinite(inrPerUnit(map, code, 'import'));
}

/**
 * Format an amount with the currency's symbol (or "CODE " prefix if no symbol).
 * Indian numbering grouping for INR; en-US grouping for everything else.
 */
export function formatCurrency(
  amount: number | null | undefined,
  code: string,
  map?: CurrencyMap | null,
  decimals?: number,
): string {
  const raw = (amount == null || !isFinite(Number(amount))) ? 0 : Number(amount);
  const row = map?.[code];
  const symbol = row?.symbol || (code ? code + ' ' : '');
  const decs = decimals ?? 2;
  const locale = code === 'INR' ? 'en-IN' : 'en-US';
  return `${symbol}${raw.toLocaleString(locale, { minimumFractionDigits: decs, maximumFractionDigits: decs })}`;
}

/** Sync variant for hot paths. Falls back to bare CODE prefix if map not primed. */
export function formatCurrencySync(amount: number, code: string, map: CurrencyMap | null): string {
  return formatCurrency(amount, code, map ?? undefined);
}

/**
 * Pick the right unit price for a display currency from a product-pricing entry.
 * Uses the denormalized USD price when targeting USD; otherwise converts from INR.
 */
export function unitPriceInCurrency(
  entry: { unit_price_inr?: number | null; unit_price_usd?: number | null } | null | undefined,
  code: string,
  map: CurrencyMap | null,
): number {
  if (!entry) return 0;
  if (code === 'INR') return Number(entry.unit_price_inr) || 0;
  if (code === 'USD') return Number(entry.unit_price_usd) || 0;
  return convertFromInr(map, Number(entry.unit_price_inr) || 0, code, 'import');
}
