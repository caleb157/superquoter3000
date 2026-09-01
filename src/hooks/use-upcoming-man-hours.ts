import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { productWeight } from '@/lib/pipeline-weights';

export type UpcomingManHours = {
  /** Raw total man-hours across all active + projected_po (non-PO) inquiries. */
  totalMh: number;
  /** Pipeline-weighted man-hours (stage weight for active, certainty for projected PO). */
  weightedMh: number;
  loading: boolean;
};

/**
 * Aggregates projected man-hours across all active, non-PO inquiries using the
 * live costing engine (auto-estimated finishing/packaging included), weighted
 * the same way as the weighted pipeline:
 *  - projected_po inquiries: whole-inquiry MH × certainty (override, default 50%)
 *  - active inquiries: per-product MH × product stage weight
 */
export function useUpcomingManHours(): UpcomingManHours {
  const [state, setState] = useState<UpcomingManHours>({ totalMh: 0, weightedMh: 0, loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: inqs } = await (supabase as any)
          .from('customer_rfqs')
          .select('id, status')
          .in('status', ['active', 'projected_po']);
        const inquiries: { id: string; status: string }[] = inqs ?? [];
        if (inquiries.length === 0) {
          if (!cancelled) setState({ totalMh: 0, weightedMh: 0, loading: false });
          return;
        }
        const inqIds = inquiries.map((i) => i.id);
        const statusById = Object.fromEntries(inquiries.map((i) => [i.id, i.status]));

        const [{ data: prods }, { data: projs }] = await Promise.all([
          (supabase as any)
            .from('products')
            .select('id, customer_rfq_id, quantity, design_stage, quote_stage, sample_stage')
            .in('customer_rfq_id', inqIds)
            .is('archived_at', null),
          (supabase as any)
            .from('inquiry_projections')
            .select('inquiry_id, certainty_override')
            .in('inquiry_id', inqIds),
        ]);
        const products: any[] = prods ?? [];
        const certaintyByInquiry: Record<string, number> = {};
        (projs ?? []).forEach((p: any) => {
          certaintyByInquiry[p.inquiry_id] =
            p.certainty_override != null ? Number(p.certainty_override) : 0.5;
        });

        if (products.length === 0) {
          if (!cancelled) setState({ totalMh: 0, weightedMh: 0, loading: false });
          return;
        }

        const prices = await computeProductPriceAndCost(products.map((p) => p.id));

        let totalMh = 0;
        let weightedMh = 0;
        // Whole-inquiry weight for projected POs (same as the revenue pipeline).
        const mhByProjectedPo: Record<string, number> = {};
        for (const p of products) {
          const inqId = p.customer_rfq_id as string;
          const status = statusById[inqId];
          const mh = (p.quantity ?? 0) * (Number((prices as any)[p.id]?.man_hours_per_unit) || 0);
          totalMh += mh;
          if (status === 'projected_po') {
            mhByProjectedPo[inqId] = (mhByProjectedPo[inqId] ?? 0) + mh;
          } else {
            weightedMh += mh * productWeight(p, status);
          }
        }
        for (const [inqId, mh] of Object.entries(mhByProjectedPo)) {
          weightedMh += mh * (certaintyByInquiry[inqId] ?? 0.5);
        }

        if (!cancelled) setState({ totalMh, weightedMh, loading: false });
      } catch {
        if (!cancelled) setState({ totalMh: 0, weightedMh: 0, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
