import { productWeight } from '@/lib/pipeline-weights';

export type InquiryProjection = {
  inquiry_id: string;
  selling_entity_id: string | null;
  producing_entity_id: string | null;
  repeat_order: boolean;
  shipping_method: 'air' | 'sea' | 'ground' | null;
  paying_shipping: boolean;
  duration_months: number | null;
  projected_fob_revenue_usd: number | null;
  project_gpm: number | null;
  certainty_override: number | null;
  estimated_man_hours: number | null;
  selling_retention_pct: number | null;  // fraction (0..1) that selling entity keeps; producing receives (1 - this) × FOB
  start_month: string | null;
  shipping_month: string | null;
  delivery_month: string | null;
  committed_days: number | null;
  actual_po_date: string | null;
  actual_ready_date: string | null;
  cust_deposit_pct: number | null;
  cust_deposit_month: string | null;
  cust_final_pct: number | null;
  cust_final_month: string | null;
  cust_other_pct: number | null;
  cust_other_month: string | null;
  ie_deposit_pct: number | null;
  ie_deposit_month: string | null;
  ie_balance_pct: number | null;
  ie_balance_month: string | null;
  vendor_deposit_pct: number | null;
  vendor_deposit_month: string | null;
  vendor_balance_pct: number | null;
  vendor_balance_month: string | null;
  notes: string | null;
};

export function effectiveCertainty(
  projection: Pick<InquiryProjection, 'certainty_override'> | null,
  products: Array<{ design_stage: string | null; quote_stage: string | null; sample_stage: string | null }>,
  inquiryStatus: string,
): number {
  if (projection?.certainty_override != null) return Number(projection.certainty_override);
  if (inquiryStatus === 'po' || inquiryStatus === 'complete') return 1.0;
  if (inquiryStatus === 'cancelled' || inquiryStatus === 'paused') return 0;
  if (inquiryStatus === 'projected_po') {
    // Default certainty for projected POs is 0.5 — conservative middle ground.
    // User can override per-inquiry via certainty_override.
    return 0.5;
  }
  if (products.length === 0) return 0;
  const total = products.reduce((acc, p) => acc + productWeight(p as any, inquiryStatus), 0);
  return total / products.length;
}

/**
 * Weighted projected revenue = effective FOB × certainty.
 * Pass the *effective* FOB (live for non-PO, stored for PO/complete) — see
 * `effectiveFobUsd` in `inquiry-financials.ts`.
 */
export function weightedProjectedRevenue(
  effectiveFobUsd: number,
  certainty: number,
): number {
  return (effectiveFobUsd || 0) * (certainty || 0);
}

/** Projected gross profit (unweighted) = effective FOB × effective GPM. */
export function projectedGrossProfit(
  effectiveFobUsd: number,
  effectiveGpm: number,
): number {
  return (effectiveFobUsd || 0) * (effectiveGpm || 0);
}

export function weightedProjectedGrossProfit(
  effectiveFobUsd: number,
  effectiveGpm: number,
  certainty: number,
): number {
  return projectedGrossProfit(effectiveFobUsd, effectiveGpm) * (certainty || 0);
}

export type ProductMhAggregate = { product_id: string; quantity: number; total_mh_per_unit: number };

export function effectiveManHours(
  projection: Pick<InquiryProjection, 'estimated_man_hours'> | null,
  products: ProductMhAggregate[],
): number {
  if (projection?.estimated_man_hours != null) return Number(projection.estimated_man_hours);
  return products.reduce((acc, p) => acc + (p.quantity || 0) * (p.total_mh_per_unit || 0), 0);
}

