// Repeat orders: a new inquiry started from products of past inquiries ("Repeat of…" in Create
// inquiry). Products are cloned with their raw costing inputs and recosted through the engine, so
// the repeat is priced at today's rates rather than the old quote's. The inquiry links to the one it
// repeats (customer_rfqs.repeat_of_inquiry_id) and is flagged inquiry_projections.repeat_order,
// which starts it at the repeat certainty (Settings → Projections).
import { cloneAssembliesForProducts, cloneProductToInquiry } from '@/lib/product-clone';
import { recostInquiry } from '@/lib/costing-seed';

export type RepeatPick = { productId: string; inquiryId: string | null };

/** The inquiry being repeated: the one most picked products come from (first picked wins a tie). */
export function repeatSourceInquiry(picks: RepeatPick[]): string | null {
  const counts = new Map<string, number>();
  for (const p of picks) if (p.inquiryId) counts.set(p.inquiryId, (counts.get(p.inquiryId) ?? 0) + 1);
  let best: string | null = null;
  for (const [id, n] of counts) if (best == null || n > counts.get(best)!) best = id;
  return best;
}

/** Clones the picked products (and assemblies built from them) into the new inquiry, then recosts it. */
export async function copyRepeatProducts(targetInquiryId: string, productIds: string[]): Promise<{ copied: number; failed: number }> {
  const idMap: Record<string, string> = {};
  for (const id of productIds) {
    const newId = await cloneProductToInquiry(id, targetInquiryId);
    if (newId) idMap[id] = newId;
  }
  const copied = Object.keys(idMap);
  await cloneAssembliesForProducts(copied, targetInquiryId, idMap);
  await recostInquiry(targetInquiryId);
  return { copied: copied.length, failed: productIds.length - copied.length };
}
