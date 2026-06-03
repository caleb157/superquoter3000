import type { ProductPriceCostMap } from '@/lib/product-pricing';

export type InquiryFinancials = {
  fobRevenueUsd: number;
  totalCostUsd: number;
  grossProfitUsd: number;
  gpm: number; // 0..1
};

/**
 * Live financials from the unified costing engine's price map across an inquiry's products.
 * Revenue uses unit_price_usd (FOB price, includes markup); cost uses unit_cogs_usd
 * (COGS only — matches the "true GPM" definition used elsewhere).
 */
export function computeInquiryFinancials(
  products: Array<{ id: string; quantity: number | null }>,
  priceMap: ProductPriceCostMap,
): InquiryFinancials {
  let rev = 0;
  let cost = 0;
  for (const p of products) {
    const lp = priceMap[p.id];
    if (!lp) continue;
    const qty = Number(p.quantity || 0);
    rev += (lp.unit_price_usd || 0) * qty;
    cost += (lp.unit_cogs_usd || 0) * qty;
  }
  const grossProfitUsd = rev - cost;
  const gpm = rev > 0 ? grossProfitUsd / rev : 0;
  return { fobRevenueUsd: rev, totalCostUsd: cost, grossProfitUsd, gpm };
}

/**
 * True when the projection's stored FOB/GPM are authoritative.
 * - po/complete: locked because the order is real
 * - projected_po: speculative future order, often has no products yet, so FOB/GPM are manual
 */
export function projectionIsLocked(status: string | null | undefined): boolean {
  return status === 'po' || status === 'complete' || status === 'projected_po';
}

/** FOB used everywhere: stored (locked) value when PO/complete and present, else live. */
export function effectiveFobUsd(
  projection: { projected_fob_revenue_usd: number | null } | null | undefined,
  status: string | null | undefined,
  liveFobUsd: number,
): number {
  if (
    projectionIsLocked(status) &&
    projection?.projected_fob_revenue_usd != null
  ) {
    return Number(projection.projected_fob_revenue_usd);
  }
  return liveFobUsd;
}

/** GPM used everywhere: stored (locked) value when PO/complete and present, else live. */
export function effectiveGpm(
  projection: { project_gpm: number | null } | null | undefined,
  status: string | null | undefined,
  liveGpm: number,
): number {
  if (projectionIsLocked(status) && projection?.project_gpm != null) {
    return Number(projection.project_gpm);
  }
  return liveGpm;
}
