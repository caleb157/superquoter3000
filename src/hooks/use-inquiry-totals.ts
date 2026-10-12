import { useEffect, useRef, useState } from 'react';
import { loadInquiryTotals, type InquiryTotals } from '@/lib/inquiry-totals';
import { getLiveCosts, setLiveCosts } from '@/lib/live-cost-cache';

const BATCH = 8;
/** Batches computed at once (rate tables are shared, so each batch is a handful of requests). */
const PARALLEL = 3;

/**
 * Live order value, profit and man-hours per inquiry — the same calculation as the
 * inquiry page (src/lib/inquiry-totals.ts). Inquiries are computed in batches, a few
 * at once, in the order given, so the first rows fill in quickly; `pending` holds the ids
 * still being computed. An inquiry is computed once per mount, so changing the
 * filter only computes the newly shown ones, and results are kept between visits
 * (src/lib/live-cost-cache.ts), so coming back to the list reuses them.
 */
export function useInquiryTotals(inquiryIds: string[]): {
  totalsByInquiry: Record<string, InquiryTotals>;
  pending: Set<string>;
} {
  const [totalsByInquiry, setTotals] = useState<Record<string, InquiryTotals>>(() => getLiveCosts<InquiryTotals>('inquiry-totals', inquiryIds));
  const [pending, setPending] = useState<Set<string>>(new Set());
  const done = useRef(new Set<string>());
  const key = inquiryIds.join(',');

  useEffect(() => {
    let cancelled = false;
    const cached = getLiveCosts<InquiryTotals>('inquiry-totals', inquiryIds.filter(id => !done.current.has(id)));
    Object.keys(cached).forEach(id => done.current.add(id));
    if (Object.keys(cached).length) setTotals(prev => ({ ...prev, ...cached }));
    const todo = inquiryIds.filter(id => !done.current.has(id));
    setPending(new Set(todo));
    const batches: string[][] = [];
    for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
    let next = 0;
    const worker = async () => {
      while (next < batches.length && !cancelled) {
        const batch = batches[next++];
        try {
          const res = await loadInquiryTotals(batch);
          if (!cancelled) {
            batch.forEach(id => done.current.add(id));
            setLiveCosts('inquiry-totals', res, id => id);
            setTotals(prev => ({ ...prev, ...res }));
          }
        } catch (e) {
          console.error('Inquiry totals failed', e);
        }
        if (!cancelled) setPending(prev => {
          const rest = new Set(prev);
          batch.forEach(id => rest.delete(id));
          return rest;
        });
      }
    };
    for (let w = 0; w < Math.min(PARALLEL, batches.length); w++) void worker();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { totalsByInquiry, pending };
}