export function suggestDefaultMonths(shippingMethod: string | null = 'sea'): {
  start_month: string;
  shipping_month: string;
  delivery_month: string;
} {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const shippingMonths = shippingMethod === 'air' ? 2 : shippingMethod === 'ground' ? 3 : 3;
  const deliveryMonths = shippingMethod === 'air' ? 2 : shippingMethod === 'ground' ? 4 : 4;
  const shipping = new Date(start.getFullYear(), start.getMonth() + shippingMonths, 1);
  const delivery = new Date(start.getFullYear(), start.getMonth() + deliveryMonths, 1);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  return { start_month: iso(start), shipping_month: iso(shipping), delivery_month: iso(delivery) };
}

/** Convert "YYYY-MM" from <input type="month"> to "YYYY-MM-01" date string. */
export function monthInputToDate(m: string | null | undefined): string | null {
  if (!m) return null;
  if (/^\d{4}-\d{2}$/.test(m)) return `${m}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(m)) return m;
  return null;
}

/** Convert "YYYY-MM-DD" date to "YYYY-MM" for <input type="month"> display. */
export function dateToMonthInput(d: string | null | undefined): string {
  if (!d) return '';
  return d.slice(0, 7);
}

// ---------- Shipping estimator (pass-through) ----------

/**
 * Shipping is a pass-through: revenue = cost, net-zero margin.
 * Estimated as a % of FOB by method.
 */
export const SHIPPING_PCT_OF_FOB: Record<string, number> = {
  sea: 0.20,
  air: 1.00,
  ground: 0,
};

export function shippingEstimateUsd(
  payingShipping: boolean,
  method: string | null | undefined,
  fobUsd: number,
): { revenue: number; cost: number; pct: number } {
  if (!payingShipping || !method) return { revenue: 0, cost: 0, pct: 0 };
  const pct = SHIPPING_PCT_OF_FOB[method] ?? 0;
  const amt = (fobUsd || 0) * pct;
  return { revenue: amt, cost: amt, pct };
}

/** Default duration (months) from start (deposit) to shipping, by ship method. */
export function defaultDurationMonths(method: string | null | undefined): number {
  if (method === 'air') return 2;
  if (method === 'ground') return 4;
  return 3; // sea or unset
}

/** Add N months to a 'YYYY-MM-DD' first-of-month date, returning first-of-month YYYY-MM-DD. */
export function addMonths(monthStr: string, n: number): string {
  const d = new Date(monthStr);
  const r = new Date(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
  return `${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Derive all schedule months from start (deposit) month + duration.
 * shipping = start + duration. Deposits at start; balances/finals at shipping.
 */
export function deriveScheduleMonths(
  startMonth: string | null | undefined,
  durationMonths: number | null | undefined,
) {
  if (!startMonth || !durationMonths || durationMonths < 0) return null;
  const shipping = addMonths(startMonth, durationMonths);
  return {
    shipping_month: shipping,
    delivery_month: shipping,
    cust_deposit_month: startMonth,
    cust_final_month: shipping,
    ie_deposit_month: startMonth,
    ie_balance_month: shipping,
    vendor_deposit_month: startMonth,
    vendor_balance_month: shipping,
  };
}

/** Same-month check on two ISO date strings (compares YYYY-MM prefix). */
export function sameMonth(a: string | null | undefined, b: Date): boolean {
  if (!a) return false;
  const ym = `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, '0')}`;
  return String(a).slice(0, 7) === ym;
}

/**
 * Spread total man-hours evenly across (start_month + 1) .. (start_month + duration_months),
 * inclusive. The deposit month itself gets zero hours.
 */
export function spreadManHours(
  totalMh: number,
  startMonth: string | null | undefined,
  durationMonths: number | null | undefined,
): Array<{ month: string; mh: number }> {
  if (!startMonth || !durationMonths || durationMonths < 1 || !(totalMh > 0)) return [];
  const perMonth = totalMh / durationMonths;
  const out: Array<{ month: string; mh: number }> = [];
  for (let i = 1; i <= durationMonths; i++) {
    out.push({ month: addMonths(startMonth, i), mh: perMonth });
  }
  return out;
}
