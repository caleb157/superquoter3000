import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  buildPipeline, pipelineCashItems, nextMonths, monthLabel, fyBounds, cashflowTable, CASH_ROWS, fmtMoney, pickAmt,
  type Ccy, type Snapshot, type CashItem, type PipelineInquiry,
} from '@/lib/master-analytics';

type Props = {
  snapshot: Snapshot | null; ccy: Ccy; hqRate: number;
  includePipeline: boolean; setIncludePipeline: (v: boolean) => void;
  overheadMonths: number; setOverheadMonths: (n: number) => void;
  openingCash: number; setOpeningCash: (n: number) => void;
};

export function ProjectionsZone(p: Props) {
  const { snapshot, ccy, hqRate, includePipeline } = p;
  const [pipe, setPipe] = useState<PipelineInquiry[]>([]);
  const [capacity, setCapacity] = useState(0);
  const [cell, setCell] = useState<{ title: string; items: CashItem[] } | null>(null);
  const [fyOpen, setFyOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [inq, lab] = await Promise.all([
        supabase.from('customer_rfqs').select('id, rfq_number, title, status, customers(name), inquiry_projections(*), products(design_stage, quote_stage, sample_stage, archived_at)'),
        (supabase as any).from('labor_employees').select('num_laborers, available_hours_per_month'),
      ]);
      setPipe(buildPipeline(((inq.data as any[]) || []).map(i => ({ ...i, products: (i.products || []).filter((x: any) => !x.archived_at) }))));
      setCapacity(((lab.data as any[]) || []).reduce((s, r) => s + (Number(r.num_laborers) || 0) * (Number(r.available_hours_per_month) || 0), 0));
    })();
  }, []);

  const today = snapshot?.today ?? new Date().toISOString().slice(0, 10);
  const months = useMemo(() => nextMonths(today, 12), [today]);
  const fy = fyBounds(today);
  const usdToCcy = (usd: number) => (ccy === 'USD' ? usd : usd * hqRate);

  // ---------- FY revenue ----------
  const fyRev = useMemo(() => {
    if (!snapshot) return null;
    const invoiced = snapshot.invoiced.filter(i => i.date && i.date >= fy.start && i.date <= today);
    const pending = snapshot.pending_so_revenue.filter(s => s.date <= fy.end);
    const pipeIn = pipe.filter(x => { const m = (x.revenue_month || '').slice(0, 10); return m && m >= today.slice(0, 7) && m <= fy.end; });
    const a = invoiced.reduce((s, i) => s + pickAmt(i, ccy), 0);
    const b = pending.reduce((s, i) => s + pickAmt(i, ccy), 0);
    const c = pipeIn.reduce((s, x) => s + usdToCcy(x.fob_usd * x.certainty), 0);
    return { invoiced, pending, pipeIn, a, b, c, total: a + b + (includePipeline ? c : 0) };
  }, [snapshot, pipe, ccy, includePipeline, hqRate]);

  // ---------- Capacity ----------
  const capRows = useMemo(() => months.map(m => {
    const booked = snapshot?.booked_hours_by_month?.[m] ?? 0;
    let pipeline = 0;
    if (includePipeline) for (const x of pipe) {
      if (!x.man_hours || !x.start_month) continue;
      const start = x.start_month.slice(0, 7);
      const idx = months.indexOf(m) - months.indexOf(start < months[0] ? months[0] : start);
      if (start <= m && idx >= 0 && idx < x.duration_months) pipeline += (x.man_hours * x.certainty) / x.duration_months;
    }
    return { month: monthLabel(m), booked: Math.round(booked), pipeline: Math.round(pipeline) };
  }), [months, snapshot, pipe, includePipeline]);

  // ---------- Cash ----------
  const cash = useMemo(() => {
    const items = [...(snapshot?.cash_items ?? []), ...(includePipeline ? pipelineCashItems(pipe, hqRate, today) : [])];
    const oh = snapshot ? (ccy === 'USD' ? snapshot.overhead_monthly.inr / (snapshot.inr_per_usd || hqRate) : snapshot.overhead_monthly.inr) : 0;
    const opening = ccy === 'USD' ? p.openingCash / (snapshot?.inr_per_usd || hqRate) : p.openingCash;
    return cashflowTable(items, months, ccy, oh, opening);
  }, [snapshot, pipe, includePipeline, ccy, hqRate, months, p.openingCash]);
  const rows = CASH_ROWS.filter(r => includePipeline || !r.key.startsWith('pipeline'));

  const copyCash = () => {
    const lines = [['', ...months.map(monthLabel)].join('\t')];
    rows.forEach(r => lines.push([r.label, ...months.map(m => Math.round(r.dir * (cash.cells[r.key][m] || 0)))].join('\t')));
    lines.push(['Net flow', ...months.map(m => Math.round(cash.net[m]))].join('\t'));
    lines.push(['Ending balance', ...months.map(m => Math.round(cash.ending[m]))].join('\t'));
    navigator.clipboard.writeText(lines.join('\n')); toast.success('Copied — paste into a spreadsheet');
  };
  const f = (v: number) => fmtMoney(v, ccy);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <Switch id="pipe" checked={includePipeline} onCheckedChange={p.setIncludePipeline} />
          <Label htmlFor="pipe" className="text-sm">Include pipeline orders <span className="text-muted-foreground">(weighted by likelihood)</span></Label>
        </div>
        <span className="text-xs text-muted-foreground">{includePipeline ? `Booked + ${pipe.length} pipeline inquiries` : 'Booked orders only'} · pipeline at HQ rate ₹{hqRate}</span>
      </div>

      {/* FY revenue */}
      <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => fyRev && setFyOpen(true)}>
        <CardContent className="pt-4 pb-3 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div className="col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Projected revenue · {fy.label}</div>
            <div className="text-3xl font-bold tabular-nums">{fyRev ? f(fyRev.total) : '—'}</div>
          </div>
          <Stat label="Invoiced YTD" v={fyRev ? f(fyRev.a) : '—'} />
          <Stat label="Booked, not invoiced" v={fyRev ? f(fyRev.b) : '—'} />
          <Stat label="Pipeline (weighted)" v={fyRev ? f(fyRev.c) : '—'} muted={!includePipeline} />
        </CardContent>
      </Card>

      {/* Capacity */}
      <Card>
        <CardHeader className="pb-1"><CardTitle className="text-sm font-medium">Capacity · man-hours per month</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={capRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="booked" name="Booked MOs (Odoo work orders)" stackId="a" fill="hsl(var(--primary))" />
              {includePipeline && <Bar dataKey="pipeline" name="Pipeline (weighted)" stackId="a" fill="hsl(var(--accent))" />}
              {capacity > 0 && <ReferenceLine y={capacity} stroke="hsl(var(--destructive))" strokeDasharray="4 4" label={{ value: `Capacity ${Math.round(capacity)}`, fontSize: 11, fill: 'hsl(var(--destructive))', position: 'insideTopRight' }} />}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Cash flow */}
      <Card>
        <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm font-medium">Cash flow · next 12 months</CardTitle>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">Opening cash ₹
              <Input type="number" className="h-7 w-28 text-xs" defaultValue={p.openingCash} onBlur={e => p.setOpeningCash(Number(e.target.value) || 0)} />
            </label>
            <label className="flex items-center gap-1.5">Overhead avg of last
              <Input type="number" min={1} max={24} className="h-7 w-14 text-xs" defaultValue={p.overheadMonths} onBlur={e => p.setOverheadMonths(Math.max(1, Math.min(24, Number(e.target.value) || 3)))} /> months
            </label>
            <Button size="sm" variant="outline" className="h-7" onClick={copyCash}><Copy className="h-3 w-3 mr-1" />Copy</Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!snapshot ? <p className="text-sm text-muted-foreground py-6 text-center">Refresh from Odoo & LaborTrax to load actuals.</p> : (
            <Table className="text-xs">
              <TableHeader><TableRow>
                <TableHead className="sticky left-0 bg-card min-w-[190px]" />
                {months.map(m => <TableHead key={m} className="text-right whitespace-nowrap">{monthLabel(m)}</TableHead>)}
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <Fragment key={r.key}>
                    {i === rows.findIndex(x => x.dir === -1) && <TableRow><TableCell colSpan={13} className="py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Outflows</TableCell></TableRow>}
                    <TableRow>
                      <TableCell className="sticky left-0 bg-card">{r.label}</TableCell>
                      {months.map(m => {
                        const v = cash.cells[r.key][m] || 0;
                        const items = cash.detail[`${r.key}|${m}`];
                        return (
                          <TableCell key={m} className={cn('text-right tabular-nums whitespace-nowrap', items && 'cursor-pointer hover:underline', !v && 'text-muted-foreground/50')}
                            onClick={() => items && setCell({ title: `${r.label} · ${monthLabel(m)}`, items })}>
                            {v ? (r.dir === -1 ? '−' : '') + f(v).replace('−', '') : '·'}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </Fragment>
                ))}
                <TableRow className="font-medium border-t-2">
                  <TableCell className="sticky left-0 bg-card">Net flow</TableCell>
                  {months.map(m => <TableCell key={m} className={cn('text-right tabular-nums', cash.net[m] < 0 && 'text-destructive')}>{f(cash.net[m])}</TableCell>)}
                </TableRow>
                <TableRow className="font-semibold">
                  <TableCell className="sticky left-0 bg-card">Ending balance</TableCell>
                  {months.map(m => <TableCell key={m} className={cn('text-right tabular-nums', cash.ending[m] < 0 && 'text-destructive')}>{f(cash.ending[m])}</TableCell>)}
                </TableRow>
              </TableBody>
            </Table>
          )}
          {snapshot && <p className="text-[11px] text-muted-foreground mt-2">
            Overdue items roll to this month (POs to tomorrow). Customer and vendor advances are applied to each partner's earliest items first. Amounts include GST. Click any figure for its line items.
          </p>}
        </CardContent>
      </Card>

      <Dialog open={!!cell} onOpenChange={o => !o && setCell(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle>{cell?.title}</DialogTitle></DialogHeader>
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Partner</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Advance applied</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {cell?.items.slice().sort((a, b) => pickAmt(b, ccy) - pickAmt(a, ccy)).map((it, i) => (
                <TableRow key={i}>
                  <TableCell>{it.ref}</TableCell><TableCell>{it.partner ?? '—'}</TableCell><TableCell>{it.date}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{it.advance_applied_inr ? fmtMoney(it.advance_applied_inr, 'INR') : ''}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(pickAmt(it, ccy) * it.sign, ccy, false)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <Dialog open={fyOpen} onOpenChange={setFyOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle>{fy.label} revenue build-up</DialogTitle></DialogHeader>
          {fyRev && <div className="space-y-4 text-xs">
            <Section title={`Invoiced since ${fy.start} — ${f(fyRev.a)}`} rows={fyRev.invoiced.map(i => [i.ref, i.partner, i.date, fmtMoney(pickAmt(i, ccy), ccy, false)])} />
            <Section title={`Booked SOs not yet invoiced, due by ${fy.end} — ${f(fyRev.b)}`} rows={fyRev.pending.map(i => [i.ref, i.partner, i.date, fmtMoney(pickAmt(i, ccy), ccy, false)])} />
            <Section title={`Pipeline (weighted) — ${f(fyRev.c)}${includePipeline ? '' : ' (excluded)'}`} rows={fyRev.pipeIn.map(x => [x.rfq_number, x.customer, `${Math.round(x.certainty * 100)}%`, fmtMoney(usdToCcy(x.fob_usd * x.certainty), ccy, false)])} />
          </div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, v, muted }: { label: string; v: string; muted?: boolean }) {
  return <div className={cn(muted && 'opacity-40')}><div className="text-[11px] text-muted-foreground">{label}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>;
}
function Section({ title, rows }: { title: string; rows: (string | null)[][] }) {
  return (
    <div>
      <div className="font-medium mb-1">{title}</div>
      {rows.length === 0 ? <div className="text-muted-foreground">None.</div> : (
        <Table><TableBody>{rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j} className={cn('py-1', j === r.length - 1 && 'text-right tabular-nums')}>{c ?? '—'}</TableCell>)}</TableRow>)}</TableBody></Table>
      )}
    </div>
  );
}
