import { supabase } from '@/integrations/supabase/client';
import { computeProductPriceAndCost } from '@/lib/product-pricing';

/**
 * Live per-inquiry FOB (USD), GPM and man-hours from the costing engine — the same
 * numbers shown on each inquiry page. Used as fallbacks when an inquiry's projection
 * row has no stored FOB / man-hours.
 */
export async function liveInquiryFinancials(inquiryIds: string[]): Promise<Record<string, { fob_usd: number; gpm: number; man_hours: number }>> {
  const out: Record<string, { fob_usd: number; gpm: number; man_hours: number }> = {};
  if (!inquiryIds.length) return out;
  const products: any[] = [];
  for (let i = 0; i < inquiryIds.length; i += 40) {
    const { data } = await (supabase as any).from('products')
      .select('id, customer_rfq_id, quantity, calculated_unit_price_usd')
      .in('customer_rfq_id', inquiryIds.slice(i, i + 40)).is('archived_at', null).limit(100000);
    products.push(...(data ?? []));
  }
  const prices: Record<string, any> = {};
  const ids = products.map(p => p.id);
  for (let i = 0; i < ids.length; i += 25) Object.assign(prices, await computeProductPriceAndCost(ids.slice(i, i + 25)));
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
