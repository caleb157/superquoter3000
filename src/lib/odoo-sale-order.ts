// "Create SO" on the inquiry Odoo page: builds a draft Odoo quotation from final products
// already in Odoo. Price = inquiry sale price (quote currency); discount = the Projections tab's
// Selling entity retention %, so there is one place to change it.
import { supabase } from '@/integrations/supabase/client';

export type SoRowInput = { productId: string; name: string; sku: string; odooId: number | null; qty: number; price: number | null };
export type SoLine = SoRowInput & { ready: boolean; problem: string | null; discountPct: number; lineTotal: number };

/** Retention is a fraction 0..1 (as stored); Odoo discount is a percent. */
export function soLines(rows: SoRowInput[], retention: number | null | undefined): SoLine[] {
  const discountPct = Math.round((Number(retention) || 0) * 10000) / 100;
  return rows.map(r => {
    const problem = !r.odooId ? 'Not created in Odoo yet' : !(r.qty > 0) ? 'Quantity is 0' : r.price == null || !(r.price > 0) ? 'No sale price' : null;
    const lineTotal = problem ? 0 : Math.round(r.qty * (r.price as number) * (1 - discountPct / 100) * 100) / 100;
    return { ...r, ready: !problem, problem, discountPct, lineTotal };
  });
}

export type OdooPricelist = { id: number; name: string; currency: string };
/** Pricelist matching the inquiry's quote currency (e.g. USD -> USD Export Pricelist). */
export function pricelistFor(list: OdooPricelist[], currency: string): number | null {
  return list.find(p => p.currency.toUpperCase() === currency.toUpperCase())?.id ?? null;
}

/**
 * Exchange rate between the inquiry currency and the pricelist currency, written the readable way
 * round: "1 <big> = rate <small>" (e.g. 1 USD = 93.65 INR). Null when no conversion is needed.
 */
export type SoRate = { big: string; small: string; rate: number };
export function defaultSoRate(from: string, to: string, companyPerUnit: Record<string, number>): SoRate | null {
  const f = from.toUpperCase(), t = to.toUpperCase();
  if (!f || !t || f === t) return null;
  const pf = companyPerUnit[f], pt = companyPerUnit[t];
  if (!(pf > 0) || !(pt > 0)) return null;
  return pf >= pt ? { big: f, small: t, rate: +(pf / pt).toFixed(4) } : { big: t, small: f, rate: +(pt / pf).toFixed(4) };
}
/** Inquiry price -> pricelist price (2 decimals, what goes to Odoo). */
export function convertSoPrice(price: number, from: string, r: SoRate | null): number {
  if (!r || !(r.rate > 0)) return Math.round(price * 100) / 100;
  const v = from.toUpperCase() === r.big ? price * r.rate : price / r.rate;
  return Math.round(v * 100) / 100;
}

async function call<T>(body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke('odoo-sale-order', { body });
  if (error) {
    let msg = error.message || 'Odoo request failed';
    try { const d = await (error as { context?: Response }).context?.json(); msg = d?.error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data as T;
}

export const soMeta = () => call<{ pricelists: OdooPricelist[]; paymentTerms: { id: number; name: string }[]; companyPerUnit: Record<string, number> }>({ action: 'meta' });
export const soCustomers = (search: string) => call<{ customers: { id: number; name: string; pricelistId: number | null }[] }>({ action: 'customers', search });
export const createSo = (p: { partnerId: number; pricelistId: number | null; paymentTermId: number | null; commitmentDate: string | null; lines: { productId: number; qty: number; priceUnit: number; discount: number }[] }) =>
  call<{ id: number; name: string; amountTotal: number; currency: string; url: string }>({ action: 'create', ...p });
