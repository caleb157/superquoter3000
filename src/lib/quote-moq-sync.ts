// Quotes keep a copy of each line's MOQ (quote_snapshots.products[].moq / hard_moq), so the
// share link and PDF stay stable. When an SKU's MOQ changes on the inquiry, every quote of that
// inquiry follows it, except quotes the customer has already accepted: those keep the MOQ they
// agreed to.
import { supabase } from '@/integrations/supabase/client';
import { fetchAllByIds } from '@/lib/supabase-paged';

const db = supabase as any;

export type MoqPair = { moq: number | null; hard_moq: number | null };
export type MoqSource = 'product' | 'assembly';

/** Quotes in these statuses keep the MOQ the customer accepted. */
export const MOQ_FROZEN_STATUSES = ['accepted', 'approved'];

/** True when a product (or assembly) patch changes an MOQ, so quotes need to follow. */
export const touchesMoq = (patch: Record<string, unknown> | null | undefined) =>
  !!patch && ('moq' in patch || 'hard_moq' in patch);

/**
 * Puts the current MOQs on a quote's lines. Product lines match by product_id, assembly lines
 * by assembly_id. Returns null when nothing changed.
 */
export function applyMoqToLines(lines: any[], byId: Map<string, MoqPair>, source: MoqSource): any[] | null {
  if (!Array.isArray(lines)) return null;
  let changed = false;
  const next = lines.map(line => {
    const id = source === 'assembly'
      ? (line?.is_assembly ? line.assembly_id : null)
      : (line?.is_assembly ? null : line?.product_id);
    const m = id ? byId.get(id) : undefined;
    if (!m) return line;
    if ((line.moq ?? null) === (m.moq ?? null) && (line.hard_moq ?? null) === (m.hard_moq ?? null)) return line;
    changed = true;
    return { ...line, moq: m.moq ?? null, hard_moq: m.hard_moq ?? null };
  });
  return changed ? next : null;
}

/**
 * Copies the saved MOQs of these SKUs (or assemblies) onto every quote of their inquiries that
 * the customer hasn't accepted yet. Call after the MOQ is saved. Returns how many quotes changed.
 */
export async function syncQuoteMoqs(ids: string[], source: MoqSource = 'product'): Promise<number> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return 0;
  const table = source === 'assembly' ? 'product_assemblies' : 'products';
  const rows = await fetchAllByIds<any>(unique, chunk =>
    db.from(table).select('id, moq, hard_moq, customer_rfq_id').in('id', chunk).order('id'));
  const byId = new Map<string, MoqPair>(rows.map(r => [r.id, { moq: r.moq ?? null, hard_moq: r.hard_moq ?? null }]));
  const inquiryIds = [...new Set(rows.map(r => r.customer_rfq_id).filter(Boolean))] as string[];
  if (!inquiryIds.length) return 0;

  const quotes = await fetchAllByIds<any>(inquiryIds, chunk =>
    db.from('quote_snapshots').select('id, status, products').in('customer_rfq_id', chunk).order('id'));
  let updated = 0;
  for (const q of quotes) {
    if (MOQ_FROZEN_STATUSES.includes(q.status)) continue;
    const next = applyMoqToLines(q.products, byId, source);
    if (!next) continue;
    const { error } = await db.from('quote_snapshots').update({ products: next }).eq('id', q.id);
    if (error) throw new Error(error.message);
    updated++;
  }
  return updated;
}
