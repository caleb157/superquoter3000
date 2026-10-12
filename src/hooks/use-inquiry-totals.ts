import { useEffect, useRef, useState } from 'react';
import { loadInquiryTotals, type InquiryTotals } from '@/lib/inquiry-totals';

const BATCH = 8;

/**
 * Live order value, profit and man-hours per inquiry — the same calculation as the
 * inquiry page (src/lib/inquiry-totals.ts). Inquiries are computed a batch at a time
 * in the order given, so the first rows fill in quickly; `pending` holds the ids
 * still being computed. An inquiry is computed once per mount, so changing the
 * filter only computes the newly shown ones.
 */
export function useInquiryTotals(inquiryIds: string[]): {
  totalsByInquiry: Record<string, InquiryTotals>;
  pending: Set<string>;
} {
  const [totalsByInquiry, setTotals] = useState<Record<string, InquiryTotals>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const done = useRef(new Set<string>());
  const key = inquiryIds.join(',');

  useEffect(() => {
    let cancelled = false;
    const todo = inquiryIds.filter(id => !done.current.has(id));
    setPending(new Set(todo));
    (async () => {
      for (let i = 0; i < todo.length && !cancelled; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        try {
          const res = await loadInquiryTotals(batch);
          if (!cancelled) {
            batch.forEach(id => done.current.add(id));
            setTotals(prev => ({ ...prev, ...res }));
          }
        } catch (e) {
          console.error('Inquiry totals failed', e);
        }
        if (!cancelled) setPending(prev => {
          const next = new Set(prev);
          batch.forEach(id => next.delete(id));
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { totalsByInquiry, pending };
}
