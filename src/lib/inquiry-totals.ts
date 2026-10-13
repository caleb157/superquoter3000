// One calculation for an inquiry's order value, profit, CBM and man-hours, shared by the
// Inquiries list and the inquiry page so the two can never disagree.
//
// Rules: archived products are left out; every live product counts (components too, as on
// the inquiry page and in Master Analytics); unit price and cost come from the live costing
// engine (computeProductPriceAndCost), falling back to the stored price cache only when the
// engine produced nothing for a product.
import { supabase } from '@/integrations/supabase/client';
import { computeProductPriceAndCost, type ProductPriceCostMap } from '@/lib/product-pricing';
import { fetchAllByIds } from '@/lib/supabase-paged';
import { mhChanged, saveStoredMh, withStoredMh } from '@/lib/stored-man-hours';

export type InquiryTotals = {
  revenueUsd: number;
  costUsd: number;
  profitUsd: number;
  /** The same in rupees, for inquiries quoted in INR: engine rupees, no exchange round trip.
   *  Null until the live run has a rate for any product still on its saved USD price. */
  revenueInr: number | null;
  profitInr: number | null;
  /** profit ÷ revenue, 0..1 (0 when there is no revenue). */
  margin: number;
  cbm: number;
  manHours: number;
  productCount: number;
};

export type TotalsProduct = {
  id: string;
  customer_rfq_id?: string | null;
  quantity: number | null;
  archived_at?: string | null;
  calculated_unit_price_usd?: number | null;
  calculated_unit_cost_usd?: number | null;
  calculated_man_hours_per_unit?: number | null;
};

/**
 * Pure sum over one inquiry's products and a live price map. Products the map lacks use
 * their saved price, cost and man-hours, so `sumInquiryTotals(products, {})` gives the
 * saved totals the Inquiries list shows before the live run finishes (CBM is live only).
 */
export function sumInquiryTotals(products: TotalsProduct[], priceMap: ProductPriceCostMap): InquiryTotals {
  let revenueUsd = 0, costUsd = 0, cbm = 0, manHours = 0, productCount = 0;
  let revenueInr = 0, costInr = 0, inrKnown = true;
  const anyFx = Object.values(priceMap).find(e => Number(e?.exchange_rate) > 0)?.exchange_rate ?? 0;
  for (const p of products) {
    if (p.archived_at) continue;
    productCount++;
    const qty = Number(p.quantity) || 0;
    const live = priceMap[p.id];
    const price = live && live.unit_price_usd > 0 ? live.unit_price_usd : Number(p.calculated_unit_price_usd) || 0;
    const cost = live && live.unit_cost_usd > 0 ? live.unit_cost_usd : Number(p.calculated_unit_cost_usd) || 0;
    revenueUsd += price * qty;
    costUsd += cost * qty;
    if (live && live.unit_price_usd > 0 && Number(live.unit_price_inr) > 0) {
      revenueInr += live.unit_price_inr * qty;
      costInr += (Number(live.unit_cost_inr) || cost * (live.exchange_rate || anyFx)) * qty;
    } else if ((price || cost) && qty) {
      if (anyFx > 0) { revenueInr += price * anyFx * qty; costInr += cost * anyFx * qty; } else inrKnown = false;
    }
    cbm += (Number(live?.final_unit_cbm) || 0) * qty;
    const mh = live ? Number(live.man_hours_per_unit) || 0 : Number(p.calculated_man_hours_per_unit) || 0;
    manHours += mh * qty;
  }
  const profitUsd = revenueUsd - costUsd;
  return {
    revenueUsd, costUsd, profitUsd,
    revenueInr: inrKnown ? revenueInr : null, profitInr: inrKnown ? revenueInr - costInr : null,
    margin: revenueUsd > 0 ? profitUsd / revenueUsd : 0, cbm, manHours, productCount,
  };
}

/** Live totals for many inquiries in one engine run (shipping pools stay per inquiry). */
export async function loadInquiryTotals(inquiryIds: string[]): Promise<Record<string, InquiryTotals>> {
  const out: Record<string, InquiryTotals> = {};
  if (inquiryIds.length === 0) return out;
  const products = await withStoredMh('id, customer_rfq_id, quantity, archived_at, calculated_unit_price_usd, calculated_unit_cost_usd',
    (cols) => fetchAllByIds<TotalsProduct>(inquiryIds, (chunk) =>
      (supabase as any).from('products').select(cols)
        .in('customer_rfq_id', chunk).is('archived_at', null).order('id')));
  const priceMap = await computeProductPriceAndCost(products.map(p => p.id));
  const byInquiry: Record<string, TotalsProduct[]> = {};
  for (const p of products) if (p.customer_rfq_id) (byInquiry[p.customer_rfq_id] ||= []).push(p);
  for (const id of inquiryIds) out[id] = sumInquiryTotals(byInquiry[id] ?? [], priceMap);
  // Keep the saved man-hours in step with the live engine (in the background).
  const drifted = products
    .filter(p => priceMap[p.id] && mhChanged(p.calculated_man_hours_per_unit, priceMap[p.id].man_hours_per_unit))
    .map(p => ({ id: p.id, manHours: priceMap[p.id].man_hours_per_unit }));
  if (drifted.length) void saveStoredMh(drifted).catch(() => {});
  return out;
}
