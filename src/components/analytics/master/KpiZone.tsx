import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MetricCard } from '@/components/analytics/MetricCard';
import { DrillDownDialog } from '@/components/analytics/DrillDownDialog';
import { pairRfqsToQuotes, avg, median, fmtDays, type DateRange } from '@/lib/analytics-helpers';
import { confirmedOrdersKpi, otdKpi, pickAmt, fmtMoney, MIN_ORDER_USD, type Ccy, type Snapshot } from '@/lib/master-analytics';
import { ComplaintsPanel, useComplaints } from './ComplaintsPanel';

type Drill = null | 'orders' | 'rfq' | 'rfs' | 'otd';
const days = (a: string | null, b: string | null) => (a && b ? (new Date(b).getTime() - new Date(a.length === 10 ? a + 'T00:00:00Z' : a).getTime()) / 86400000 : null);

export function KpiZone({ snapshot, ccy, range }: { snapshot: Snapshot | null; ccy: Ccy; range: DateRange }) {
  const [drill, setDrill] = useState<Drill>(null);
  const [hq, setHq] = useState<{ rfqs: any[]; quotes: any[]; samples: any[]; inq: Record<string, string> }>({ rfqs: [], quotes: [], samples: [], inq: {} });
  const complaints = useComplaints();

  useEffect(() => {
    (async () => {
      const [r, q, s, i] = await Promise.all([
        (supabase as any).from('inquiry_received_rfqs').select('id, inquiry_id, received_date'),
        supabase.from('quote_snapshots').select('id, customer_rfq_id, created_at'),
        supabase.from('samples').select('id, customer_rfq_id, product_id, status, requested_date, initial_ready_date, final_ready_date, completed_at, products(name)'),
        supabase.from('customer_rfqs').select('id, rfq_number, title'),
      ]);
      const inq: Record<string, string> = {};
      (i.data || []).forEach((x: any) => (inq[x.id] = `${x.rfq_number}${x.title ? ' · ' + x.title : ''}`));
      setHq({ rfqs: r.data || [], quotes: (q.data || []) as any[], samples: s.data || [], inq });
    })();
  }, []);

  const inWin = (d: string | null) => { if (!d) return false; const t = new Date(d.length === 10 ? d + 'T12:00:00' : d).getTime(); return t >= range.from.getTime() && t <= range.to.getTime(); };

  const orders = useMemo(() => snapshot ? confirmedOrdersKpi(snapshot.sales_orders, range.from, range.to, snapshot.inr_per_usd) : null, [snapshot, range]);
  const otd = useMemo(() => snapshot ? otdKpi(snapshot.sales_orders, range.from, range.to) : null, [snapshot, range]);
  const rfq = useMemo(() => pairRfqsToQuotes(hq.rfqs, hq.quotes).filter(p => inWin(p.respondedAt)), [hq, range]);
  const rfs = useMemo(() => hq.samples.filter(s => s.completed_at && s.requested_date && inWin(s.completed_at)).map(s => ({
    ...s, total: days(s.requested_date, s.completed_at)!,
    toInitial: days(s.requested_date, s.initial_ready_date), initialToFinal: days(s.initial_ready_date, s.final_ready_date),
    finalToDone: days(s.final_ready_date || s.initial_ready_date, s.completed_at),
  })).sort((a, b) => b.total - a.total), [hq, range]);
  const openComplaints = complaints.rows.filter(c => c.status === 'open').length;
  const loggedComplaints = complaints.rows.filter(c => inWin(c.date_logged)).length;

  const revenue = orders?.qualifying.reduce((s, o) => s + pickAmt(o, ccy), 0) ?? 0;
  const rfqDays = rfq.map(p => p.days), rfsDays = rfs.map(s => s.total);
  const stageAvg = (k: 'toInitial' | 'initialToFinal' | 'finalToDone') => fmtDays(avg(rfs.map(s => s[k]).filter((x): x is number => x != null)));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Confirmed SOs" value={orders ? orders.qualifying.length : '—'} sublabel={`≥ $${MIN_ORDER_USD} · Odoo`} onClick={snapshot ? () => setDrill('orders') : undefined} />
        <MetricCard label="Booked revenue" value={snapshot ? fmtMoney(revenue, ccy) : '—'} sublabel="untaxed, Odoo rate" onClick={snapshot ? () => setDrill('orders') : undefined} />
        <MetricCard label="RFQ → quote" value={fmtDays(avg(rfqDays))} subValue={`median ${fmtDays(median(rfqDays))}`} sublabel={`${rfq.length} quotes`} onClick={() => setDrill('rfq')} />
        <MetricCard label="Sample cycle (RFS)" value={fmtDays(median(rfsDays))} subValue={`avg ${fmtDays(avg(rfsDays))}`} sublabel={`median · ${rfs.length} done`} onClick={() => setDrill('rfs')} />
        <MetricCard label="On-time delivery" value={otd?.rate != null ? `${Math.round(otd.rate * 100)}%` : '—'} subValue={otd ? `${otd.onTime}/${otd.scored}` : undefined} sublabel="in-house SOs" onClick={snapshot ? () => setDrill('otd') : undefined} />
        <MetricCard label="Complaints" value={loggedComplaints} subValue={`${openComplaints} open`} sublabel="logged in period" />
      </div>

      <ComplaintsPanel rows={complaints.rows} reload={complaints.reload} from={range.from} to={range.to} />

      <DrillDownDialog open={drill === 'orders'} onOpenChange={o => !o && setDrill(null)} title="Confirmed sales orders"
        description={`Orders confirmed in the period worth at least $${MIN_ORDER_USD} (or ₹ equivalent). Amounts untaxed, converted at each order's own Odoo rate.`}
        rows={orders?.qualifying ?? []} rowKey={r => r.name}
        columns={[
          { header: 'SO', cell: r => r.name }, { header: 'Customer', cell: r => r.partner ?? '—' }, { header: 'Date', cell: r => r.date_order },
          { header: 'Doc ccy', cell: r => r.currency }, { header: 'Amount', align: 'right', cell: r => fmtMoney(pickAmt(r, ccy), ccy, false) },
        ]} />
      <DrillDownDialog open={drill === 'rfq'} onOpenChange={o => !o && setDrill(null)} title="RFQ → quote speed"
        description="Days from a logged received-RFQ date to the first quote generated after it. Counted when the quote is created in the period. RFQs without a logged received date, or quotes not made with Generate Quote, are not counted."
        rows={[...rfq].sort((a, b) => b.days - a.days)} rowKey={r => r.receivedRfqId}
        columns={[
          { header: 'Inquiry', cell: r => hq.inq[r.inquiryId] ?? '—' }, { header: 'RFQ received', cell: r => r.receivedAt },
          { header: 'Quoted', cell: r => r.respondedAt.slice(0, 10) }, { header: 'Days', align: 'right', cell: r => fmtDays(r.days) },
        ]} />
      <DrillDownDialog open={drill === 'rfs'} onOpenChange={o => !o && setDrill(null)} title="Sample cycle breakdown"
        description={`Requested → completed, for samples completed in the period (slowest first). Median is the headline because one old request finished late can drag the average. Stage averages: request→initial ready ${stageAvg('toInitial')}, initial→final ready ${stageAvg('initialToFinal')}, final ready→completed ${stageAvg('finalToDone')}.`}
        rows={rfs} rowKey={r => r.id}
        columns={[
          { header: 'Product', cell: r => r.products?.name ?? '—' }, { header: 'Inquiry', cell: r => hq.inq[r.customer_rfq_id] ?? '—' },
          { header: 'Requested', cell: r => r.requested_date }, { header: '→ Initial', align: 'right', cell: r => fmtDays(r.toInitial) },
          { header: '→ Final', align: 'right', cell: r => fmtDays(r.initialToFinal) }, { header: '→ Done', align: 'right', cell: r => fmtDays(r.finalToDone) },
          { header: 'Total', align: 'right', cell: r => <b>{fmtDays(r.total)}</b> },
        ]} />
      <DrillDownDialog open={drill === 'otd'} onOpenChange={o => !o && setDrill(null)} title="On-time delivery"
        description="Fully delivered SOs with at least one MO, delivered in the period. Ready date = last Packaging work-order entry in LaborTrax across all MOs + 1 day, compared with the original delivery date. Orders without packaging entries are listed but not scored."
        rows={otd?.rows ?? []} rowKey={r => r.name}
        columns={[
          { header: 'SO', cell: r => r.name }, { header: 'Customer', cell: r => r.partner ?? '—' }, { header: 'MOs', align: 'right', cell: r => r.mo_names.length },
          { header: 'Original due', cell: r => r.original_delivery ?? '—' }, { header: 'Ready', cell: r => r.ready_date ?? '—' },
          { header: 'Result', cell: r => r.onTime == null ? <span className="text-muted-foreground">not scored</span> : r.onTime ? <span className="text-success">On time</span> : <span className="text-destructive">{r.lateDays}d late</span> },
        ]} />
    </div>
  );
}
