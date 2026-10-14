// Breakeven Calculator (/tools/breakeven): revenue needed to cover overhead and the cash buffer
// at any trading / manufacturing mix. Math lives in src/lib/breakeven.ts. Live defaults come from
// finished Odoo orders (odoo-profitability, last 12 months) and the Analytics snapshot's overhead
// history; the user's edits are kept in this browser only and Reset brings the live values back.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Calculator, RefreshCw, RotateCcw } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AppLayout } from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NumInput } from '@/components/iron-weight/PartRow';
import { supabase } from '@/integrations/supabase/client';
import { useAnalyticsSnapshot } from '@/hooks/use-analytics-snapshot';
import { useDocumentTitle } from '@/hooks/use-document-title';
import {
  breakeven, curve, liveMarginsFromOrders, liveOverheadFromHistory, loadOverrides, resolveInputs, saveOverrides,
  type BreakevenInputs, type LiveInputs,
} from '@/lib/breakeven';
import type { SoOrder } from '@/lib/so-profitability';
import { cn } from '@/lib/utils';

const ORDERS_KEY = 'breakeven-orders';
const SHIP_ACCT_KEY = 'so-profitability-shipping-account';
const DEFAULT_SHIP_ACCT = 170;
const PRESETS = [0, 25, 40, 50, 60, 75, 100];

type NumKey = keyof BreakevenInputs;
const usd = (n: number) => (Number.isFinite(n) ? `$${Math.round(n).toLocaleString('en-US')}` : '—');
const compact = (n: number) => (!Number.isFinite(n) ? '—' : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);
const pct = (n: number) => (Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—');
const round1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? undefined : Math.round(n * 10) / 10);
const round0 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? undefined : Math.round(n));

type OrdersCache = { orders: SoOrder[]; inr_per_usd: number | null; fetched_at: string | null };

