import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fmt } from '@/lib/formatters';
import { computeInquiryPriceAndCost } from '@/lib/inquiry-pricing';
import { sumInquiryTotals } from '@/lib/inquiry-totals';
import { formatMoney, quoteCurrencyOf, type QuoteCur } from '@/lib/quote-currency';

type FilterKey = 'needs_design' | 'in_costing' | 'sampling';

type Props = {
  inquiryId: string;
  refreshKey?: number;
  onCardClick: (filter: FilterKey) => void;
};

type Counts = { needs_design: number; in_costing: number; sampling: number };
type Financials = {
  cur: QuoteCur;
  totalCbm: number;
  totalProfit: number;
  totalRevenue: number;
  marginPct: number;
  productCount: number;
};

export function InquiryStatusCards({ inquiryId, refreshKey = 0, onCardClick }: Props) {
  const [counts, setCounts] = useState<Counts>({ needs_design: 0, in_costing: 0, sampling: 0 });
  const [archivedCount, setArchivedCount] = useState(0);
  const [fin, setFin] = useState<Financials>({
    cur: 'USD', totalCbm: 0, totalProfit: 0, totalRevenue: 0, marginPct: 0, productCount: 0,
  });

  useEffect(() => {
    const since = Date.now();
    (async () => {
      const [{ data: prodData }, { count: archived }, { data: inq }] = await Promise.all([
        (supabase as any)
          .from('products')
          .select('id, design_stage, quote_stage, sample_stage, quantity, archived_at, calculated_unit_price_usd, calculated_unit_cost_usd')
          .eq('customer_rfq_id', inquiryId)
          .is('archived_at', null),
        (supabase as any)
          .from('products')
          .select('id', { count: 'exact', head: true })
          .eq('customer_rfq_id', inquiryId)
          .not('archived_at', 'is', null),
        (supabase as any).from('customer_rfqs').select('quoting_currency').eq('id', inquiryId).maybeSingle(),
      ]);
      setArchivedCount(archived || 0);
      const rows = prodData ?? [];
      const c: Counts = { needs_design: 0, in_costing: 0, sampling: 0 };
      rows.forEach((p: any) => {
        if (p.design_stage === 'need_design') c.needs_design++;
        if (p.quote_stage === 'quoting' || p.quote_stage === 'ready_for_quote') c.in_costing++;
        if (p.sample_stage === 'sampling') c.sampling++;
      });
      setCounts(c);
      // Same calculation as the Inquiries list (src/lib/inquiry-totals.ts).
      const priceMap = rows.length > 0
        ? await computeInquiryPriceAndCost(inquiryId, since)
        : {};
      const t = sumInquiryTotals(rows, priceMap);
      // Rupee customers see the order in ₹ (falls back to USD only if no rate is known yet).
      const cur: QuoteCur = quoteCurrencyOf(inq) === 'INR' && t.revenueInr != null ? 'INR' : 'USD';
      setFin({
        cur,
        totalCbm: t.cbm,
        totalProfit: cur === 'INR' ? t.profitInr! : t.profitUsd,
        totalRevenue: cur === 'INR' ? t.revenueInr! : t.revenueUsd,
        marginPct: t.margin,
        productCount: t.productCount,
      });
    })();
  }, [inquiryId, refreshKey]);

  const cards: { key: FilterKey; label: string; count: number }[] = [
    { key: 'needs_design', label: 'Needs Design', count: counts.needs_design },
    { key: 'in_costing', label: 'In Costing', count: counts.in_costing },
    { key: 'sampling', label: 'Sampling', count: counts.sampling },
  ];

  const usd0 = (n: number) => formatMoney(n, fin.cur, 0);

  const profitTone =
    fin.totalProfit > 0 ? 'text-success'
    : fin.totalProfit < 0 ? 'text-destructive'
    : '';

  return (
    <div className="space-y-3">

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
            <div className="text-xs text-muted-foreground mt-0.5">
              price × quantity{archivedCount > 0 ? ` · ${archivedCount} archived excluded` : ''}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
