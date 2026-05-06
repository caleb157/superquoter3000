import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { MetricCard } from './MetricCard';
import { DrillDownDialog } from './DrillDownDialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { buildCsv, downloadCsv, rangeStamp, type CsvSection } from '@/lib/csv-export';
import { fmt } from '@/lib/formatters';
import { computeProductPriceAndCost, type ProductPriceCostMap } from '@/lib/product-pricing';
import { computeWeightedPipeline } from '@/lib/pipeline-weights';
import {
  inRange, lifecycleDurations, avg, median, fmtDays, type DateRange,
} from '@/lib/analytics-helpers';

type DrillKey = null | 'pipeline' | 'profit' | 'winRate' | 'activeCustomers';

type Props = { range: DateRange };

const STATUS_LABEL: Record<string, string> = {
  lead: 'Lead', active: 'Active', won: 'Won', inactive: 'Inactive', churned: 'Churned',
};

export function SalesDashboard({ range }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [drill, setDrill] = useState<DrillKey>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [pricing, setPricing] = useState<ProductPriceCostMap>({});
  const [lifecycleEvents, setLifecycleEvents] = useState<any[]>([]);
  const [receivedRfqs, setReceivedRfqs] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [inqStatusEvents, setInqStatusEvents] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [p, i, c, le, rr, qs, ise] = await Promise.all([
        supabase.from('products').select('id, name, quantity, design_stage, quote_stage, sample_stage, customer_rfq_id'),
        supabase.from('customer_rfqs').select('id, rfq_number, title, status, created_at, updated_at, customer_id'),
        supabase.from('customers').select('id, name, company, lead_status'),
        (supabase as any).from('customer_lifecycle_events').select('customer_id, from_status, to_status, occurred_at'),
        (supabase as any).from('inquiry_received_rfqs').select('id, inquiry_id, received_date'),
        (supabase as any).from('quote_snapshots').select('id, customer_rfq_id, created_at, totals'),
        (supabase as any).from('inquiry_status_events').select('inquiry_id, from_status, to_status, occurred_at'),
      ]);
      const prods = (p.data ?? []) as any[];
      setProducts(prods);
      setInquiries((i.data ?? []) as any[]);
      setCustomers((c.data ?? []) as any[]);
      setLifecycleEvents((le.data ?? []) as any[]);
      setReceivedRfqs((rr.data ?? []) as any[]);
      setQuotes((qs.data ?? []) as any[]);
      setInqStatusEvents((ise.data ?? []) as any[]);
      const ids = prods.map(x => x.id);
      if (ids.length) setPricing(await computeProductPriceAndCost(ids));
      setLoading(false);
    })();
  }, []);

  const inquiryStatusById = useMemo(() => {
    const m: Record<string, string> = {};
    inquiries.forEach(i => { m[i.id] = i.status; });
    return m;
  }, [inquiries]);

  const inquiryCustomerById = useMemo(() => {
    const m: Record<string, string | null> = {};
    inquiries.forEach(i => { m[i.id] = i.customer_id; });
    return m;
  }, [inquiries]);

  const customerById = useMemo(() => {
    const m: Record<string, any> = {};
    customers.forEach(c => { m[c.id] = c; });
    return m;
  }, [customers]);

  const pipeline = useMemo(
    () => computeWeightedPipeline(products, inquiryStatusById, pricing),
    [products, inquiryStatusById, pricing],
  );

  // Win rate over the range, based on inquiry status:
  // denominator = all inquiries created in range (every live inquiry counts)
  // numerator = those whose current status is 'po' (won)
  // 'cancelled' inquiries count as losses (in denominator, not in numerator).
  const winRateInRange = useMemo(() => {
    const wonIds = new Set<string>();
    const lostIds = new Set<string>();
    const openIds = new Set<string>();
    inquiries.forEach(i => {
      if (!inRange(i.created_at, range)) return;
      if (i.status === 'po') wonIds.add(i.id);
      else if (i.status === 'cancelled') lostIds.add(i.id);
      else openIds.add(i.id);
    });
    return { wonIds, lostIds, openIds };
  }, [inquiries, range]);

  const winRate = useMemo(() => {
    const total = winRateInRange.wonIds.size + winRateInRange.lostIds.size + winRateInRange.openIds.size;
    if (total === 0) return null;
    const wins = winRateInRange.wonIds.size;
    return { rate: wins / total, wins, total };
  }, [winRateInRange]);

  const winRateRows = useMemo(() => {
    if (!winRate) return [] as any[];
    const ids = new Set<string>([
      ...winRateInRange.wonIds,
      ...winRateInRange.lostIds,
      ...winRateInRange.openIds,
    ]);
    return Array.from(ids).map(id => {
      const inq = inquiries.find(x => x.id === id);
      const cust = inq?.customer_id ? customerById[inq.customer_id] : null;
      const won = winRateInRange.wonIds.has(id);
      const lost = winRateInRange.lostIds.has(id);
      return {
        id,
        rfqNumber: (inq as any)?.rfq_number || id.slice(0, 6),
        title: (inq as any)?.title || '',
        customerName: cust?.name || cust?.company || '—',
        won,
        lost,
        outcome: won ? 'Won (PO)' : lost ? 'Lost (Cancelled)' : 'Open',
      };
    }).sort((a, b) => Number(b.won) - Number(a.won));
  }, [winRate, winRateInRange, inquiries, customerById]);

  const activeCustomerRows = useMemo(() => {
    const inquiriesInRange = inquiries.filter(i => inRange(i.created_at, range) || inRange(i.updated_at, range));
    const custIds = new Set<string>();
    inquiriesInRange.forEach(i => { if (i.customer_id) custIds.add(i.customer_id); });
    return customers.filter(c => c.lead_status === 'active' && custIds.has(c.id));
  }, [inquiries, customers, range]);
  const activeCustomers = activeCustomerRows.length;

  // Lifecycle transitions in range
  const lifecycleRows = useMemo(() => {
    const trans = lifecycleDurations(lifecycleEvents).filter(t => inRange(t.occurred_at, range));
    const grouped: Record<string, { from: string; to: string; days: number[]; customers: Set<string> }> = {};
    trans.forEach(t => {
      const key = `${t.from_status}→${t.to_status}`;
      const slot = (grouped[key] ||= { from: t.from_status, to: t.to_status, days: [], customers: new Set() });
      slot.days.push(t.days);
      slot.customers.add(t.customer_id);
    });
    return Object.values(grouped).sort((a, b) => b.days.length - a.days.length);
  }, [lifecycleEvents, range]);

  // Funnel
  const funnel = useMemo(() => {
    const rfqs = receivedRfqs.filter(r => inRange(r.received_date, range)).length;
    const qSent = quotes.filter(q => inRange(q.created_at, range)).length;
    const pos = inqStatusEvents.filter(e => e.to_status === 'po' && inRange(e.occurred_at, range)).length;
    return { rfqs, qSent, pos };
  }, [receivedRfqs, quotes, inqStatusEvents, range]);

  // Customer concentration top 5
  const topCustomers = useMemo(() => {
    const byCust: Record<string, number> = {};
    pipeline.contributors.forEach(c => {
      const inquiryId = c.inquiryId;
      if (!inquiryId) return;
      const custId = inquiryCustomerById[inquiryId];
      if (!custId) return;
      byCust[custId] = (byCust[custId] || 0) + c.value;
    });
    const total = Object.values(byCust).reduce((a, b) => a + b, 0);
    return {
      total,
      rows: Object.entries(byCust)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id, value]) => ({
          id,
          name: customerById[id]?.name || customerById[id]?.company || 'Unknown',
          value,
          pct: total > 0 ? value / total : 0,
        })),
    };
  }, [pipeline.contributors, inquiryCustomerById, customerById]);

  if (loading) {
    return <div className="text-center py-10 text-sm text-muted-foreground">Loading sales analytics…</div>;
  }

  const handleExport = () => {
    const sections: CsvSection[] = [
      {
        title: `Sales Analytics — ${range.from.toISOString().slice(0, 10)} to ${range.to.toISOString().slice(0, 10)}`,
        headers: ['Metric', 'Value'],
        rows: [
          ['Weighted Pipeline (USD)', pipeline.total.toFixed(2)],
          ['Expected Net Profit (USD)', pipeline.profit.toFixed(2)],
          ['Win Rate', winRate ? `${(winRate.rate * 100).toFixed(1)}%` : '—'],
          ['Wins / Decided Inquiries', winRate ? `${winRate.wins} / ${winRate.total}` : '—'],
          ['Active Customers', activeCustomers],
        ],
      },
      {
        title: 'Pipeline contributors',
        headers: ['Product', 'Qty', 'Unit cost USD', 'Stage weight', 'Pipeline value USD', 'Inquiry ID'],
        rows: pipeline.contributors.map(c => [c.name, c.qty, c.cost.toFixed(2), c.weight.toFixed(2), c.value.toFixed(2), c.inquiryId ?? '']),
      },
      {
        title: 'Decided inquiries in range',
        headers: ['Inquiry', 'Customer', 'Outcome'],
        rows: winRateRows.map(r => [r.rfqNumber, r.customerName, r.won ? 'Won (PO)' : 'Lost (Cancelled)']),
      },
      {
        title: 'Active customers with activity in range',
        headers: ['Name', 'Company'],
        rows: activeCustomerRows.map(c => [c.name || '', c.company || '']),
      },
      {
        title: 'Customer lifecycle cycle-times',
        headers: ['From', 'To', 'Avg days', 'Median days', 'Customers'],
        rows: lifecycleRows.map(r => [r.from, r.to, avg(r.days)?.toFixed(2) ?? '', median(r.days)?.toFixed(2) ?? '', r.customers.size]),
      },
      {
        title: 'Conversion funnel',
        headers: ['Stage', 'Count'],
        rows: [['RFQs received', funnel.rfqs], ['Quotes sent', funnel.qSent], ['POs won', funnel.pos]],
      },
      {
        title: 'Top customers by pipeline',
        headers: ['Customer', 'Pipeline USD', 'Share'],
        rows: topCustomers.rows.map(r => [r.name, r.value.toFixed(2), `${(r.pct * 100).toFixed(1)}%`]),
      },
    ];
    downloadCsv(`sales-analytics_${rangeStamp(range.from, range.to)}.csv`, buildCsv(sections));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
        </Button>
      </div>
      {/* Top stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Weighted Pipeline"
          value={fmt.usd(pipeline.total)}
          sublabel="Σ qty × FOB cost × stage weight"
          onClick={pipeline.contributors.length ? () => setDrill('pipeline') : undefined}
        />
        <MetricCard
          label="Expected Net Profit"
          value={fmt.usd(pipeline.profit)}
          sublabel="(price − cost) × qty × weight"
          onClick={pipeline.contributors.length ? () => setDrill('profit') : undefined}
        />
        <MetricCard
          label="Win Rate"
          value={winRate ? `${(winRate.rate * 100).toFixed(0)}%` : '—'}
          sublabel={winRate ? `${winRate.wins} won of ${winRate.total} inquiries created in range` : 'No inquiries created in range'}
          onClick={winRateRows.length ? () => setDrill('winRate') : undefined}
        />
        <MetricCard
          label="Active Customers"
          value={activeCustomers}
          sublabel="Active status with activity in range"
          onClick={activeCustomers ? () => setDrill('activeCustomers') : undefined}
        />
      </div>

      <DrillDownDialog
        open={drill === 'pipeline'}
        onOpenChange={(o) => !o && setDrill(null)}
        title="Weighted pipeline contributors"
        description="Each product contributing to the weighted pipeline total. Value = qty × cost × stage weight."
        rows={pipeline.contributors}
        rowKey={(r, i) => `${r.name}-${i}`}
        onRowClick={(r) => r.inquiryId && navigate(`/inquiry/${r.inquiryId}?tab=products`)}
        columns={[
          { header: 'Product', cell: (r: any) => r.name },
          { header: 'Qty', align: 'right', cell: (r: any) => r.qty },
          { header: 'Unit cost', align: 'right', cell: (r: any) => fmt.usd(r.cost) },
          { header: 'Weight', align: 'right', cell: (r: any) => `${(r.weight * 100).toFixed(0)}%` },
          { header: 'Value', align: 'right', cell: (r: any) => fmt.usd(r.value) },
        ]}
      />
      <DrillDownDialog
        open={drill === 'profit'}
        onOpenChange={(o) => !o && setDrill(null)}
        title="Expected net profit contributors"
        description="Same products as pipeline, ranked by their value contribution. Profit = (price − cost) × qty × weight."
        rows={pipeline.contributors}
        rowKey={(r, i) => `p-${r.name}-${i}`}
        onRowClick={(r) => r.inquiryId && navigate(`/inquiry/${r.inquiryId}?tab=products`)}
        columns={[
          { header: 'Product', cell: (r: any) => r.name },
          { header: 'Qty', align: 'right', cell: (r: any) => r.qty },
          { header: 'Unit cost', align: 'right', cell: (r: any) => fmt.usd(r.cost) },
          { header: 'Weight', align: 'right', cell: (r: any) => `${(r.weight * 100).toFixed(0)}%` },
          { header: 'Pipeline value', align: 'right', cell: (r: any) => fmt.usd(r.value) },
        ]}
      />
      <DrillDownDialog
        open={drill === 'winRate'}
        onOpenChange={(o) => !o && setDrill(null)}
        title="Inquiries created in range"
        description="Every inquiry created during the selected range counts toward the win rate. Win rate = PO / (PO + Cancelled + Open)."
        rows={winRateRows}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/inquiry/${r.id}`)}
        columns={[
          { header: 'Inquiry', cell: (r: any) => r.rfqNumber },
          { header: 'Customer', cell: (r: any) => r.customerName },
          { header: 'Outcome', align: 'right', cell: (r: any) => r.won ? '✓ Won (PO)' : r.lost ? '✗ Lost (Cancelled)' : '◌ Open' },
        ]}
      />
      <DrillDownDialog
        open={drill === 'activeCustomers'}
        onOpenChange={(o) => !o && setDrill(null)}
        title="Active customers with activity in range"
        rows={activeCustomerRows}
        rowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/customers/${r.id}`)}
        columns={[
          { header: 'Customer', cell: (r: any) => r.name || r.company || '—' },
          { header: 'Company', cell: (r: any) => r.company || '—' },
        ]}
      />


      {/* Lifecycle table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Customer lifecycle cycle-times (in range)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {lifecycleRows.length === 0 ? (
            <div className="px-6 py-6 text-sm text-muted-foreground text-center">
              No lifecycle transitions in this period.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-xs">Transition</TableHead>
                  <TableHead className="h-8 text-xs text-right">Avg</TableHead>
                  <TableHead className="h-8 text-xs text-right">Median</TableHead>
                  <TableHead className="h-8 text-xs text-right">Customers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lifecycleRows.map(r => (
                  <TableRow key={`${r.from}-${r.to}`}>
                    <TableCell className="py-2 text-xs">
                      {STATUS_LABEL[r.from] || r.from} → {STATUS_LABEL[r.to] || r.to}
                    </TableCell>
                    <TableCell className="py-2 text-xs text-right tabular-nums">{fmtDays(avg(r.days))}</TableCell>
                    <TableCell className="py-2 text-xs text-right tabular-nums">{fmtDays(median(r.days))}</TableCell>
                    <TableCell className="py-2 text-xs text-right tabular-nums">{r.customers.size}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Funnel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quote conversion funnel (in range)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FunnelBar label="RFQs received" count={funnel.rfqs} max={Math.max(funnel.rfqs, 1)} color="bg-blue-500" />
            <div className="text-[11px] text-muted-foreground pl-1">
              → {funnel.rfqs > 0 ? `${Math.round((funnel.qSent / funnel.rfqs) * 100)}%` : '—'} converted
            </div>
            <FunnelBar label="Quotes sent" count={funnel.qSent} max={Math.max(funnel.rfqs, 1)} color="bg-purple-500" />
            <div className="text-[11px] text-muted-foreground pl-1">
              → {funnel.qSent > 0 ? `${Math.round((funnel.pos / funnel.qSent) * 100)}%` : '—'} won
            </div>
            <FunnelBar label="POs won" count={funnel.pos} max={Math.max(funnel.rfqs, 1)} color="bg-emerald-500" />
            <p className="text-[10px] text-muted-foreground pt-1">PO date approx based on inquiry status events.</p>
          </CardContent>
        </Card>

        {/* Customer concentration */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top 5 customers by pipeline</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topCustomers.rows.length === 0 ? (
              <div className="px-6 py-6 text-sm text-muted-foreground text-center">No pipeline data.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-8 text-xs">Customer</TableHead>
                    <TableHead className="h-8 text-xs text-right">Pipeline</TableHead>
                    <TableHead className="h-8 text-xs text-right">Share</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCustomers.rows.map(r => (
                    <TableRow
                      key={r.id}
                      onClick={() => navigate(`/customers/${r.id}`)}
                      className="cursor-pointer"
                    >
                      <TableCell className="py-2 text-xs">{r.name}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{fmt.usd(r.value)}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{(r.pct * 100).toFixed(0)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FunnelBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span>{label}</span>
        <span className="tabular-nums font-medium">{count}</span>
      </div>
      <div className="h-3 bg-muted rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