function useFinishedOrders() {
  const [data, setData] = useState<OrdersCache | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async (force = false) => {
    if (!force) {
      try {
        const c = sessionStorage.getItem(ORDERS_KEY);
        if (c) { setData(JSON.parse(c)); return; }
      } catch { /* ignore */ }
    }
    setLoading(true); setError(null);
    const to = new Date();
    const from = new Date(to); from.setFullYear(to.getFullYear() - 1);
    const { data: res, error: err } = await supabase.functions.invoke('odoo-profitability', {
      body: {
        date_from: from.toISOString().slice(0, 10), date_to: to.toISOString().slice(0, 10),
        shipping_account_id: Number(sessionStorage.getItem(SHIP_ACCT_KEY)) || DEFAULT_SHIP_ACCT,
      },
    });
    setLoading(false);
    if (err || res?.error) { setError(res?.error || err?.message || 'Could not load orders from Odoo'); return; }
    const next: OrdersCache = { orders: res.orders ?? [], inr_per_usd: res.inr_per_usd ?? null, fetched_at: res.fetched_at ?? null };
    setData(next);
    try { sessionStorage.setItem(ORDERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return { data, loading, error, reload: () => load(true) };
}

export default function BreakevenCalculator() {
  useDocumentTitle('Breakeven Calculator');
  const { snapshot, syncedAt } = useAnalyticsSnapshot();
  const orders = useFinishedOrders();
  const [overrides, setOverrides] = useState<Partial<BreakevenInputs>>(loadOverrides);
  useEffect(() => saveOverrides(overrides), [overrides]);

  const fx = (orders.data?.inr_per_usd && orders.data.inr_per_usd > 1 ? orders.data.inr_per_usd : snapshot?.inr_per_usd) || 0;
  const margins = useMemo(() => (orders.data && fx > 0 ? liveMarginsFromOrders(orders.data.orders, fx) : null), [orders.data, fx]);
  const overhead = useMemo(() => liveOverheadFromHistory(snapshot?.overhead_monthly?.history, snapshot?.inr_per_usd || fx), [snapshot, fx]);

  const live: LiveInputs = useMemo(() => ({
    tradeGrossPct: round1(margins?.tradeGrossPct), mfgGrossPct: round1(margins?.mfgGrossPct),
    mfgSharePct: round0(margins?.mfgSharePct),
    highOhUsd: round0(overhead?.highOhUsd), lowOhUsd: round0(overhead?.lowOhUsd), highMonths: overhead?.highMonths,
  }), [margins, overhead]);
  const inputs = useMemo(() => resolveInputs(live, overrides), [live, overrides]);
  const r = useMemo(() => breakeven(inputs), [inputs]);
  const series = useMemo(() => curve(inputs, 20).map(p => ({ ...p, required: Number.isFinite(p.required) ? p.required : null })), [inputs]);

  const set = <K extends keyof BreakevenInputs>(k: K, v: BreakevenInputs[K]) => setOverrides(o => ({ ...o, [k]: v }));
  const clear = (k: keyof BreakevenInputs) => setOverrides(o => { const n = { ...o }; delete n[k]; return n; });
  const edited = Object.keys(overrides).length > 0;

  const tradeSrc = margins?.tradeOrders ? `${margins.tradeOrders} finished trading orders, last 12 months` : null;
  const mfgSrc = margins?.mfgOrders ? `${margins.mfgOrders} finished manufacturing orders, last 12 months (price minus MO materials)` : null;
  const guessed = margins?.guessedOrders ?? 0;
  const ohSrc = overhead ? `Odoo overhead, ${overhead.months} months (avg ${usd(overhead.averageUsd)}/mo)` : null;
  const sources: Record<NumKey, string | null> = {
    tradeGrossPct: tradeSrc,
    mfgGrossPct: mfgSrc,
    highOhUsd: ohSrc, lowOhUsd: ohSrc,
    highMonths: overhead ? `Months above the ${overhead.months}-month average, scaled to 12` : null,
    bufferUsd: null,
    mfgSharePct: margins && margins.mfgSharePct != null ? 'Your actual split, last 12 months' : null,
  };

  const field = (k: NumKey, label: string, unit?: string, integer?: boolean) => {
    const isEdited = overrides[k] != null;
    const isLive = !isEdited && live[k] != null;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-medium">{label}{unit && <span className="text-muted-foreground"> ({unit})</span>}</label>
          {isLive && <Badge variant="outline" className="text-[10px] h-5 border-success/40 text-success">live</Badge>}
          {isEdited && (
            <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1" onClick={() => clear(k)}>
              <RotateCcw className="h-3 w-3" /> {live[k] != null ? `live ${live[k]}` : 'default'}
            </button>
          )}
        </div>
        <NumInput label={label} className="w-full" integer={integer} value={inputs[k]} onChange={v => set(k, v)} invalid={!Number.isFinite(inputs[k])} />
        <p className="text-[10px] text-muted-foreground leading-snug min-h-[1em]">
          {sources[k] ?? (k === 'bufferUsd' ? (snapshot?.opening_cash_inr && fx > 0 ? `Cash in bank now: ${usd(snapshot.opening_cash_inr / fx)}` : 'Your number') : 'No live value, using the model default')}
        </p>
      </div>
    );
  };

  const share = inputs.mfgSharePct;
  const contribTotal = r.tradeContribution + r.mfgContribution;
  const seg = (v: number) => (contribTotal > 0 ? `${(v / contribTotal) * 100}%` : '0%');

  return (
    <AppLayout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8"><Link to="/tools" aria-label="Back to Tools"><ArrowLeft className="h-4 w-4" /></Link></Button>
            <h1 className="page-title flex items-center gap-2"><Calculator className="h-5 w-5 text-muted-foreground" /> Breakeven Calculator</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={orders.reload} disabled={orders.loading}>
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', orders.loading && 'animate-spin')} /> Refresh orders
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOverrides({})} disabled={!edited}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset to live
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          How much revenue covers a year of overhead plus the cash buffer, at any mix of trading and manufacturing. Live values come from
          finished Odoo orders{orders.data?.fetched_at ? ` (loaded ${new Date(orders.data.fetched_at).toLocaleString()})` : ''} and the Analytics overhead
          {syncedAt ? ` (synced ${new Date(syncedAt).toLocaleDateString()})` : ''}. Your edits stay in this browser only.
        </p>
        {orders.loading && !orders.data && <p className="text-xs text-muted-foreground">Loading finished orders from Odoo…</p>}
        {orders.error && <p className="text-xs text-destructive">Orders: {orders.error}. Margins use the model defaults until they load.</p>}
        {!snapshot?.overhead_monthly && <p className="text-xs text-muted-foreground">No Analytics snapshot yet, so overhead uses the model defaults. Press Refresh on Master Analytics to pull it.</p>}

        <Card>
          <CardContent className="pt-5 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">Annual revenue required</div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="text-4xl font-semibold tabular-nums tracking-tight">{usd(r.required)}</span>
                <span className="text-sm text-muted-foreground tabular-nums">{usd(r.perMonth)} / month{fx > 0 && Number.isFinite(r.required) ? ` · ₹${Math.round(r.required * fx).toLocaleString('en-IN')}` : ''}</span>
              </div>
            </div>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
              {[
                ['Trading revenue', usd(r.trading), 'bg-info'],
                ['Manufacturing revenue', usd(r.manufacturing), 'bg-warning'],
                ['Blended contribution', pct(r.rate), null],
                ['Overhead + buffer', usd(r.target), null],
              ].map(([k, v, dot]) => (
                <div key={k as string} className="rounded-md border bg-muted/30 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">{dot && <span className={cn('h-2 w-2 rounded-full', dot)} />}{k}</div>
                  <div className="text-base font-semibold tabular-nums">{v}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5 space-y-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <div className="text-sm font-medium">Order mix</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {100 - share}% trading / {share}% manufacturing
                {live.mfgSharePct != null && overrides.mfgSharePct != null && (
                  <button type="button" className="ml-2 underline hover:text-foreground" onClick={() => clear('mfgSharePct')}>actual {live.mfgSharePct}%</button>
                )}
              </div>
            </div>
            <input
              type="range" min={0} max={100} step={1} value={share} aria-label="Manufacturing share"
              onChange={e => set('mfgSharePct', Number(e.target.value))}
              className="w-full accent-warning"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground"><span>100% trading</span><span>100% manufacturing</span></div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <Button key={p} size="sm" variant={share === p ? 'default' : 'outline'} className="h-7 px-2.5 text-xs" onClick={() => set('mfgSharePct', p)}>
                  {100 - p} / {p}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue required vs. manufacturing share</CardTitle></CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={series} margin={{ left: 4, right: 12, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="share" type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={v => `${v}%`} fontSize={11} />
                    <YAxis tickFormatter={compact} fontSize={11} width={52} />
                    <Tooltip formatter={(v: number) => usd(v)} labelFormatter={v => `${v}% manufacturing`} />
                    <Line dataKey="required" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
                    {Number.isFinite(r.required) && <ReferenceDot x={share} y={r.required} r={5} fill="hsl(var(--background))" stroke="hsl(var(--primary))" strokeWidth={2} />}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Where the contribution goes</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex h-7 rounded-md overflow-hidden border">
                <div className="bg-info" style={{ width: seg(r.tradeContribution) }} title="Trading gross margin" />
                <div className="bg-warning" style={{ width: seg(r.mfgContribution) }} title="Manufacturing gross margin" />
              </div>
              <table className="w-full text-xs">
                <tbody className="[&_td]:py-1.5 [&_tr]:border-b last:[&_tr]:border-0">
                  <tr><td>Trading gross margin <span className="text-muted-foreground">({inputs.tradeGrossPct}% of {usd(r.trading)})</span></td><td className="text-right tabular-nums">{usd(r.tradeContribution)}</td></tr>
                  <tr><td>Manufacturing gross margin <span className="text-muted-foreground">({inputs.mfgGrossPct}% of {usd(r.manufacturing)})</span></td><td className="text-right tabular-nums">{usd(r.mfgContribution)}</td></tr>
                  <tr className="font-semibold"><td>Covers overhead {usd(r.annualOverhead)} + buffer {usd(inputs.bufferUsd)}</td><td className="text-right tabular-nums">{usd(contribTotal)}</td></tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Assumptions</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {margins && (
              <p className="text-xs text-muted-foreground">
                Trading vs manufacturing comes from each sales order's Trading or Manufacturing tag in Odoo.
                {guessed > 0 && <> {guessed} of {margins.tradeOrders + margins.mfgOrders} orders aren't tagged yet, so they're guessed from their MOs (see{' '}
                  <Link to="/profitability" className="underline hover:text-foreground">SO Profitability</Link>). Press Refresh after tagging.</>}
              </p>
            )}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {field('tradeGrossPct', 'Trading gross margin', '%')}
              {field('mfgGrossPct', 'Manufacturing gross margin', '%')}
              {field('highOhUsd', 'High-month overhead', '$')}
              {field('lowOhUsd', 'Low-month overhead', '$')}
              {field('highMonths', 'High months per year', undefined, true)}
              {field('bufferUsd', 'Annual cash buffer', '$')}
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Contribution is each order's gross margin: price minus bought-in cost for trading, price minus MO materials for manufacturing. Labour and
              everything else below gross margin is overhead, and shipping is charged on top, so neither is taken out. Breakeven is where that pool equals a
              year of overhead plus the buffer. Live margins use the SO Profitability math on orders finished in the last 12 months (the Trading or
              Manufacturing tag on each Odoo sales order decides which is which). Taxes, owner pay,
              working-capital swings and cash tied up between paying suppliers and getting paid are not modelled.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
