import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { DrillDownDialog } from '@/components/analytics/DrillDownDialog';
import { Button } from '@/components/ui/button';
import { Target } from 'lucide-react';
import { median, fmtDays, type DateRange } from '@/lib/analytics-helpers';
import { inquiryQuoteTimings, sampleRequestTimings, monthlyMedians } from '@/lib/timing-kpis';
import { confirmedOrdersKpi, otdKpi, pickAmt, fmtMoney, MIN_ORDER_USD, type Ccy, type Snapshot } from '@/lib/master-analytics';
import { ComplaintsPanel, useComplaints } from './ComplaintsPanel';
import { KpiGauge } from './KpiGauge';
import { TargetsDialog, useKpiTargets } from './TargetsDialog';
import { MonthlyTrend } from './MonthlyTrend';

type Drill = null | 'orders' | 'rfq' | 'rfs' | 'otd';

export function KpiZone({ snapshot, ccy, range }: { snapshot: Snapshot | null; ccy: Ccy; range: DateRange }) {
  const navigate = useNavigate();
  const [drill, setDrill] = useState<Drill>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const { targets, save: saveTargets } = useKpiTargets();
  const [hq, setHq] = useState<{ inquiries: any[]; quotes: any[]; requests: any[]; inq: Record<string, string> }>({ inquiries: [], quotes: [], requests: [], inq: {} });
  const complaints = useComplaints();

  useEffect(() => {
    (async () => {
      const [q, s, i, p] = await Promise.all([
        supabase.from('quote_snapshots').select('customer_rfq_id, created_at'),
        (supabase as any).from('sample_requests').select('id, request_number, customer_rfq_id, requested_date, required_by_date, samples(status, completed_at)'),
        // '*' so the hand-entered quoted_date comes along without failing the query before its column exists.
        (supabase as any).from('customer_rfqs').select('*'),
        (supabase as any).from('inquiry_projections').select('inquiry_id').eq('repeat_order', true),
      ]);
      const repeats = new Set<string>((p.data || []).map((x: any) => x.inquiry_id));
      const inquiries = (i.data || []).map((x: any) => ({ ...x, repeat_order: repeats.has(x.id) }));
      const inq: Record<string, string> = {};
      inquiries.forEach((x: any) => (inq[x.id] = `${x.rfq_number}${x.title ? ' · ' + x.title : ''}`));
      setHq({ inquiries, quotes: (q.data || []) as any[], requests: s.data || [], inq });
    })();
  }, []);

  const inWin = (d: string | null) => { if (!d) return false; const t = new Date(d.length === 10 ? d + 'T12:00:00' : d).getTime(); return t >= range.from.getTime() && t <= range.to.getTime(); };
  const inWinDate = (d: Date | null) => !!d && d.getTime() >= range.from.getTime() && d.getTime() <= range.to.getTime();

  const orders = useMemo(() => snapshot ? confirmedOrdersKpi(snapshot.sales_orders, range.from, range.to, snapshot.inr_per_usd) : null, [snapshot, range]);
  const otd = useMemo(() => snapshot ? otdKpi(snapshot.sales_orders, range.from, range.to) : null, [snapshot, range]);
  // Inquiry → first quote and sample request → received, from the clocks on each inquiry.
  // Counted in the period the clock stopped; open ones are listed in the drill-down but not in the median.
  const quoteTimes = useMemo(() => inquiryQuoteTimings(hq.inquiries, hq.quotes), [hq]);
  const quoted = useMemo(() => quoteTimes.filter(t => inWinDate(t.quotedAt)).sort((a, b) => b.days - a.days), [quoteTimes, range]);
  const waiting = useMemo(() => quoteTimes.filter(t => t.waiting).sort((a, b) => b.days - a.days), [quoteTimes]);
  const quoteTrend = useMemo(() => monthlyMedians(quoteTimes.filter(t => t.quotedAt).map(t => ({ at: t.quotedAt!, days: t.days })), range.to), [quoteTimes, range]);
  const sampleTimes = useMemo(() => sampleRequestTimings(hq.requests), [hq]);
  const received = useMemo(() => sampleTimes.filter(t => inWinDate(t.receivedAt)).sort((a, b) => b.days - a.days), [sampleTimes, range]);
  const openSamples = useMemo(() => sampleTimes.filter(t => !t.receivedAt).sort((a, b) => b.days - a.days), [sampleTimes]);
  const sampleTrend = useMemo(() => monthlyMedians(sampleTimes.filter(t => t.receivedAt).map(t => ({ at: t.receivedAt!, days: t.days })), range.to), [sampleTimes, range]);
  const openComplaints = complaints.rows.filter(c => c.status === 'open').length;
  const loggedComplaints = complaints.rows.filter(c => inWin(c.date_logged)).length;

  const revenue = orders?.qualifying.reduce((s, o) => s + pickAmt(o, ccy), 0) ?? 0;

  const scale = Math.max(1, (range.to.getTime() - range.from.getTime()) / 86400000 + 1) / 30.4;
  const fxRate = snapshot?.inr_per_usd || 0;
  const revGoal = targets.revenue_usd_monthly * scale * (ccy === 'INR' ? fxRate || 1 : 1);
  const soGoal = Math.max(1, Math.round(targets.confirmed_sos_monthly * scale));
  const cGoal = Math.round(targets.complaints_monthly * scale * 10) / 10;
  const quoteMed = median(quoted.map(t => t.days)), sampleMed = median(received.map(t => t.days));

  return (
    <div className="space-y-3">
      <div className="flex justify-end -mt-1">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setTargetsOpen(true)}><Target className="h-3 w-3" /> Set targets</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiGauge label="Confirmed SOs" display={orders ? String(orders.qualifying.length) : '—'} actual={orders ? orders.qualifying.length : null}
          goal={soGoal} goalDisplay={String(soGoal)} higherIsBetter sub={`≥ $${MIN_ORDER_USD}`} onClick={snapshot ? () => setDrill('orders') : undefined} />
        <KpiGauge label="Booked revenue" display={snapshot ? fmtMoney(revenue, ccy) : '—'} actual={snapshot ? revenue : null}
          goal={revGoal} goalDisplay={fmtMoney(revGoal, ccy)} higherIsBetter sub="untaxed" onClick={snapshot ? () => setDrill('orders') : undefined} />
        <KpiGauge label="Inquiry → quote" display={fmtDays(quoteMed)} actual={quoted.length ? quoteMed : null}
          goal={targets.rfq_days} goalDisplay={`≤ ${targets.rfq_days}d`} higherIsBetter={false} sub={`median · ${quoted.length} quoted · ${waiting.length} waiting`} onClick={() => setDrill('rfq')} />
        <KpiGauge label="Samples → received" display={fmtDays(sampleMed)} actual={received.length ? sampleMed : null}
          goal={targets.sample_days} goalDisplay={`≤ ${targets.sample_days}d`} higherIsBetter={false} sub={`median · ${received.length} received · ${openSamples.length} open`} onClick={() => setDrill('rfs')} />
        <KpiGauge label="On-time delivery" display={otd?.rate != null ? `${Math.round(otd.rate * 100)}%` : '—'} actual={otd?.rate != null ? otd.rate * 100 : null}
          goal={targets.otd_pct} goalDisplay={`≥ ${targets.otd_pct}%`} higherIsBetter sub={otd ? `${otd.onTime}/${otd.scored} SOs` : undefined} onClick={snapshot ? () => setDrill('otd') : undefined} />
        <KpiGauge label="Complaints" display={String(loggedComplaints)} actual={loggedComplaints}
          goal={cGoal} goalDisplay={`≤ ${cGoal}`} higherIsBetter={false} sub={`${openComplaints} open`} />
      </div>
      <TargetsDialog open={targetsOpen} onOpenChange={setTargetsOpen} targets={targets} onSave={saveTargets} />

      <ComplaintsPanel rows={complaints.rows} reload={complaints.reload} from={range.from} to={range.to} />

      <DrillDownDialog open={drill === 'orders'} onOpenChange={o => !o && setDrill(null)} title="Confirmed sales orders"
        description={`Orders confirmed in the period worth at least $${MIN_ORDER_USD} (or ₹ equivalent). Amounts untaxed, converted at each order's own Odoo rate.`}
        rows={orders?.qualifying ?? []} rowKey={r => r.name}
        columns={[
          { header: 'SO', cell: r => r.name }, { header: 'Customer', cell: r => r.partner ?? '—' }, { header: 'Date', cell: r => r.date_order },
          { header: 'Doc ccy', cell: r => r.currency }, { header: 'Amount', align: 'right', cell: r => fmtMoney(pickAmt(r, ccy), ccy, false) },
        ]} />
      <DrillDownDialog open={drill === 'rfq'} onOpenChange={o => !o && setDrill(null)} title="Inquiry → quote"
        description="Days from the inquiry's received date (or creation time, if logged that day) to its first saved quote (or the quoted date entered on the inquiry): the same clock as the strip on each inquiry. Repeat orders aren't counted. The median counts inquiries first quoted in the period; active inquiries still waiting are listed below them but not counted."
        header={<MonthlyTrend points={quoteTrend} goal={targets.rfq_days} label="Median days to first quote, by month quoted" />}
        rows={[...quoted, ...waiting]} rowKey={r => r.inquiryId} onRowClick={r => navigate(`/inquiry/${r.inquiryId}`)}
        columns={[
          { header: 'Inquiry', cell: r => hq.inq[r.inquiryId] ?? '—' }, { header: 'Received', cell: r => r.start.toLocaleDateString() },
          { header: 'First quote', cell: r => r.quotedAt ? r.quotedAt.toLocaleDateString() : <span className="text-muted-foreground">waiting</span> },
          { header: 'Days', align: 'right', cell: r => r.quotedAt ? fmtDays(r.days) : <span className="text-muted-foreground">{fmtDays(r.days)}</span> },
        ]} />
      <DrillDownDialog open={drill === 'rfs'} onOpenChange={o => !o && setDrill(null)} title="Sample request → received"
        description="Days from a sample request to the last of its samples received at our factory (cancelled lines don't count): the same clock as the sample strip on each inquiry. The median counts requests completed in the period; open requests are listed below them but not counted."
        header={<MonthlyTrend points={sampleTrend} goal={targets.sample_days} label="Median days to receive samples, by month received" />}
        rows={[...received, ...openSamples]} rowKey={r => r.requestId} onRowClick={r => navigate(`/samples/${r.requestId}`)}
        columns={[
          { header: 'Request', cell: r => r.number }, { header: 'Inquiry', cell: r => (r.inquiryId && hq.inq[r.inquiryId]) ?? '—' },
          { header: 'Requested', cell: r => r.requestedDate },
          { header: 'Received', cell: r => r.receivedAt ? r.receivedAt.toLocaleDateString() : <span className="text-muted-foreground">{r.received} of {r.total}</span> },
          { header: 'Days', align: 'right', cell: r => r.receivedAt ? fmtDays(r.days) : <span className="text-muted-foreground">{fmtDays(r.days)}</span> },
        ]} />
      <DrillDownDialog open={drill === 'otd'} onOpenChange={o => !o && setDrill(null)} title="On-time delivery"
        description="SOs with at least one MO where every MO is Done in Odoo (invoicing and delivery don't matter), completed in the period. Ready date = last Packaging entry in LaborTrax across all MOs + 1 day; if none, the latest MO finish date in Odoo. Compared with the original delivery date."
        rows={otd?.rows ?? []} rowKey={r => r.name}
        columns={[
          { header: 'SO', cell: r => r.name }, { header: 'Customer', cell: r => r.partner ?? '—' }, { header: 'MOs', align: 'right', cell: r => r.mo_names.length },
          { header: 'Original due', cell: r => r.original_delivery ?? '—' },
          { header: 'Ready', cell: r => r.completed_on ? <>{r.completed_on}<span className="ml-1 text-[10px] text-muted-foreground">{r.ready_date ? 'Packaging' : r.mos_done_date ? 'MO done' : 'Delivered'}</span></> : '—' },
          { header: 'Result', cell: r => r.onTime == null ? <span className="text-muted-foreground">not scored</span> : r.onTime ? <span className="text-success">On time</span> : <span className="text-destructive">{r.lateDays}d late</span> },
        ]} />
    </div>
  );
}
