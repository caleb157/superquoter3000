// Shared inquiry status-change side effects.
// Both InquiryDetail (the status dropdown) and the Dashboard kanban drag handler
// call applyInquiryStatusChange so the PO snapshot, paused-priority adjust, and
// any other transition behavior live in exactly ONE place.

import { supabase } from '@/integrations/supabase/client';
import type { InquiryStatus } from '@/lib/inquiry-status';

export type ApplyStatusResult = { ok: boolean; error?: string; patch?: Record<string, any> };

/**
 * Apply an inquiry status change with all canonical side effects:
 *  - Moving to 'paused' demotes priority to 'low'.
 *  - First-time transition to 'po' auto-fills po_received_date and po_total_value_usd
 *    (from the latest USD quote snapshot, if any), then snapshots live FOB/GPM into
 *    inquiry_projections.
 */
export async function applyInquiryStatusChange(
  inquiryId: string,
  newStatus: InquiryStatus,
  context: { previousStatus?: string } = {},
): Promise<ApplyStatusResult> {
  if (!inquiryId) return { ok: false, error: 'Missing inquiry id' };

  // Read current inquiry to know previous state for transition detection.
  const { data: inquiry, error: readErr } = await (supabase as any)
    .from('customer_rfqs')
    .select('status, priority, po_received_date, po_total_value_usd')
    .eq('id', inquiryId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const previousStatus = context.previousStatus ?? inquiry?.status;

  let patch: Record<string, any> = { status: newStatus };
  if (newStatus === 'paused') patch = { priority: 'low', ...patch };

  const isPoTransition = newStatus === 'po' && previousStatus !== 'po';
  if (isPoTransition) {
    const fill: Record<string, any> = {};
    if (!inquiry?.po_received_date) {
      fill.po_received_date = new Date().toISOString().slice(0, 10);
    }
    if (inquiry?.po_total_value_usd == null) {
      const { data: latest } = await (supabase as any)
        .from('quote_snapshots')
        .select('totals, currency, created_at')
        .eq('customer_rfq_id', inquiryId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const totalsAny = latest?.totals as any;
      const grand = totalsAny?.grand_total;
      if (latest && (latest.currency ?? 'USD') === 'USD' && typeof grand === 'number') {
        fill.po_total_value_usd = grand;
      }
    }
    patch = { ...fill, ...patch };
  }

  const { error } = await (supabase as any).from('customer_rfqs').update(patch).eq('id', inquiryId);
  if (error) return { ok: false, error: error.message };

  if (isPoTransition) {
    try {
      const { computeProductPriceAndCost } = await import('@/lib/product-pricing');
      const { computeInquiryFinancials } = await import('@/lib/inquiry-financials');
      const { data: prods } = await (supabase as any)
        .from('products')
        .select('id, quantity')
        .eq('customer_rfq_id', inquiryId);
      const ids = (prods || []).map((p: any) => p.id);
      if (ids.length) {
        const priceMap = await computeProductPriceAndCost(ids);
        const live = computeInquiryFinancials(prods as any, priceMap);
        if (live.fobRevenueUsd > 0) {
          await (supabase as any)
            .from('inquiry_projections')
            .upsert(
              {
                inquiry_id: inquiryId,
                projected_fob_revenue_usd: Math.round(live.fobRevenueUsd * 100) / 100,
                project_gpm: Math.round(live.gpm * 10000) / 10000,
              },
              { onConflict: 'inquiry_id' },
            );
        }
      }
    } catch (e: any) {
      console.warn('Failed to snapshot live projection on PO transition', e);
    }
  }

  return { ok: true, patch };
}
