import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { STAGE_LABEL } from '@/components/ProductStagePills';

type EventRow = {
  id: string;
  product_id: string;
  track: string;
  from_stage: string | null;
  to_stage: string | null;
  occurred_at: string;
  product_name?: string;
};

export function InquiryActivityFeed({ inquiryId, limit = 10 }: { inquiryId: string; limit?: number }) {
  const [rows, setRows] = useState<EventRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data: prods } = await supabase
        .from('products').select('id, name').eq('customer_rfq_id', inquiryId);
      if (!prods?.length) { setRows([]); return; }
      const nameMap = new Map<string, string>(prods.map(p => [p.id, p.name]));
      const ids = prods.map(p => p.id);
      const { data: evts } = await supabase
        .from('product_stage_events').select('*').in('product_id', ids)
        .order('occurred_at', { ascending: false }).limit(limit);
      setRows((evts ?? []).map(e => ({ ...e, product_name: nameMap.get(e.product_id) })));
    })();
  }, [inquiryId, limit]);

  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground text-center py-4">No activity yet.</div>;
  }

  const labelOrDash = (s: string | null) => s ? (STAGE_LABEL[s] ?? s) : '—';

  return (
    <ul className="divide-y">
      {rows.map(r => (
        <li key={r.id} className="py-2 flex items-center gap-2 text-sm">
          <span className="font-medium truncate max-w-[180px]">{r.product_name ?? '—'}</span>
          <span className="text-muted-foreground capitalize">{r.track}:</span>
          <span className="text-muted-foreground">{labelOrDash(r.from_stage)} → {labelOrDash(r.to_stage)}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(r.occurred_at), { addSuffix: true })}
          </span>
        </li>
      ))}
    </ul>
  );
}
