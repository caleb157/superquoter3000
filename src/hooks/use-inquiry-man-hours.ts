import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { computeProductPriceAndCost } from '@/lib/product-pricing';

export type InquiryManHours = {
  /** inquiry id → total man-hours (qty × live MH/unit, auto finishing/packaging included). */
  mhByInquiry: Record<string, number>;
  loading: boolean;
};

/**
 * Computes total projected man-hours per inquiry using the live costing engine,
 * so auto-estimated finishing/packaging MH are included and archived products
 * are skipped. Matches the per-product MH shown on the inquiry page.
 */
export function useInquiryManHours(inquiryIds: string[]): InquiryManHours {
  const [state, setState] = useState<InquiryManHours>({ mhByInquiry: {}, loading: true });
  const key = inquiryIds.slice().sort().join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (inquiryIds.length === 0) {
          if (!cancelled) setState({ mhByInquiry: {}, loading: false });
          return;
        }
        const products: any[] = [];
        for (let i = 0; i < inquiryIds.length; i += 40) {
          const { data: prods } = await (supabase as any)
            .from('products')
            .select('id, customer_rfq_id, quantity')
            .in('customer_rfq_id', inquiryIds.slice(i, i + 40))
            .is('archived_at', null)
            .limit(100000);
          products.push(...(prods ?? []));
        }
        if (products.length === 0) {
          if (!cancelled) setState({ mhByInquiry: {}, loading: false });
          return;
        }
        // Compute in small batches: a single huge batch can exceed PostgREST's
        // max-rows / URL limits and silently return partial cogs/overhead rows,
        // which under-reports man-hours vs. the inquiry page.
        const ids = products.map((p) => p.id);
        const prices: Record<string, any> = {};
        for (let i = 0; i < ids.length; i += 25) {
          const chunk = await computeProductPriceAndCost(ids.slice(i, i + 25));
          Object.assign(prices, chunk);
        }
        const mhByInquiry: Record<string, number> = {};
        for (const p of products) {
          const mh = (p.quantity ?? 0) * (Number((prices as any)[p.id]?.man_hours_per_unit) || 0);
          mhByInquiry[p.customer_rfq_id] = (mhByInquiry[p.customer_rfq_id] ?? 0) + mh;
        }
        if (!cancelled) setState({ mhByInquiry, loading: false });
      } catch {
        if (!cancelled) setState({ mhByInquiry: {}, loading: false });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}
