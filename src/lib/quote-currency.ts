// The currency an inquiry is priced in: rupees when the customer pays in INR, else USD.
// It is the inquiry's own "Quoting currency" (Settings tab), the same field one-click
// quotes use, so the costing workspace, inquiry totals and the quote PDF always agree.
//
// Target prices: an INR customer's target is kept in rupees (products.target_price_inr) so
// a moving exchange rate never shifts it; target_price_usd is kept alongside at today's
// rate for the places that only read USD.

export type QuoteCur = 'USD' | 'INR';

export function quoteCurrencyOf(inq: { quoting_currency?: string | null } | null | undefined): QuoteCur {
  return inq?.quoting_currency === 'INR' ? 'INR' : 'USD';
}

type TargetFields = { target_price_usd?: number | null; target_price_inr?: number | null } | null | undefined;

const pos = (v: unknown) => (Number(v) > 0 ? Number(v) : null);

/** Per-unit target in the quote currency; falls back to the other column at `fx` (INR per USD). */
export function readTarget(p: TargetFields, cur: QuoteCur, fx: number): number | null {
  const usd = pos(p?.target_price_usd);
  const inr = pos(p?.target_price_inr);
  if (cur === 'INR') return inr ?? (usd != null && fx > 0 ? usd * fx : null);
  return usd ?? (inr != null && fx > 0 ? inr / fx : null);
}

/** Product patch that stores `value` (quote currency, null = no target). */
export function targetPatch(p: TargetFields, cur: QuoteCur, value: number | null, fx: number): Record<string, number | null> {
  if (value == null) return 'target_price_inr' in (p ?? {}) ? { target_price_usd: null, target_price_inr: null } : { target_price_usd: null };
  if (cur === 'INR') {
    return { target_price_inr: value, target_price_usd: fx > 0 ? Math.round((value / fx) * 10000) / 10000 : null };
  }
  // A USD target replaces any stale rupee one (only once the column exists, so this works before the SQL is run).
  return 'target_price_inr' in (p ?? {}) ? { target_price_usd: value, target_price_inr: null } : { target_price_usd: value };
}

/** "$1,234.50" or "₹1,23,450" (Indian grouping). */
export function formatMoney(n: number | null | undefined, cur: QuoteCur, decimals = cur === 'INR' ? 0 : 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const opts = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  return cur === 'INR'
    ? `${sign}₹${Math.abs(n).toLocaleString('en-IN', opts)}`
    : `${sign}$${Math.abs(n).toLocaleString('en-US', opts)}`;
}

export const currencySymbol = (cur: QuoteCur) => (cur === 'INR' ? '₹' : '$');
