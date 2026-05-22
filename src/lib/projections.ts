import { productWeight } from '@/lib/pipeline-weights';

export type InquiryProjection = {
  inquiry_id: string;
  selling_entity_id: string | null;
  producing_entity_id: string | null;
  repeat_order: boolean;
  shipping_method: 'air' | 'sea' | 'ground' | null;
  projected_fob_revenue_usd: number | null;
  project_gpm: number | null;
  certainty_override: number | null;
  estimated_man_hours: number | null;
  inter_entity_markup_pct: number | null;
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
  if (products.length === 0) return 0;
  const total = products.reduce((acc, p) => acc + productWeight(p as any, inquiryStatus), 0);
  return total / products.length;
}

export function weightedProjectedRevenue(
  projection: Pick<InquiryProjection, 'projected_fob_revenue_usd'> | null,
  certainty: number,
): number {
  if (!projection?.projected_fob_revenue_usd) return 0;
  return Number(projection.projected_fob_revenue_usd) * certainty;
}

export function projectedGrossProfit(
  projection: Pick<InquiryProjection, 'projected_fob_revenue_usd' | 'project_gpm'> | null,
): number {
  if (!projection?.projected_fob_revenue_usd || !projection?.project_gpm) return 0;
  return Number(projection.projected_fob_revenue_usd) * Number(projection.project_gpm);
}

export function weightedProjectedGrossProfit(
  projection: Pick<InquiryProjection, 'projected_fob_revenue_usd' | 'project_gpm'> | null,
  certainty: number,
): number {
  return projectedGrossProfit(projection) * certainty;
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
