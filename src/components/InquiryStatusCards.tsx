import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type FilterKey = 'needs_design' | 'in_costing' | 'sampling';

type Props = {
  inquiryId: string;
  refreshKey?: number;
  onCardClick: (filter: FilterKey) => void;
};

type Counts = { needs_design: number; in_costing: number; sampling: number };

export function InquiryStatusCards({ inquiryId, refreshKey = 0, onCardClick }: Props) {
  const [counts, setCounts] = useState<Counts>({ needs_design: 0, in_costing: 0, sampling: 0 });

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('products')
        .select('design_stage, quote_stage, sample_stage')
        .eq('customer_rfq_id', inquiryId);
      const c: Counts = { needs_design: 0, in_costing: 0, sampling: 0 };
      (data ?? []).forEach((p: any) => {
        if (p.design_stage === 'need_design') c.needs_design++;
        if (p.quote_stage === 'quoting' || p.quote_stage === 'ready_for_quote') c.in_costing++;
        if (p.sample_stage === 'sampling') c.sampling++;
      });
      setCounts(c);
    })();
  }, [inquiryId, refreshKey]);

  const cards: { key: FilterKey; label: string; count: number }[] = [
    { key: 'needs_design', label: 'Needs Design', count: counts.needs_design },
    { key: 'in_costing', label: 'In Costing', count: counts.in_costing },
    { key: 'sampling', label: 'Sampling', count: counts.sampling },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {cards.map(c => {
        const empty = c.count === 0;
        return (
          <Card
            key={c.key}
            onClick={() => onCardClick(c.key)}
            className={cn('cursor-pointer transition hover:bg-muted/50', empty && 'opacity-60')}
          >
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{c.count}</div>
              <div className="text-sm font-medium">{c.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {c.count === 1 ? '1 product' : `${c.count} products`}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
