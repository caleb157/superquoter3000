import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmt } from '@/lib/formatters';
import { prePackagedCbm } from '@/lib/calculations';

type FilterKey = 'needs_design' | 'in_costing' | 'sampling';

type Props = {
  inquiryId: string;
  refreshKey?: number;
  onCardClick: (filter: FilterKey) => void;
};

type Counts = { needs_design: number; in_costing: number; sampling: number };
type Financials = {
  totalCbm: number;
  totalProfit: number;
  totalRevenue: number;
  marginPct: number;
  productCount: number;
};

export function InquiryStatusCards({ inquiryId, refreshKey = 0, onCardClick }: Props) {
  const [counts, setCounts] = useState<Counts>({ needs_design: 0, in_costing: 0, sampling: 0 });
  const [fin, setFin] = useState<Financials>({
    totalCbm: 0, totalProfit: 0, totalRevenue: 0, marginPct: 0, productCount: 0,
  });

  useEffect(() => {
    (async () => {
      const [{ data: prodData }, { data: cbmData }] = await Promise.all([
        supabase
          .from('products')
          .select('id, design_stage, quote_stage, sample_stage, quantity, target_price_usd, calculated_unit_price_usd, calculated_unit_cost_usd, width_inch, depth_inch, height_inch')
          .eq('customer_rfq_id', inquiryId),
        supabase
          .from('cbm_estimates')
          .select('product_id, final_unit_cbm')
          .not('final_unit_cbm', 'is', null),
      ]);
      const rows = prodData ?? [];
      const cbmMap = new Map<string, number>();
      (cbmData ?? []).forEach((c: any) => {
        cbmMap.set(c.product_id, Number(c.final_unit_cbm) || 0);
      });
      const c: Counts = { needs_design: 0, in_costing: 0, sampling: 0 };
      let revenue = 0;
      let cost = 0;
      let totalCbm = 0;
      rows.forEach((p: any) => {
        if (p.design_stage === 'need_design') c.needs_design++;
        if (p.quote_stage === 'quoting' || p.quote_stage === 'ready_for_quote') c.in_costing++;
        if (p.sample_stage === 'sampling') c.sampling++;
        const qty = Number(p.quantity) || 0;
        const price = Number(p.target_price_usd ?? p.calculated_unit_price_usd) || 0;
        const unitCost = Number(p.calculated_unit_cost_usd) || 0;
        revenue += price * qty;
        cost += unitCost * qty;
        const unitCbm = cbmMap.get(p.id) ?? prePackagedCbm(p.width_inch, p.depth_inch, p.height_inch);
        totalCbm += unitCbm * qty;
      });
      const profit = revenue - cost;
      setCounts(c);
      setFin({
        totalCbm,
        totalProfit: profit,
        totalRevenue: revenue,
        marginPct: revenue > 0 ? profit / revenue : 0,
        productCount: rows.length,
      });
    })();
  }, [inquiryId, refreshKey]);

  const cards: { key: FilterKey; label: string; count: number }[] = [
    { key: 'needs_design', label: 'Needs Design', count: counts.needs_design },
    { key: 'in_costing', label: 'In Costing', count: counts.in_costing },
    { key: 'sampling', label: 'Sampling', count: counts.sampling },
  ];

  const usd0 = (n: number) =>
    `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const profitTone =
    fin.totalProfit > 0 ? 'text-emerald-600'
    : fin.totalProfit < 0 ? 'text-destructive'
    : '';

  return (
    <div className="space-y-3">
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{fmt.cbm(fin.totalCbm)}</div>
            <div className="text-sm font-medium">Current Total CBM</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              at current quantities
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className={cn('text-2xl font-bold', profitTone)}>{usd0(fin.totalProfit)}</div>
            <div className="text-sm font-medium">Total Profit</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {fmt.pct(fin.marginPct)} margin
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{usd0(fin.totalRevenue)}</div>
            <div className="text-sm font-medium">Order Revenue</div>
            <div className="text-xs text-muted-foreground mt-0.5">price × quantity</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
