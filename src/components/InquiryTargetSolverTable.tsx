import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { solveForMarkup, solveForMaxCost } from '@/lib/target-price-solver';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  getCachedCurrencyMap,
  loadCurrencyMap,
  quoteAmountToUsd,
  usdToQuoteAmount,
  formatCurrencySync,
  type CurrencyMap,
} from '@/lib/currency';

const BUCKETS = [
  { key: 'cogs', label: 'COGS' },
  { key: 'directOh', label: 'Direct OH' },
  { key: 'indirectOh', label: 'Indirect OH' },
  { key: 'shipping', label: 'Shipping / Pkg' },
] as const;

type Row = {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  targetUsd: number | null;
  priceUsd: number;
  costUsd: number;
  costInr: number;
  exchangeRate: number;
  markupPercent: number;
  buckets: Array<{ label: string; valueInr: number }>;
};

const usd = (n: number) => `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString()}`;
const pct = (n: number) => `${((Number(n) || 0) * 100).toFixed(1)}%`;

export function InquiryTargetSolverTable({ inquiryId }: { inquiryId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [currencyMap, setCurrencyMap] = useState<CurrencyMap | null>(getCachedCurrencyMap());
  const [currency, setCurrency] = useState<string>('USD');

  useEffect(() => { void loadCurrencyMap().then(setCurrencyMap); }, []);

  useEffect(() => {
    if (!inquiryId) return;
    (supabase as any)
      .from('customer_rfqs')
      .select('quoting_currency')
      .eq('id', inquiryId)
      .maybeSingle()
      .then(({ data }: any) => setCurrency(data?.quoting_currency || 'USD'));
  }, [inquiryId]);

  const currencyOptions = useMemo(() => {
    const codes = new Set<string>(['USD', 'INR']);
    Object.values(currencyMap || {}).forEach(c => codes.add(c.code));
    return Array.from(codes);
  }, [currencyMap]);

  const toUsd = useCallback(
    (v: string, rate: number) => {
      const t = v.trim();
      if (t === '') return null;
      const n = Number(t);
      if (!Number.isFinite(n)) return NaN;
      const out = quoteAmountToUsd(n, currency, currencyMap, rate);
      return out == null ? NaN : out;
    },
    [currency, currencyMap],
  );

  const fromUsd = useCallback(
    (v: number | null, rate: number) => {
      if (v == null) return '';
      const out = currency === 'USD' ? v : usdToQuoteAmount(v, currency, currencyMap, rate);
      return out == null ? '' : String(+out.toFixed(2));
    },
    [currency, currencyMap],
  );


  const load = useCallback(async () => {
    if (!inquiryId) { setRows([]); return; }
    setLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('products')
        .select('id, name, sku, quantity, target_price_usd, archived_at')
        .eq('customer_rfq_id', inquiryId)
        .order('sort_order', { ascending: true })
        .limit(1000);
      if (error) throw error;
      const active = (data || []).filter((p: any) => !p.archived_at);
      if (active.length === 0) { setRows([]); return; }
      const map = await computeProductPriceAndCost(active.map((p: any) => p.id));
      const next: Row[] = active.map((p: any) => {
        const r = map[p.id];
        return {
          id: p.id,
          name: p.name || 'Unnamed',
          sku: p.sku ?? null,
          quantity: Number(p.quantity) || 0,
          targetUsd: p.target_price_usd == null ? null : Number(p.target_price_usd),
          priceUsd: r?.unit_price_usd || 0,
          costUsd: r?.unit_cost_usd || 0,
          costInr: r?.unit_cost_inr || 0,
          exchangeRate: r?.exchange_rate || 0,
          markupPercent: r?.markup_percent || 0,
          buckets: BUCKETS.map(b => ({ label: b.label, valueInr: r?.buckets_inr?.[b.key] || 0 })),
        };
      });
      setRows(next);
    } catch (e: any) {
      toast.error(`Could not load inquiry costing: ${e.message || e}`);
    } finally {
      setLoading(false);
    }
  }, [inquiryId]);

  useEffect(() => { void load(); }, [load]);

  // Seed/reseed the editable targets in the selected currency (stored value is USD).
  useEffect(() => {
    setDrafts(Object.fromEntries(rows.map(r => [r.id, fromUsd(r.targetUsd, r.exchangeRate)])));
  }, [rows, fromUsd]);

  const saveTarget = async (row: Row, raw: string) => {
    const converted = toUsd(raw, row.exchangeRate);
    if (Number.isNaN(converted as number)) { toast.error('Invalid number or missing exchange rate'); return; }
    const n = converted == null ? null : +Number(converted).toFixed(4);
    if ((row.targetUsd ?? null) === n) return;
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, targetUsd: n } : r)));
    const { error } = await (supabase as any)
      .from('products')
      .update({ target_price_usd: n })
      .eq('id', row.id);
    if (error) { toast.error(`Save failed: ${error.message}`); void load(); }

  };

  const solved = useMemo(() => rows.map(row => {
    const target = row.targetUsd ?? 0;
    const has = target > 0;
    const gapUsd = has ? row.priceUsd - target : 0; // >0 = we are above target (need to cut)
    const markupSolve = has ? solveForMarkup({
      targetPriceUsd: target,
      currentCostInr: row.costInr,
      exchangeRate: row.exchangeRate,
      currentMarkup: row.markupPercent,
    }) : null;
    const costSolve = has ? solveForMaxCost({
      targetPriceUsd: target,
      currentCostInr: row.costInr,
      exchangeRate: row.exchangeRate,
      markupPercent: row.markupPercent,
      buckets: row.buckets,
    }) : null;
    return { row, has, gapUsd, markupSolve, costSolve };
  }), [rows]);

  const totals = useMemo(() => {
    let currentRev = 0, targetRev = 0, gapTotal = 0, withTarget = 0, over = 0, under = 0;
    const byBucket: Record<string, number> = {};
    for (const s of solved) {
      currentRev += s.row.priceUsd * s.row.quantity;
      if (!s.has) continue;
      withTarget++;
      targetRev += (s.row.targetUsd || 0) * s.row.quantity;
      gapTotal += s.gapUsd * s.row.quantity;
      if (s.gapUsd > 0.005) over++; else under++;
      for (const a of s.costSolve?.allocation || []) {
        if (a.cutInr > 0) byBucket[a.label] = (byBucket[a.label] || 0) + (a.cutInr / (s.row.exchangeRate || 1)) * s.row.quantity;
      }
    }
    return { currentRev, targetRev, gapTotal, withTarget, over, under, byBucket };
  }, [solved]);

  if (!inquiryId) {
    return <div className="text-sm text-muted-foreground">Pick an inquiry to solve every product at once.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Targets save straight to each product (stored in USD). Gap = current calculated price minus your target, at live costing.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Target currency</span>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {currencyOptions.map(c => <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3 w-3 mr-1', loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>


      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryStat label="Products with a target" value={`${totals.withTarget} / ${rows.length}`} />
        <SummaryStat label="At or under target" value={String(totals.under)} tone="ok" />
        <SummaryStat label="Over target" value={String(totals.over)} tone={totals.over > 0 ? 'bad' : 'ok'} />
        <SummaryStat
          label="Order-value gap"
          value={usd(totals.gapTotal)}
          tone={totals.gapTotal > 0 ? 'bad' : 'ok'}
          hint={totals.gapTotal > 0 ? 'Cost/price above target across the order' : 'Headroom vs target'}
        />
      </div>

      <div className="border rounded-md overflow-auto bg-background">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/60">
            <tr className="text-muted-foreground">
              <th className="px-2 py-2 text-left font-medium w-6" />
              <th className="px-3 py-2 text-left font-medium min-w-[200px]">Product</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="px-2 py-2 text-right font-medium">Cost $</th>
              <th className="px-2 py-2 text-right font-medium">Markup</th>
              <th className="px-2 py-2 text-right font-medium">Price $</th>
              <th className="px-2 py-2 text-right font-medium w-[120px]">Target ({currency})</th>
              <th className="px-2 py-2 text-right font-medium">Gap $/unit</th>
              <th className="px-2 py-2 text-right font-medium">Gap total</th>
              <th className="px-2 py-2 text-right font-medium">Markup needed</th>
              <th className="px-2 py-2 text-right font-medium">Max cost $</th>
              <th className="px-2 py-2 text-right font-medium">Max cost ₹</th>
              <th className="px-2 py-2 text-right font-medium">Cut needed $</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={13} className="px-3 py-8 text-center text-muted-foreground">No active products in this inquiry.</td></tr>
            )}

            {solved.map(({ row, has, gapUsd, markupSolve, costSolve }) => {
              const isOpen = expanded.has(row.id);
              const over = has && gapUsd > 0.005;
              return (
                <Fragment key={row.id}>
                  <tr className="border-t hover:bg-muted/30">
                    <td className="px-1 py-1 align-middle">
                      <button
                        className="p-1 text-muted-foreground hover:text-foreground"
                        onClick={() => setExpanded(prev => {
                          const n = new Set(prev);
                          n.has(row.id) ? n.delete(row.id) : n.add(row.id);
                          return n;
                        })}
                        aria-label="Toggle category breakdown"
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium truncate max-w-[240px]" title={row.name}>{row.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{row.sku || '—'}</div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.quantity.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{usd(row.costUsd)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pct(row.markupPercent)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-medium">{usd(row.priceUsd)}</td>
                    <td className="px-1 py-1 text-right">
                      <Input
                        className="h-7 text-xs text-right tabular-nums"
                        inputMode="decimal"
                        placeholder="—"
                        value={drafts[row.id] ?? ''}
                        onChange={e => setDrafts(d => ({ ...d, [row.id]: e.target.value }))}
                        onBlur={e => void saveTarget(row, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      />
                    </td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', has && (over ? 'text-rose-600' : 'text-emerald-600'))}>
                      {has ? `${over ? '+' : ''}${usd(gapUsd)}` : '—'}
                    </td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', has && (over ? 'text-rose-600' : 'text-emerald-600'))}>
                      {has ? usd(gapUsd * row.quantity) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {markupSolve?.feasible ? pct(markupSolve.requiredMarkup) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {costSolve?.feasible ? usd(costSolve.maxCostUsd) : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {costSolve?.feasible ? inr(costSolve.maxCostInr) : '—'}
                    </td>
                    <td className={cn('px-2 py-1.5 text-right tabular-nums', costSolve && costSolve.cutRequiredUsd > 0 && 'text-rose-600')}>
                      {costSolve?.feasible ? usd(Math.max(0, costSolve.cutRequiredUsd)) : '—'}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${row.id}-detail`} className="bg-muted/20 border-t">
                      <td />
                      <td colSpan={12} className="px-3 py-2">

                        {!has ? (
                          <div className="text-muted-foreground">Enter a target price to see the category breakdown.</div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-[11px] text-muted-foreground">
                              Proportional estimate of where the {costSolve && costSolve.cutRequiredInr > 0 ? 'cut' : 'headroom'} sits, by category (₹ per unit, at current markup {pct(row.markupPercent)}).
                            </div>
                            <table className="text-xs">
                              <thead className="text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-1 text-left font-normal min-w-[130px]">Category</th>
                                  <th className="px-2 py-1 text-right font-normal min-w-[90px]">Current ₹</th>
                                  <th className="px-2 py-1 text-right font-normal min-w-[70px]">Share</th>
                                  <th className="px-2 py-1 text-right font-normal min-w-[90px]">Cut ₹</th>
                                  <th className="px-2 py-1 text-right font-normal min-w-[90px]">Target ₹</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(costSolve?.allocation || []).map(a => (
                                  <tr key={a.label} className="border-t">
                                    <td className="px-2 py-1">{a.label}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{inr(a.currentInr)}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{pct(a.share)}</td>
                                    <td className={cn('px-2 py-1 text-right tabular-nums', a.cutInr > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                                      {inr(a.cutInr)}
                                    </td>
                                    <td className="px-2 py-1 text-right tabular-nums">{inr(a.targetInr)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-muted/50 border-t font-medium">
              <tr>
                <td />
                <td className="px-3 py-2">Totals</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {rows.reduce((s, r) => s + r.quantity, 0).toLocaleString()}
                </td>
                <td colSpan={3} className="px-2 py-2 text-right tabular-nums">
                  Current order value {usd(totals.currentRev)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{usd(totals.targetRev)}</td>
                <td />
                <td className={cn('px-2 py-2 text-right tabular-nums', totals.gapTotal > 0 ? 'text-rose-600' : 'text-emerald-600')}>
                  {usd(totals.gapTotal)}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {Object.keys(totals.byBucket).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Where the total cut sits, by category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-4">
              {BUCKETS.map(b => (
                <div key={b.key} className="rounded-md border p-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{b.label}</div>
                  <div className="text-sm font-semibold tabular-nums">{usd(totals.byBucket[b.label] || 0)}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Order-level total of the proportional per-product cuts (over-target products only). Rough guide, not a prescriptive plan.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone, hint }: { label: string; value: string; tone?: 'ok' | 'bad'; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('text-base font-semibold tabular-nums', tone === 'bad' && 'text-rose-600', tone === 'ok' && 'text-emerald-600')}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
