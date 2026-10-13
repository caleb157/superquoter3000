// One live costing run per inquiry, shared by the inquiry page's cards and tabs.
//
// The header cards, FOB card, Products tab and Projection tab all need the same engine
// numbers. Each caller notes when it started loading (`since`) and reuses a run that
// began at or after that moment, so cards mounting together share one run, while a
// reload after an edit (a later `since`) never picks up numbers from before the edit.
import { supabase } from '@/integrations/supabase/client';
import { computeProductPriceAndCost, type ProductPriceCostMap } from '@/lib/product-pricing';
import { fetchAllRows } from '@/lib/supabase-paged';

type Run = { startedAt: number; promise: Promise<ProductPriceCostMap> };
const runs = new Map<string, Run>();

/** Live prices for every product of the inquiry, archived ones included. */
export function computeInquiryPriceAndCost(inquiryId: string, since: number): Promise<ProductPriceCostMap> {
  const run = runs.get(inquiryId);
  if (run && run.startedAt >= since) return run.promise;
  const startedAt = Date.now();
  const promise = (async () => {
    const rows = await fetchAllRows<{ id: string }>(() =>
      supabase.from('products').select('id').eq('customer_rfq_id', inquiryId).order('id'));
    return computeProductPriceAndCost(rows.map((r) => r.id));
  })();
  runs.set(inquiryId, { startedAt, promise });
  promise.catch(() => { if (runs.get(inquiryId)?.promise === promise) runs.delete(inquiryId); });
  return promise;
}

export function resetInquiryPricing(): void {
  runs.clear();
}
