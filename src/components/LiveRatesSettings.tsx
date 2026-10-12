// Settings → Live rates: Odoo exchange rate and LaborTrax labor cost per man-hour
// (src/lib/live-rates.ts), the switch that puts them into costing, and a
// before/after price list for active inquiries so the change can be checked first.
import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { RefreshCw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { avgRateByDesignation } from '@/lib/calculations';
import { LABOR_COLS } from '@/lib/costing-intake';
import { isLiveStale, LIVE_STALE_HOURS, type LiveLaborDetail } from '@/lib/live-rates';
import { syncLiveRates } from '@/lib/live-rates-sync';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { cn } from '@/lib/utils';

const LABOR_TYPES = LABOR_COLS.map(c => c.laborType);
const inr = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const usd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `$${v.toFixed(2)}`);
const ago = (at: string | null | undefined) => (at ? formatDistanceToNow(new Date(at), { addSuffix: true }) : 'never');

type ImpactRow = {
  id: string; inquiry: string; name: string; sku: string | null; qty: number;
  before: number; after: number; laborBefore: number; laborAfter: number; fxBefore: number; fxAfter: number;
};

export default function LiveRatesSettings() {
  const [gs, setGs] = useState<any>(null);
  const [employees, setEmployees] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [impact, setImpact] = useState<ImpactRow[] | null>(null);
  const [building, setBuilding] = useState(false);

  const load = async () => {
    const [g, e] = await Promise.all([
      (supabase as any).from('global_settings').select('*').limit(1).single(),
      supabase.from('labor_employees').select('hourly_rate_inr, designations'),
    ]);
    if (g.data) setGs(g.data);
    if (e.data) setEmployees(e.data as any[]);
  };
  useEffect(() => { load(); }, []);

  const refresh = async () => {
    setSyncing(true);
    const res = await syncLiveRates();
    setSyncing(false);
    if (res.error) return toast.error('Refresh failed', { description: res.error });
    if (res.warnings?.length) toast.warning('Refreshed with warnings', { description: res.warnings.join(' · ') });
    else toast.success('Live rates refreshed');
    await load();
  };

  const setLive = async (on: boolean) => {
    const { error } = await (supabase as any).from('global_settings').update({ use_live_rates: on }).eq('id', gs.id);
    if (error) return toast.error(error.message);
    setGs({ ...gs, use_live_rates: on });
    toast.success(on ? 'Costing now uses live rates' : 'Costing is back on the manual rates');
    // Turning on also pushes Odoo's rates into Currencies, which quotes freeze from.
    if (on) await refresh();
  };

  const buildImpact = async () => {
    setBuilding(true);
    try {
      const { data: inqs } = await (supabase as any).from('customer_rfqs').select('id, rfq_number, title').eq('status', 'active').limit(10000);
      const inqById = Object.fromEntries((inqs || []).map((i: any) => [i.id, i]));
      const inqIds = Object.keys(inqById);
      if (!inqIds.length) { setImpact([]); return; }
      const { data: prods } = await supabase.from('products').select('id, name, sku, quantity, customer_rfq_id')
        .in('customer_rfq_id', inqIds).is('archived_at', null).limit(100000);
      const ids = (prods || []).map((p: any) => p.id);
      const [before, after] = await Promise.all([
        computeProductPriceAndCost(ids, { live: false }),
        computeProductPriceAndCost(ids, { live: true }),
      ]);
      const rows: ImpactRow[] = (prods || []).filter((p: any) => before[p.id] && after[p.id]).map((p: any) => {
        const b = before[p.id], a = after[p.id];
        const inq = inqById[p.customer_rfq_id];
        return {
          id: p.id, inquiry: inq?.rfq_number || inq?.title || '—', name: p.name, sku: p.sku, qty: Number(p.quantity) || 0,
          before: b.unit_price_usd, after: a.unit_price_usd,
          laborBefore: b.buckets_inr.directOh + b.buckets_inr.indirectOh, laborAfter: a.buckets_inr.directOh + a.buckets_inr.indirectOh,
          fxBefore: b.exchange_rate, fxAfter: a.exchange_rate,
        };
      }).sort((x, y) => x.inquiry.localeCompare(y.inquiry) || x.name.localeCompare(y.name));
      setImpact(rows);
    } catch (e: any) {
      toast.error('Could not build the price list', { description: e.message });
    } finally { setBuilding(false); }
  };

  const totals = useMemo(() => {
    if (!impact?.length) return null;
    const before = impact.reduce((s, r) => s + r.before * r.qty, 0);
    const after = impact.reduce((s, r) => s + r.after * r.qty, 0);
    return { before, after, pct: before > 0 ? (after - before) / before : 0 };
  }, [impact]);

  const downloadCsv = () => {
    if (!impact) return;
    const head = ['Inquiry', 'Product', 'SKU', 'Qty', 'FX before', 'FX after', 'Labor ₹/unit before', 'Labor ₹/unit after', 'Price USD before', 'Price USD after', 'Change USD', 'Change %'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = impact.map(r => [r.inquiry, r.name, r.sku, r.qty, r.fxBefore.toFixed(4), r.fxAfter.toFixed(4), r.laborBefore.toFixed(2), r.laborAfter.toFixed(2),
      r.before.toFixed(2), r.after.toFixed(2), (r.after - r.before).toFixed(2), r.before > 0 ? (((r.after - r.before) / r.before) * 100).toFixed(1) : ''].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `live-rates-price-impact-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!gs) return <div className="text-sm text-muted-foreground">Loading…</div>;
  const detail = (gs.live_labor_detail || null) as LiveLaborDetail | null;
  const directLive = (gs.live_direct_rates || {}) as Record<string, number>;
  const warnings: string[] = gs.live_rates_warnings || [];
  const stale = isLiveStale(gs.live_exchange_rate_at) || isLiveStale(gs.live_labor_at);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Live rates</CardTitle>
            <CardDescription>
              Exchange rate from Odoo; indirect overhead (fully burdened ₹/man-hour) and direct wages by labor type from LaborTrax.
              They refresh automatically every {LIVE_STALE_HOURS} hours while switched on. A per-inquiry override still wins, and if a source is down the last good value stays in use.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={refresh} disabled={syncing}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', syncing && 'animate-spin')} /> Refresh now
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={!!gs.use_live_rates} onCheckedChange={setLive} />
            <span className="font-medium">Use live rates in costing</span>
            <span className="text-xs text-muted-foreground">{gs.use_live_rates ? 'On: every costing screen and new quote uses the live values.' : 'Off: costing uses the manual values in Settings → General.'}</span>
          </label>

          {(warnings.length > 0 || (gs.use_live_rates && stale)) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              {stale && <div>Live values are more than {LIVE_STALE_HOURS} hours old; the last good values are in use.</div>}
              {warnings.map(w => <div key={w}>{w}</div>)}
            </div>
          )}

          <Table>
            <TableHeader>
              <TableRow><TableHead>Rate</TableHead><TableHead className="text-right">Live</TableHead><TableHead className="text-right">Manual</TableHead><TableHead>Source</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Exchange rate (INR per USD)</TableCell>
                <TableCell className="text-right tabular-nums">{gs.live_exchange_rate ? Number(gs.live_exchange_rate).toFixed(4) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{Number(gs.exchange_rate).toFixed(4)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">Odoo, updated {ago(gs.live_exchange_rate_at)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Indirect overhead / man-hour (fully burdened)</TableCell>
                <TableCell className="text-right tabular-nums">{inr(gs.live_burdened_per_mh)}</TableCell>
                <TableCell className="text-right tabular-nums">{inr(gs.indirect_overhead_per_mh)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {detail?.burdened_source === 'labortrax' ? `LaborTrax fully burdened figure${detail.window ? `, ${detail.window.from} to ${detail.window.to}` : ''}` : `LaborTrax labor entries${detail ? `, ${detail.window.from} to ${detail.window.to}, ${detail.hours.toLocaleString()} man-hours` : ''}`}, updated {ago(gs.live_labor_at)}
                </TableCell>
              </TableRow>
              {LABOR_TYPES.map(t => (
                <TableRow key={t}>
                  <TableCell className="pl-6">Direct wages / man-hour: {t}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(directLive[t])}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(avgRateByDesignation(employees, t))}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{!directLive[t] ? 'No LaborTrax hours: employee average is used'
                    : detail?.direct_source?.[t] === '6m' ? 'LaborTrax, 6-month rate (no hours in the last 3 weeks)'
                    : `LaborTrax${detail?.direct_window ? `, ${detail.direct_window.from} to ${detail.direct_window.to}` : ''}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {detail?.categories?.length ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">LaborTrax work-order categories, {detail.direct_window ? `${detail.direct_window.from} to ${detail.direct_window.to}` : ''} ({detail.categories.length})</summary>
              <Table>
                <TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Counts as</TableHead><TableHead className="text-right">Man-hours</TableHead><TableHead className="text-right">Direct ₹/MH</TableHead></TableRow></TableHeader>
                <TableBody>
                  {detail.categories.map(c => (
                    <TableRow key={c.category}>
                      <TableCell>{c.category}</TableCell>
                      <TableCell className={cn(!c.laborType && 'text-muted-foreground')}>{c.laborType ?? 'Not matched (only in the burdened average)'}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.hours.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{inr(c.directPerMh)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </details>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Price impact</CardTitle>
            <CardDescription>Every product on an active inquiry, priced with the manual rates and with the live rates. Both columns use today's costing, so the difference is only the rates.</CardDescription>
          </div>
          <div className="flex gap-2">
            {impact?.length ? <Button size="sm" variant="outline" onClick={downloadCsv}><Download className="mr-1.5 h-3.5 w-3.5" />CSV</Button> : null}
            <Button size="sm" onClick={buildImpact} disabled={building}>{building ? 'Pricing…' : impact ? 'Rebuild' : 'Build price list'}</Button>
          </div>
        </CardHeader>
        {impact && (
          <CardContent>
            {totals && (
              <p className="mb-3 text-sm">
                {impact.length} products. Order value {usd(totals.before)} → {usd(totals.after)}{' '}
                <span className={cn('font-medium', totals.pct > 0 ? 'text-red-600' : 'text-green-600')}>({totals.pct >= 0 ? '+' : ''}{(totals.pct * 100).toFixed(1)}%)</span>
              </p>
            )}
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inquiry</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Labor ₹/unit</TableHead><TableHead className="text-right">Price before</TableHead><TableHead className="text-right">Price after</TableHead><TableHead className="text-right">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {impact.map(r => {
                    const pct = r.before > 0 ? (r.after - r.before) / r.before : 0;
                    return (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">{r.inquiry}</TableCell>
                        <TableCell>{r.name}{r.sku && <span className="ml-1 text-xs text-muted-foreground">{r.sku}</span>}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.qty.toLocaleString()}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{inr(r.laborBefore)} → {inr(r.laborAfter)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(r.before)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(r.after)}</TableCell>
                        <TableCell className={cn('text-right tabular-nums', pct > 0.0005 ? 'text-red-600' : pct < -0.0005 ? 'text-green-600' : 'text-muted-foreground')}>
                          {pct >= 0 ? '+' : ''}{(pct * 100).toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
