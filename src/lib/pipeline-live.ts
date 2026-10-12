import { supabase } from '@/integrations/supabase/client';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { fetchAllByIds } from '@/lib/supabase-paged';

/**
 * Live per-inquiry FOB (USD), GPM and man-hours from the costing engine — the same
 * numbers shown on each inquiry page. Used as fallbacks when an inquiry's projection
 * row has no stored FOB / man-hours.
 */
export async function liveInquiryFinancials(inquiryIds: string[]): Promise<Record<string, { fob_usd: number; gpm: number; man_hours: number }>> {
  const out: Record<string, { fob_usd: number; gpm: number; man_hours: number }> = {};
  if (!inquiryIds.length) return out;
  const products = await fetchAllByIds<any>(inquiryIds, chunk => (supabase as any).from('products')
    .select('id, customer_rfq_id, quantity, calculated_unit_price_usd')
    .in('customer_rfq_id', chunk).is('archived_at', null).order('id'));
  // One engine run for every product: the data is loaded once (paged), where 25-product
  // slices used to reload each inquiry's siblings and rate tables slice after slice.
  const prices: Record<string, any> = await computeProductPriceAndCost(products.map(p => p.id));
  const cost: Record<string, number> = {};
  for (const p of products) {
    const q = Number(p.quantity) || 0;
    const c = prices[p.id];
    const unit = Number(c?.unit_price_usd > 0 ? c.unit_price_usd : p.calculated_unit_price_usd) || 0;
    const o = (out[p.customer_rfq_id] ||= { fob_usd: 0, gpm: 0, man_hours: 0 });
    o.fob_usd += unit * q;
    o.man_hours += (Number(c?.man_hours_per_unit) || 0) * q;
    cost[p.customer_rfq_id] = (cost[p.customer_rfq_id] || 0) + (Number(c?.unit_cogs_usd) || 0) * q;
  }
  for (const [id, o] of Object.entries(out)) o.gpm = o.fob_usd > 0 ? (o.fob_usd - (cost[id] || 0)) / o.fob_usd : 0;
  return out;
}
