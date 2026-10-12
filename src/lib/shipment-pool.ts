// Inquiry shipment pools for FOB pricing (see costing-engine shipmentPool).
import { supabase } from '@/integrations/supabase/client';
import type { ShipmentPool } from '@/lib/costing-engine';
import { fetchAllByIds } from '@/lib/supabase-paged';

const cache = new Map<string, ShipmentPool>();

export function invalidateShipmentPool(inquiryId?: string | null) {
  if (inquiryId) cache.delete(inquiryId); else cache.clear();
}

export async function buildShipmentPools(inquiryIds: string[]): Promise<Record<string, ShipmentPool>> {
  const out: Record<string, ShipmentPool> = {};
  const missing = inquiryIds.filter(id => !cache.has(id));
  if (missing.length) {
    const { computeCoreFirstPass } = await import('@/lib/product-pricing');
    const data = await fetchAllByIds<any>(missing, chunk => supabase.from('products').select('id').in('customer_rfq_id', chunk).is('archived_at', null).order('id'));
    const pools = await computeCoreFirstPass(data.map((p: any) => p.id));
    for (const id of missing) cache.set(id, pools[id] || { lines: [] });
  }
  for (const id of inquiryIds) out[id] = cache.get(id)!;
  return out;
}
