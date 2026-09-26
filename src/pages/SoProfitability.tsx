import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/AppLayout';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronRight, RefreshCw, AlertTriangle, TrendingUp, Package, Hammer, Layers, Truck } from 'lucide-react';
import { statusToneClass } from '@/lib/status-tone';
import { cn } from '@/lib/utils';
import {
  type SoOrder, type DisplayCurrency, summarize, marginTone, toDisplay, orderPnl, analyzeLines, moStats, type MoStats,
} from '@/lib/so-profitability';

const ALL = '__all__';
const DEFAULT_SHIP_ACCT = 170;
const CACHE_KEY = 'so-profitability-cache';
const ACCT_KEY = 'so-profitability-shipping-account';

export default function SoProfitability() {
  useDocumentTitle('SO Profitability');
  const today = new Date();
  const yearAgo = new Date(today); yearAgo.setFullYear(today.getFullYear() - 1);
  const [from, setFrom] = useState(yearAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const [search, setSearch] = useState('');
  const [sku, setSku] = useState(ALL);
  const [cur, setCur] = useState<DisplayCurrency>('USD');
  const [fx, setFx] = useState(83.5);
  const [orders, setOrders] = useState<SoOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [shipAcct, setShipAcct] = useState(() => Number(sessionStorage.getItem(ACCT_KEY)) || DEFAULT_SHIP_ACCT);
  const [skipped, setSkipped] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = async (force = false) => {
    if (!force) {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          const c = JSON.parse(cached);
          setOrders(c.orders ?? []); setSkipped(c.skipped ?? 0); setFetchedAt(c.fetched_at ?? null);
          if (c.fx > 1) setFx(c.fx);
          return;
        }
      } catch { /* ignore */ }
    }
    setLoading(true); setError(null);
    const { data, error } = await supabase.functions.invoke('odoo-profitability', {
      body: { date_from: from || null, date_to: to || null, shipping_account_id: shipAcct || null },
    });
    setLoading(false);
    if (error || data?.error) {
      let msg = data?.error || error?.message || 'Could not load from Odoo';
      try { const b = await (error as any)?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* noop */ }
      setError(typeof msg === 'string' ? msg : 'Could not load from Odoo');
      return;
    }
    const nextFx = data.inr_per_usd && data.inr_per_usd > 1 ? Math.round(data.inr_per_usd * 100) / 100 : fx;
    setOrders(data.orders ?? []);
    setSkipped(data.skipped_open_projects ?? 0);
    setFetchedAt(data.fetched_at ?? null);
    setFx(nextFx);
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        orders: data.orders ?? [], skipped: data.skipped_open_projects ?? 0, fetched_at: data.fetched_at, fx: nextFx,
      }));
      sessionStorage.setItem(ACCT_KEY, String(shipAcct || DEFAULT_SHIP_ACCT));
    } catch { /* ignore */ }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const skuOptions = useMemo(() => {
    const m = new Map<string, string>();
    orders.forEach(o => o.mos.forEach(mo => { const k = mo.sku || mo.product_name || ''; if (k) m.set(k, mo.product_name || k); }));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter(o => {
      if (q && !(`${o.name} ${o.customer ?? ''} ${o.project_name ?? ''}`.toLowerCase().includes(q))) return false;
      if (sku !== ALL && !o.mos.some(mo => (mo.sku || mo.product_name) === sku)) return false;
      return true;
    });
  }, [orders, search, sku]);

  const fmt = (n: number) => `${cur === 'USD' ? '$' : '₹'}${n.toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { maximumFractionDigits: cur === 'USD' ? 2 : 0, minimumFractionDigits: cur === 'USD' ? 2 : 0 })}`;
  const inr = (n: number) => fmt(toDisplay(n, 'INR', cur, fx));

  const totals = useMemo(() => filtered.reduce((t, o) => {
    const p = orderPnl(o, cur, fx);
    t.revenue += p.revenue; t.cost += p.cost; t.gross += p.gross; return t;
  }, { revenue: 0, cost: 0, gross: 0 }), [filtered, cur, fx]);
  const gpmPct = totals.revenue > 0 ? (totals.gross / totals.revenue) * 100 : 0;
  const npmPct = totals.revenue > 0 ? ((totals.revenue - totals.cost) / totals.revenue) * 100 : 0;

  // MO-run comparison for the selected SKU
  const moRuns = useMemo(() => {
    if (sku === ALL) return [];
    return filtered.flatMap(o => o.mos.filter(mo => (mo.sku || mo.product_name) === sku).map(mo => {
      const s = summarize(o, cur, fx, new Set([mo.id]));
      const cost = s.materials + s.direct + s.overhead;
      return { so: o.name, mo, s, cost, perUnit: mo.qty > 0 ? cost / mo.qty : 0 };
    }));
  }, [filtered, sku, cur, fx]);

  const toggle = (id: number) => setOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-lg font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Sales Order Profitability</h1>
          <Button size="sm" variant="outline" onClick={() => load(true)} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loading && 'animate-spin')} /> Refresh from Odoo
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><div className="text-[10px] uppercase text-muted-foreground">Search</div>
            <Input className="h-8 w-56" placeholder="SO #, customer, project" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="space-y-1"><div className="text-[10px] uppercase text-muted-foreground">Finished SKU</div>
            <Select value={sku} onValueChange={setSku}>
              <SelectTrigger className="h-8 w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All products</SelectItem>
                {skuOptions.map(([k, n]) => <SelectItem key={k} value={k}>{k}{n !== k ? ` — ${n}` : ''}</SelectItem>)}
              </SelectContent>
            </Select></div>
          <div className="space-y-1"><div className="text-[10px] uppercase text-muted-foreground">From</div>
            <Input type="date" className="h-8 w-36" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div className="space-y-1"><div className="text-[10px] uppercase text-muted-foreground">To</div>
            <Input type="date" className="h-8 w-36" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="space-y-1"><div className="text-[10px] uppercase text-muted-foreground">Shipping account ID</div>
            <Input type="number" className="h-8 w-32" value={shipAcct}
              onChange={e => setShipAcct(Number(e.target.value) || 0)} placeholder={String(DEFAULT_SHIP_ACCT)} /></div>
          <Button size="sm" className="h-8" onClick={() => load(true)} disabled={loading}>Apply</Button>
          <div className="ml-auto flex items-end gap-2">
            <div className="space-y-1"><div className="text-[10px] uppercase text-muted-foreground">₹ per $</div>
              <Input type="number" step="0.01" className="h-8 w-24" value={fx} onChange={e => setFx(Number(e.target.value) || 0)} /></div>
            <div className="inline-flex rounded-md border p-0.5">
              {(['USD', 'INR'] as const).map(c => (
                <Button key={c} size="sm" variant={cur === c ? 'default' : 'ghost'} className="h-7 px-3" onClick={() => setCur(c)}>
                  {c === 'USD' ? 'USD ($)' : 'INR (₹)'}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <Card className="border-destructive/40"><CardContent className="p-3 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </CardContent></Card>
        )}

        <div className="text-[11px] text-muted-foreground">
          Only orders whose manufacturing orders are all finished or cancelled appear here, because material usage is booked at completion. GPM counts materials only; NPM also counts labour, overhead and shipping.
          {skipped > 0 && ` ${skipped} order${skipped === 1 ? '' : 's'} still in production hidden.`}
          {fetchedAt && ` Data from Odoo at ${new Date(fetchedAt).toLocaleString()}.`}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Orders" value={String(filtered.length)} />
          <Stat label="Revenue" value={fmt(totals.revenue)} />
          <Stat label="Total cost" value={fmt(totals.cost)} />
          <Stat label="GPM / NPM" value={`${gpmPct.toFixed(1)}% · ${npmPct.toFixed(1)}% (${fmt(totals.revenue - totals.cost)})`} />
        </div>

        {moRuns.length > 0 && (
          <Card><CardContent className="p-3 space-y-2">
            <div className="text-sm font-medium">MO runs for {sku}</div>
            <Table>
              <TableHeader><TableRow>
                <TableHead className="h-8 text-xs">SO</TableHead><TableHead className="h-8 text-xs">MO</TableHead>
                <TableHead className="h-8 text-xs">State</TableHead><TableHead className="h-8 text-xs text-right">Qty</TableHead>
                <TableHead className="h-8 text-xs text-right">Materials</TableHead><TableHead className="h-8 text-xs text-right">Labour + overhead</TableHead>
                <TableHead className="h-8 text-xs text-right">Cost</TableHead><TableHead className="h-8 text-xs text-right">Cost / unit</TableHead>
              </TableRow></TableHeader>
              <TableBody>{moRuns.map(r => (
                <TableRow key={r.mo.id}>
                  <TableCell className="py-1.5 text-xs">{r.so}</TableCell><TableCell className="py-1.5 text-xs">{r.mo.name}</TableCell>
                  <TableCell className="py-1.5 text-xs">{r.mo.state}</TableCell>
                  <TableCell className="py-1.5 text-xs text-right tabular-nums">{r.mo.qty}</TableCell>
                  <TableCell className="py-1.5 text-xs text-right tabular-nums">{fmt(r.s.materials)}</TableCell>
                  <TableCell className="py-1.5 text-xs text-right tabular-nums">{fmt(r.s.direct + r.s.overhead)}</TableCell>
                  <TableCell className="py-1.5 text-xs text-right tabular-nums">{fmt(r.cost)}</TableCell>
                  <TableCell className="py-1.5 text-xs text-right tabular-nums font-medium">{fmt(r.perUnit)}</TableCell>
                </TableRow>))}
              </TableBody>
            </Table>
            <p className="text-[10px] text-muted-foreground">Per-run costs exclude shipping, which is booked to the whole project.</p>
          </CardContent></Card>
        )}

        <Card><div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="h-8 w-6" />
              <TableHead className="h-8 text-xs">Order date</TableHead><TableHead className="h-8 text-xs">SO #</TableHead>
              <TableHead className="h-8 text-xs">Customer</TableHead><TableHead className="h-8 text-xs">Project</TableHead>
              <TableHead className="h-8 text-xs text-right">Revenue</TableHead><TableHead className="h-8 text-xs text-right">Total cost</TableHead>
              <TableHead className="h-8 text-xs text-right">Net profit</TableHead>
              <TableHead className="h-8 text-xs text-right">GPM</TableHead><TableHead className="h-8 text-xs text-right">NPM</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading && orders.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">Loading from Odoo…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">No sales orders found.</TableCell></TableRow>}
              {filtered.map(o => {
                const p = orderPnl(o, cur, fx);
                const isOpen = open.has(o.id);
                return (
                  <Fragment key={o.id}>
                    <TableRow className="cursor-pointer" onClick={() => toggle(o.id)}>
                      <TableCell className="py-2">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</TableCell>
                      <TableCell className="py-2 text-xs tabular-nums">{o.date_order?.slice(0, 10)}</TableCell>
                      <TableCell className="py-2 text-xs font-medium">{o.name}</TableCell>
                      <TableCell className="py-2 text-xs">{o.customer}</TableCell>
                      <TableCell className="py-2 text-xs">{o.project_name ?? <span className="text-muted-foreground">No project</span>}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{fmt(p.revenue)}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{fmt(p.cost)}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{fmt(p.net)}</TableCell>
                      <TableCell className="py-2 text-xs text-right"><Badge variant="outline" className={cn('text-[10px] tabular-nums', statusToneClass(marginTone(p.gpm)))}>{p.gpm.toFixed(1)}%</Badge></TableCell>
                      <TableCell className="py-2 text-xs text-right"><Badge variant="outline" className={cn('text-[10px] tabular-nums', statusToneClass(marginTone(p.npm)))}>{p.npm.toFixed(1)}%</Badge></TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent"><TableCell colSpan={10} className="bg-muted/30 p-3">
                        <OrderDetail o={o} fmt={fmt} inr={inr} cur={cur} fx={fx} />
                      </TableCell></TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div></Card>
      </div>
    </AppLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <Card><CardContent className="p-3"><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className="text-sm font-semibold tabular-nums">{value}</div></CardContent></Card>;
}

type Fmt = (n: number) => string;
const H = ({ cols }: { cols: string[] }) => (
  <TableRow className="bg-muted/40 hover:bg-muted/40">
    {cols.map((h, i) => <TableHead key={h} className={cn('h-7 text-[11px]', i >= 1 && 'text-right')}>{h}</TableHead>)}
  </TableRow>
);
const C = ({ children, left, bold }: { children: React.ReactNode; left?: boolean; bold?: boolean }) => (
  <TableCell className={cn('py-1 text-xs tabular-nums', !left && 'text-right', bold && 'font-semibold')}>{children}</TableCell>
);
const n3 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
const pctOf = (v: number, t: number) => (t > 0 ? `${((v / t) * 100).toFixed(1)}%` : '—');

function OrderDetail({ o, fmt, inr, cur, fx }: { o: SoOrder; fmt: Fmt; inr: Fmt; cur: DisplayCurrency; fx: number }) {
  const hasMo = o.mos.length > 0;
  const s = summarize(o, cur, fx);
  const share = (v: number) => (s.totalCost > 0 ? `${((v / s.totalCost) * 100).toFixed(1)}%` : '—');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Pillar icon={Package} label="Raw materials" value={fmt(s.materials)} share={share(s.materials)}
          sub={`${s.materialCount} items`} alert={s.zeroCostCount > 0 ? `${s.zeroCostCount} with ₹0 cost` : undefined} />
        <Pillar icon={Hammer} label="Direct labour" value={fmt(s.direct)} share={share(s.direct)} sub={`${s.hours.toFixed(1)} hrs logged`} />
        <Pillar icon={Layers} label="Overhead burden" value={fmt(s.overhead)} share={share(s.overhead)} sub={`Fully burdened ${fmt(s.burdened)}`} />
        <Pillar icon={Truck} label="Shipping & freight" value={fmt(s.shipping)} share={share(s.shipping)} sub={`${s.shippingCount} entries`} />
      </div>
      <Tabs defaultValue={hasMo ? 'mo' : 'so'}>
        <TabsList className="h-8">
          <TabsTrigger value="mo" className="text-xs" disabled={!hasMo}>MO{!hasMo && ' (none)'}</TabsTrigger>
          <TabsTrigger value="so" className="text-xs">SO</TabsTrigger>
        </TabsList>
        {hasMo && <TabsContent value="mo"><MoTab o={o} inr={inr} /></TabsContent>}
        <TabsContent value="so"><SoTab o={o} fmt={fmt} cur={cur} fx={fx} /></TabsContent>
      </Tabs>
    </div>
  );
}

function MoTab({ o, inr }: { o: SoOrder; inr: Fmt }) {
  const [openMo, setOpenMo] = useState<Set<number>>(new Set());
  const stats = o.mos.map(m => moStats(o, m));
  const toggle = (id: number) => setOpenMo(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <Table>
      <TableHeader><TableRow>
        <TableHead className="h-7 w-6" />
        {['MO', 'Product', 'Produced', 'Material cost', 'Direct labour', 'Overhead burden', 'Total MO cost', 'Cost / unit'].map((h, i) =>
          <TableHead key={h} className={cn('h-7 text-xs', i >= 2 && 'text-right')}>{h}</TableHead>)}
      </TableRow></TableHeader>
      <TableBody>
        {stats.map(st => {
          const isOpen = openMo.has(st.mo.id);
          return (
            <Fragment key={st.mo.id}>
              <TableRow className="cursor-pointer" onClick={() => toggle(st.mo.id)}>
                <TableCell className="py-1.5">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</TableCell>
                <TableCell className="py-1.5 text-xs font-medium">{st.mo.name}</TableCell>
                <TableCell className="py-1.5 text-xs">{st.mo.sku ? `${st.mo.sku} — ` : ''}{st.mo.product_name}</TableCell>
                <C>{n3(st.produced)}</C><C>{inr(st.materials)}</C><C>{inr(st.direct)}</C><C>{inr(st.overhead)}</C>
                <C bold>{inr(st.total)}</C><C>{inr(st.produced > 0 ? st.total / st.produced : 0)}</C>
              </TableRow>
              {isOpen && (
                <TableRow className="hover:bg-transparent"><TableCell colSpan={9} className="bg-background p-2">
                  <MoDetail o={o} st={st} inr={inr} />
                </TableCell></TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

function MoDetail({ o, st, inr }: { o: SoOrder; st: MoStats; inr: Fmt }) {
  const mats = o.materials.filter(m => m.mo_id === st.mo.id);
  const lab = o.labor.filter(l => l.mo_id === st.mo.id);
  const byWo = new Map<string, { hours: number; direct: number }>();
  for (const l of lab) {
    const k = l.category || 'Uncategorised';
    const g = byWo.get(k) ?? { hours: 0, direct: 0 };
    g.hours += l.hours; g.direct += l.direct_inr; byWo.set(k, g);
  }
  const q = st.produced;
  const per = (v: number) => (q > 0 ? v / q : 0);
  const T = st.total;
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1"><Package className="h-3 w-3" /> Materials</div>
      <Table className="table-fixed">
        <TableHeader><H cols={['Component', 'Component usage', 'Usage / product', 'Units', 'Standard cost', 'Total cost', 'Cost / product', '% of product cost']} /></TableHeader>
        <TableBody>
          {mats.length === 0 && <TableRow><TableCell colSpan={8} className="text-xs text-muted-foreground text-center py-3">No material moves.</TableCell></TableRow>}
          {mats.map((m, i) => (
            <TableRow key={i}>
              <C left>{m.sku ? `${m.sku} — ` : ''}{m.name}{m.total_inr <= 0 && <Badge variant="outline" className={cn('ml-1 text-[10px]', statusToneClass('issue'))}>₹0</Badge>}</C>
              <C>{n3(m.actual_qty)}</C><C>{n3(per(m.actual_qty))}</C><C>{m.uom ?? '—'}</C>
              <C>{inr(m.unit_price_inr)}</C><C>{inr(m.total_inr)}</C><C>{inr(per(m.total_inr))}</C><C>{pctOf(m.total_inr, T)}</C>
            </TableRow>))}
          <TableRow><C left bold>Materials total</C><C>{''}</C><C>{''}</C><C>{''}</C><C>{''}</C><C bold>{inr(st.materials)}</C><C bold>{inr(per(st.materials))}</C><C bold>{pctOf(st.materials, T)}</C></TableRow>
        </TableBody>
      </Table>

      <div className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1 pt-1"><Hammer className="h-3 w-3" /> Direct labour</div>
      <Table className="table-fixed">
        <TableHeader><H cols={['Work order', 'Man hours', 'Man hours / product', 'Units', 'Avg cost / hr', 'Labour cost', 'Labour cost / product', '% of product cost']} /></TableHeader>
        <TableBody>
          {byWo.size === 0 && <TableRow><TableCell colSpan={8} className="text-xs text-muted-foreground text-center py-3">No LaborTrax entries.</TableCell></TableRow>}
          {[...byWo.entries()].sort((a, b) => b[1].direct - a[1].direct).map(([k, g]) => (
            <TableRow key={k}>
              <C left>{k}</C><C>{g.hours.toFixed(2)}</C><C>{per(g.hours).toFixed(3)}</C><C>hrs</C>
              <C>{inr(g.hours > 0 ? g.direct / g.hours : 0)}</C><C>{inr(g.direct)}</C><C>{inr(per(g.direct))}</C><C>{pctOf(g.direct, T)}</C>
            </TableRow>))}
          <TableRow><C left bold>Labour total</C><C bold>{st.hours.toFixed(2)}</C><C bold>{per(st.hours).toFixed(3)}</C><C>hrs</C>
            <C bold>{inr(st.hours > 0 ? st.direct / st.hours : 0)}</C><C bold>{inr(st.direct)}</C><C bold>{inr(per(st.direct))}</C><C bold>{pctOf(st.direct, T)}</C></TableRow>
        </TableBody>
      </Table>

      <div className="text-[11px] font-semibold uppercase text-muted-foreground flex items-center gap-1 pt-1"><Layers className="h-3 w-3" /> Overhead burden</div>
      <Table className="table-fixed">
        <TableBody>
          <TableRow>
            <C left>Allocated overhead (fully burdened − direct)</C><C>{''}</C><C>{''}</C><C>{''}</C><C>{''}</C>
            <C bold>{inr(st.overhead)}</C><C bold>{inr(per(st.overhead))}</C><C bold>{pctOf(st.overhead, T)}</C>
          </TableRow>
          <TableRow>
            <C left>Fully burdened labour (direct + overhead)</C><C>{''}</C><C>{''}</C><C>{''}</C><C>{''}</C>
            <C>{inr(st.direct + st.overhead)}</C><C>{inr(per(st.direct + st.overhead))}</C><C>{pctOf(st.direct + st.overhead, T)}</C>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function SoTab({ o, fmt, cur, fx }: { o: SoOrder; fmt: Fmt; cur: DisplayCurrency; fx: number }) {
  const rows = analyzeLines(o, cur, fx);
  const p = orderPnl(o, cur, fx);
  const cols = ['Product', 'Qty sold', 'Unit material', 'Unit direct labour', 'Unit overhead', 'Unit MO cost', 'Unit shipping (est.)',
    'Unit total cost', 'Unit price', 'Unit gross profit', 'Unit net profit', 'Total revenue', 'Total gross profit', 'Total net profit'];
  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>{cols.map((h, i) => <TableHead key={h} className={cn('h-7 text-[11px] whitespace-nowrap', i >= 1 && 'text-right')}>{h}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={14} className="text-xs text-muted-foreground text-center py-4">No product lines on this sales order.</TableCell></TableRow>}
            {rows.map((r, i) => (
              <TableRow key={i}>
                <C left>{r.line.sku ? `${r.line.sku} — ` : ''}{r.line.name}{!r.fromMo && <span className="ml-1 text-[10px] text-muted-foreground">standard cost</span>}</C>
                <C>{n3(r.line.qty)}</C><C>{fmt(r.unitMaterial)}</C><C>{fmt(r.unitDirect)}</C><C>{fmt(r.unitOverhead)}</C>
                <C>{fmt(r.unitMo)}</C><C>{fmt(r.unitShipping)}</C><C bold>{fmt(r.unitTotal)}</C><C>{fmt(r.unitPrice)}</C>
                <C>{fmt(r.unitGross)}</C><C>{fmt(r.unitNet)}</C><C>{fmt(r.revenue)}</C><C>{fmt(r.gross)}</C>
                <TableCell className={cn('py-1 text-xs tabular-nums text-right font-semibold', r.net < 0 && 'text-destructive')}>{fmt(r.net)}</TableCell>
              </TableRow>))}
            {rows.length > 0 && (
              <TableRow>
                <C left bold>Total</C>{Array.from({ length: 10 }).map((_, i) => <C key={i}>{''}</C>)}
                <C bold>{fmt(p.revenue)}</C><C bold>{fmt(p.gross)}</C><C bold>{fmt(p.net)}</C>
              </TableRow>)}
          </TableBody>
        </Table>
      </div>
      <p className="text-[10px] text-muted-foreground">Unit costs are per unit produced in the MO, times quantity sold. Shipping is split by product volume × quantity. Products without an MO use their Odoo standard cost.</p>
    </div>
  );
}

function Pillar({ icon: Icon, label, value, share, sub, alert }: { icon: typeof Package; label: string; value: string; share: string; sub: string; alert?: string }) {
  return (
    <Card><CardContent className="p-3 space-y-0.5">
      <div className="flex items-center justify-between text-[10px] uppercase text-muted-foreground"><span className="flex items-center gap-1"><Icon className="h-3 w-3" />{label}</span><span>{share}</span></div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
      {alert && <Badge variant="outline" className={cn('text-[10px]', statusToneClass('issue'))}><AlertTriangle className="h-3 w-3 mr-1" />{alert}</Badge>}
    </CardContent></Card>
  );
}
