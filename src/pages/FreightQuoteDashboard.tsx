import { useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/AppLayout';
import { FqHeader } from '@/components/freight-quotes/FqHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import { computeQuote, runningAverages } from '@/lib/freight-quotes/calculations';
import { laneOf, loadQuotes, loadRefs, usd } from '@/lib/freight-quotes/data';

const ALL = '__all';
const COLORS = { fob: 'hsl(var(--chart-1, var(--primary)))', cif: 'hsl(var(--chart-2, var(--warning)))', ddp: 'hsl(var(--chart-3, var(--destructive)))' };

export default function FreightQuoteDashboard() {
  const [quotes, setQuotes] = useState<Awaited<ReturnType<typeof loadQuotes>>>([]);
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof loadRefs>> | null>(null);
  const [f, setF] = useState({ lane: ALL, country: ALL, mode: ALL, vendor: ALL, customer: ALL, product: ALL, from: '', to: '', cbmMin: '', cbmMax: '' });
  const [incRejected, setIncRejected] = useState(false);
  const [method, setMethod] = useState<'simple' | 'weighted'>('weighted');
  const [rolling, setRolling] = useState(false);

  useEffect(() => { Promise.all([loadQuotes(), loadRefs()]).then(([q, r]) => { setQuotes(q); setRefs(r); }); }, []);
  const name = (list: { id: string; name: string }[] = [], id: string | null) => list.find(x => x.id === id)?.name || '—';

  const all = useMemo(() => quotes.map(q => ({ q, t: computeQuote(q, q.lines), lane: laneOf(q) })), [quotes]);
  const scoped = all.filter(({ q, lane }) => {
    if (!incRejected && q.status === 'rejected') return false;
    if (f.lane !== ALL && lane !== f.lane) return false;
    if (f.country !== ALL && q.destination_country !== f.country) return false;
    if (f.mode !== ALL && q.mode !== f.mode) return false;
    if (f.vendor !== ALL && q.vendor_id !== f.vendor) return false;
    if (f.customer !== ALL && q.customer_id !== f.customer) return false;
    if (f.product !== ALL && q.product_id !== f.product) return false;
    if (f.from && (q.quote_date || '') < f.from) return false;
    if (f.to && (q.quote_date || '') > f.to) return false;
    if (f.cbmMin && Number(q.cbm || 0) < Number(f.cbmMin)) return false;
    if (f.cbmMax && Number(q.cbm || 0) > Number(f.cbmMax)) return false;
    return true;
  });
  const excluded = scoped.filter(x => x.t.unpriced_count > 0 || !Number(x.q.cbm) || !x.q.quote_date);
  const usable = scoped.filter(x => !excluded.includes(x));

  const points = usable.map(({ q, t }) => ({ date: q.quote_date!, cbm: Number(q.cbm), fob: t.per_cbm.fob, cif: t.per_cbm.cif, ddp: t.per_cbm.ddp, fobUsd: t.fob_usd, cifUsd: t.cif_usd, ddpUsd: t.ddp_usd }));
  const series = runningAverages(points, method, rolling);

  const avgOf = (rows: typeof usable) => {
    const agg = (k: 'fob' | 'cif' | 'ddp') => {
      if (!rows.length) return null;
      if (method === 'weighted') { const c = rows.reduce((s, r) => s + Number(r.q.cbm), 0); return c ? rows.reduce((s, r) => s + (k === 'fob' ? r.t.fob_usd : k === 'cif' ? r.t.cif_usd : r.t.ddp_usd), 0) / c : null; }
      return rows.reduce((s, r) => s + (r.t.per_cbm[k] || 0), 0) / rows.length;
    };
    return { n: rows.length, fob: agg('fob'), cif: agg('cif'), ddp: agg('ddp') };
  };
  const today = new Date();
  const ago = (d: number) => new Date(today.getTime() - d * 864e5).toISOString().slice(0, 10);
  const inRange = (a: string, b: string) => usable.filter(x => x.q.quote_date! > a && x.q.quote_date! <= b);
  const periods = [
    { label: 'All time', cur: avgOf(usable), prev: null as ReturnType<typeof avgOf> | null },
    { label: 'Last 90 days', cur: avgOf(inRange(ago(90), ago(0))), prev: avgOf(inRange(ago(180), ago(90))) },
    { label: 'Last 12 months', cur: avgOf(inRange(ago(365), ago(0))), prev: avgOf(inRange(ago(730), ago(365))) },
  ];
  const delta = (c: number | null, p: number | null | undefined) => (c == null || !p ? null : ((c - p) / p) * 100);

  const table = (key: (x: typeof usable[number]) => string) => {
    const g: Record<string, typeof usable> = {};
    usable.forEach(x => { (g[key(x)] ||= []).push(x); });
    return Object.entries(g).map(([k, rows]) => ({ k, ...avgOf(rows), last: rows.map(r => r.q.quote_date!).sort().pop() })).sort((a, b) => b.n - a.n);
  };
  const vendorRows = table(x => name(refs?.vendors, x.q.vendor_id));
  const laneRows = table(x => x.lane);

  const F = (k: keyof typeof f, label: string, opts: { v: string; l: string }[]) => (
    <Select value={f[k]} onValueChange={v => setF({ ...f, [k]: v })}>
      <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value={ALL}>All {label}</SelectItem>{opts.map(o => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
    </Select>
  );
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort().map(v => ({ v, l: v }));

  const CompTable = ({ title, rows }: { title: string; rows: typeof vendorRows }) => (
    <Card><CardContent className="p-2">
      <div className="text-xs font-semibold mb-1">{title}</div>
      <table className="w-full text-xs"><thead className="text-[10px] uppercase text-muted-foreground"><tr><th className="text-left">{title.split(' ')[0]}</th><th className="text-right">Quotes</th><th className="text-right">FOB/CBM</th><th className="text-right">CIF/CBM</th><th className="text-right">DDP/CBM</th><th className="text-right">Last quote</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.k} className="border-t"><td className="py-1">{r.k}</td><td className="text-right">{r.n}</td><td className="text-right font-mono">{usd(r.fob, 2)}</td><td className="text-right font-mono">{usd(r.cif, 2)}</td><td className="text-right font-mono">{usd(r.ddp, 2)}</td><td className="text-right">{r.last}</td></tr>)}</tbody></table>
    </CardContent></Card>
  );

  return (
    <AppLayout>
      <div className="p-3 md:p-4 max-w-[1600px] mx-auto space-y-3">
        <FqHeader title="Freight quote dashboard" />
        <div className="flex flex-wrap gap-2 items-center">
          {F('lane', 'lanes', uniq(all.map(x => x.lane)))}
          {F('country', 'countries', uniq(all.map(x => x.q.destination_country)))}
          {F('mode', 'modes', ['LCL', 'FCL', 'air'].map(v => ({ v, l: v })))}
          {F('vendor', 'vendors', (refs?.vendors || []).map(v => ({ v: v.id, l: v.name })))}
          {F('customer', 'customers', (refs?.customers || []).map(v => ({ v: v.id, l: v.name })))}
          {F('product', 'products', (refs?.products || []).map(v => ({ v: v.id, l: v.name })))}
          <Input type="date" className="h-8 text-xs w-36" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} />
          <Input type="date" className="h-8 text-xs w-36" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} />
          <Input type="number" placeholder="CBM min" className="h-8 text-xs w-24" value={f.cbmMin} onChange={e => setF({ ...f, cbmMin: e.target.value })} />
          <Input type="number" placeholder="CBM max" className="h-8 text-xs w-24" value={f.cbmMax} onChange={e => setF({ ...f, cbmMax: e.target.value })} />
          <Label className="flex items-center gap-1 text-xs"><Checkbox checked={incRejected} onCheckedChange={v => setIncRejected(!!v)} />Include rejected</Label>
        </div>
        {excluded.length > 0 && <p className="text-[11px] text-muted-foreground">{excluded.length} excluded (unpriced "at actuals" charges without an estimate, or missing CBM/date).</p>}

        <div className="grid md:grid-cols-3 gap-2">
          {periods.map(p => (
            <Card key={p.label}><CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground">{p.label} · {p.cur.n} quotes</div>
              <div className="grid grid-cols-3 gap-1 mt-1">
                {(['fob', 'cif', 'ddp'] as const).map(k => {
                  const d = delta(p.cur[k], p.prev?.[k]);
                  return (
                    <div key={k}>
                      <div className="text-[10px] uppercase text-muted-foreground">{k}/CBM</div>
                      <div className="font-mono text-sm font-semibold">{usd(p.cur[k], 0)}</div>
                      {p.prev && <div className={d == null ? 'text-[10px] text-muted-foreground' : d > 0 ? 'text-[10px] text-destructive' : 'text-[10px] text-success'}>{d == null ? 'no prior' : `${d > 0 ? '+' : ''}${d.toFixed(1)}% vs prior`}</div>}
                    </div>
                  );
                })}
              </div>
            </CardContent></Card>
          ))}
        </div>

        <Card><CardContent className="p-3">
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <span className="text-xs font-semibold">$/CBM over time</span>
            <ToggleGroup type="single" size="sm" value={method} onValueChange={v => v && setMethod(v as any)}>
              <ToggleGroupItem value="weighted" className="text-xs h-7">Weighted (ΣUSD/ΣCBM)</ToggleGroupItem>
              <ToggleGroupItem value="simple" className="text-xs h-7">Simple avg</ToggleGroupItem>
            </ToggleGroup>
            <Label className="flex items-center gap-1 text-xs"><Checkbox checked={rolling} onCheckedChange={v => setRolling(!!v)} />Rolling 90-day</Label>
          </div>
          <div className="h-[340px]">
            <ResponsiveContainer>
              <ComposedChart data={series} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={{ fontSize: 10 }} tickFormatter={v => new Date(v).toISOString().slice(0, 10)} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${v}`} />
                <Tooltip labelFormatter={v => new Date(v as number).toISOString().slice(0, 10)} formatter={(v: any) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="avgFob" name="FOB avg" stroke={COLORS.fob} dot={false} strokeWidth={2} connectNulls />
                <Line dataKey="avgCif" name="CIF avg" stroke={COLORS.cif} dot={false} strokeWidth={2} connectNulls />
                <Line dataKey="avgDdp" name="DDP avg" stroke={COLORS.ddp} dot={false} strokeWidth={2} connectNulls />
                <Scatter dataKey="fob" name="FOB quote" fill={COLORS.fob} legendType="circle" />
                <Scatter dataKey="cif" name="CIF quote" fill={COLORS.cif} legendType="circle" />
                <Scatter dataKey="ddp" name="DDP quote" fill={COLORS.ddp} legendType="circle" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent></Card>

        <div className="grid lg:grid-cols-2 gap-3">
          <CompTable title="Vendor comparison" rows={vendorRows} />
          <CompTable title="Lane comparison" rows={laneRows} />
        </div>
      </div>
    </AppLayout>
  );
}
