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
  type SoOrder, type DisplayCurrency, summarize, marginTone, groupLaborByMo, toDisplay,
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
    const s = summarize(o, cur, fx);
    t.revenue += s.revenue; t.cost += s.totalCost; return t;
  }, { revenue: 0, cost: 0 }), [filtered, cur, fx]);
  const totalPct = totals.revenue > 0 ? ((totals.revenue - totals.cost) / totals.revenue) * 100 : 0;

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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Orders" value={String(filtered.length)} />
          <Stat label="Revenue" value={fmt(totals.revenue)} />
          <Stat label="Total cost" value={fmt(totals.cost)} />
          <Stat label="Gross margin" value={`${fmt(totals.revenue - totals.cost)} · ${totalPct.toFixed(1)}%`} />
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
              <TableHead className="h-8 text-xs">Status</TableHead>
              <TableHead className="h-8 text-xs text-right">Revenue</TableHead><TableHead className="h-8 text-xs text-right">Total cost</TableHead>
              <TableHead className="h-8 text-xs text-right">Gross margin</TableHead><TableHead className="h-8 text-xs text-right">Margin %</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {loading && orders.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">Loading from Odoo…</TableCell></TableRow>}
              {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">No sales orders found.</TableCell></TableRow>}
              {filtered.map(o => {
                const s = summarize(o, cur, fx);
                const isOpen = open.has(o.id);
                return (
                  <Fragment key={o.id}>
                    <TableRow className="cursor-pointer" onClick={() => toggle(o.id)}>
                      <TableCell className="py-2">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</TableCell>
                      <TableCell className="py-2 text-xs tabular-nums">{o.date_order?.slice(0, 10)}</TableCell>
                      <TableCell className="py-2 text-xs font-medium">{o.name}</TableCell>
                      <TableCell className="py-2 text-xs">{o.customer}</TableCell>
                      <TableCell className="py-2 text-xs">{o.project_name ?? <span className="text-muted-foreground">No project</span>}</TableCell>
                      <TableCell className="py-2 text-xs"><Badge variant="outline" className={cn('text-[10px]', statusToneClass(o.status === 'Completed' ? 'complete' : 'progress'))}>{o.status}</Badge></TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{fmt(s.revenue)}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{fmt(s.totalCost)}</TableCell>
                      <TableCell className="py-2 text-xs text-right tabular-nums">{fmt(s.margin)}</TableCell>
                      <TableCell className="py-2 text-xs text-right"><Badge variant="outline" className={cn('text-[10px] tabular-nums', statusToneClass(marginTone(s.marginPct)))}>{s.marginPct.toFixed(1)}%</Badge></TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow className="hover:bg-transparent"><TableCell colSpan={10} className="bg-muted/30 p-3">
                        <OrderDetail o={o} s={s} fmt={fmt} inr={inr} />
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

function OrderDetail({ o, s, fmt, inr }: { o: SoOrder; s: ReturnType<typeof summarize>; fmt: (n: number) => string; inr: (n: number) => string }) {
  const share = (v: number) => (s.totalCost > 0 ? `${((v / s.totalCost) * 100).toFixed(1)}%` : '—');
  const groups = groupLabor(o.labor);
  const num = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-muted-foreground">
        {o.mos.length} manufacturing order{o.mos.length === 1 ? '' : 's'}: {o.mos.map(m => `${m.name} (${m.sku ?? m.product_name}, ${m.qty}, ${m.state})`).join(' · ') || 'none linked'}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Pillar icon={Package} label="Raw materials" value={fmt(s.materials)} share={share(s.materials)}
          sub={`${s.materialCount} items`} alert={s.zeroCostCount > 0 ? `${s.zeroCostCount} with ₹0 cost` : undefined} />
        <Pillar icon={Hammer} label="Direct labour" value={fmt(s.direct)} share={share(s.direct)} sub={`${s.hours.toFixed(1)} hrs logged`} />
        <Pillar icon={Layers} label="Overhead burden" value={fmt(s.overhead)} share={share(s.overhead)} sub={`Fully burdened ${fmt(s.burdened)}`} />
        <Pillar icon={Truck} label="Shipping & freight" value={fmt(s.shipping)} share={share(s.shipping)} sub={`${s.shippingCount} entries`} />
      </div>
      <Tabs defaultValue="materials">
        <TabsList className="h-8"><TabsTrigger value="materials" className="text-xs">Materials</TabsTrigger><TabsTrigger value="labor" className="text-xs">Labour</TabsTrigger><TabsTrigger value="shipping" className="text-xs">Shipping</TabsTrigger></TabsList>
        <TabsContent value="materials">
          <Table><TableHeader><TableRow>
            {['MO', 'Raw SKU', 'Component', 'Planned', 'Actual', 'Variance', 'Unit price', 'Total'].map((h, i) => <TableHead key={h} className={cn('h-7 text-xs', i >= 3 && 'text-right')}>{h}</TableHead>)}
          </TableRow></TableHeader><TableBody>
            {o.materials.length === 0 && <TableRow><TableCell colSpan={8} className="text-xs text-muted-foreground text-center py-4">No material moves.</TableCell></TableRow>}
            {o.materials.map((m, i) => {
              const v = m.actual_qty - m.planned_qty;
              return (
                <TableRow key={i}>
                  <TableCell className="py-1 text-xs">{m.mo_name}</TableCell>
                  <TableCell className="py-1 text-xs">{m.sku ?? '—'}</TableCell>
                  <TableCell className="py-1 text-xs">{m.name}{m.type === 'consu' && <span className="ml-1 text-[10px] text-muted-foreground">consumable</span>}</TableCell>
                  <TableCell className="py-1 text-xs text-right tabular-nums">{num(m.planned_qty)} {m.uom}</TableCell>
                  <TableCell className="py-1 text-xs text-right tabular-nums">{num(m.actual_qty)}</TableCell>
                  <TableCell className={cn('py-1 text-xs text-right tabular-nums', v > 0 && 'text-destructive')}>{v > 0 ? '+' : ''}{num(v)}</TableCell>
                  <TableCell className="py-1 text-xs text-right tabular-nums">{m.unit_price_inr > 0 ? inr(m.unit_price_inr) : <Badge variant="outline" className={cn('text-[10px]', statusToneClass('issue'))}>₹0 cost</Badge>}</TableCell>
                  <TableCell className="py-1 text-xs text-right tabular-nums">{inr(m.total_inr)}</TableCell>
                </TableRow>);
            })}
          </TableBody></Table>
        </TabsContent>
        <TabsContent value="labor">
          <Table><TableHeader><TableRow>
            {['Category', 'Entries', 'Hours', 'Direct labour', 'Overhead', 'Fully burdened'].map((h, i) => <TableHead key={h} className={cn('h-7 text-xs', i >= 1 && 'text-right')}>{h}</TableHead>)}
          </TableRow></TableHeader><TableBody>
            {groups.length === 0 && <TableRow><TableCell colSpan={6} className="text-xs text-muted-foreground text-center py-4">No LaborTrax entries.</TableCell></TableRow>}
            {groups.map(g => (
              <TableRow key={g.category}>
                <TableCell className="py-1 text-xs font-medium">{g.category}</TableCell>
                <TableCell className="py-1 text-xs text-right tabular-nums">{g.count}</TableCell>
                <TableCell className="py-1 text-xs text-right tabular-nums">{g.hours.toFixed(2)}</TableCell>
                <TableCell className="py-1 text-xs text-right tabular-nums">{inr(g.direct)}</TableCell>
                <TableCell className="py-1 text-xs text-right tabular-nums">{inr(g.overhead)}</TableCell>
                <TableCell className="py-1 text-xs text-right tabular-nums">{inr(g.burdened)}</TableCell>
              </TableRow>))}
          </TableBody></Table>
        </TabsContent>
        <TabsContent value="shipping">
          <Table><TableHeader><TableRow>
            {['Date', 'Description', 'Product', 'Net amount'].map((h, i) => <TableHead key={h} className={cn('h-7 text-xs', i === 3 && 'text-right')}>{h}</TableHead>)}
          </TableRow></TableHeader><TableBody>
            {o.shipping.length === 0 && <TableRow><TableCell colSpan={4} className="text-xs text-muted-foreground text-center py-4">No shipping entries on this project.</TableCell></TableRow>}
            {o.shipping.map((x, i) => (
              <TableRow key={i}>
                <TableCell className="py-1 text-xs tabular-nums">{x.date}</TableCell>
                <TableCell className="py-1 text-xs">{x.name}</TableCell>
                <TableCell className="py-1 text-xs">{x.product ?? '—'}</TableCell>
                <TableCell className={cn('py-1 text-xs text-right tabular-nums', x.net_inr < 0 && 'text-muted-foreground')}>{inr(x.net_inr)}</TableCell>
              </TableRow>))}
          </TableBody></Table>
        </TabsContent>
      </Tabs>
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
