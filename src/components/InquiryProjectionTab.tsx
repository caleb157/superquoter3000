import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import { formatDualPrice, loadCurrencyMap, getCachedCurrencyMap, subscribeCurrencyMap, type CurrencyMap } from '@/lib/currency';
import {
  effectiveCertainty,
  weightedProjectedRevenue,
  projectedGrossProfit,
  effectiveManHours,
  monthInputToDate,
  dateToMonthInput,
  shippingEstimateUsd,
  deriveScheduleMonths,
  defaultDurationMonths,
  type InquiryProjection,
} from '@/lib/projections';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import {
  effectiveFobUsd,
  effectiveGpm,
  projectionIsLocked,
} from '@/lib/inquiry-financials';
import { ChevronDown, Lock } from 'lucide-react';

type Props = { inquiryId: string };

const EMPTY: Partial<InquiryProjection> = {
  repeat_order: false,
  paying_shipping: false,
  cust_deposit_pct: 0.30,
  cust_final_pct: 0.70,
  ie_deposit_pct: 0.30,
  ie_balance_pct: 0.70,
  vendor_deposit_pct: 0.30,
  vendor_balance_pct: 0.70,
};

export function InquiryProjectionTab({ inquiryId }: Props) {
  const [loading, setLoading] = useState(true);
  const [proj, setProj] = useState<Partial<InquiryProjection> | null>(null);
  const [existed, setExisted] = useState(false);
  const [entities, setEntities] = useState<any[]>([]);
  const [inquiryStatus, setInquiryStatus] = useState<string>('active');
  const [products, setProducts] = useState<any[]>([]);
  const [productMh, setProductMh] = useState<Array<{ product_id: string; quantity: number; total_mh_per_unit: number }>>([]);
  const [autoFob, setAutoFob] = useState<number>(0);
  const [autoGpm, setAutoGpm] = useState<number>(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pr, ent, inq, prods] = await Promise.all([
        (supabase as any).from('inquiry_projections').select('*').eq('inquiry_id', inquiryId).maybeSingle(),
        (supabase as any).from('company_entities').select('id, name').order('name'),
        (supabase as any).from('customer_rfqs').select('status, exchange_rate_override').eq('id', inquiryId).maybeSingle(),
        (supabase as any).from('products').select('id, quantity, design_stage, quote_stage, sample_stage, calculated_unit_price_usd, calculated_unit_cost_usd').eq('customer_rfq_id', inquiryId),
      ]);
      setEntities(ent.data || []);
      setInquiryStatus(inq.data?.status ?? 'active');
      setProducts(prods.data || []);

      const prodIds = (prods.data || []).map((p: any) => p.id);
      if (prodIds.length) {
        const [{ data: ohRows }, priceMap] = await Promise.all([
          (supabase as any).from('overhead_items').select('product_id, man_hours_per_unit, include').in('product_id', prodIds),
          computeProductPriceAndCost(prodIds),
        ]);
        const sums: Record<string, number> = {};
        (ohRows || []).forEach((r: any) => {
          if (r.include === 'No' || r.include === 'Review') return;
          sums[r.product_id] = (sums[r.product_id] || 0) + Number(r.man_hours_per_unit || 0);
        });
        setProductMh((prods.data || []).map((p: any) => ({
          product_id: p.id,
          quantity: Number(p.quantity || 0),
          total_mh_per_unit: sums[p.id] || 0,
        })));

        let totalRev = 0;
        let totalCost = 0;
        (prods.data || []).forEach((p: any) => {
          const qty = Number(p.quantity || 0);
          const computed = priceMap[p.id];
          const price = Number(
            (computed?.unit_price_usd && computed.unit_price_usd > 0)
              ? computed.unit_price_usd
              : p.calculated_unit_price_usd
          ) || 0;
          const unitCogs = Number(
            (computed?.unit_cogs_usd && computed.unit_cogs_usd > 0)
              ? computed.unit_cogs_usd
              : 0
          ) || 0;
          totalRev += price * qty;
          totalCost += unitCogs * qty;
        });
        setAutoFob(Math.round(totalRev * 100) / 100);
        setAutoGpm(totalRev > 0 ? (totalRev - totalCost) / totalRev : 0);
      } else {
        setProductMh([]);
        setAutoFob(0);
        setAutoGpm(0);
      }

      if (pr.data) {
        setProj(pr.data);
        setExisted(true);
        if (pr.data.producing_entity_id && pr.data.selling_entity_id !== pr.data.producing_entity_id) {
          setAdvancedOpen(true);
        }
      } else {
        setProj({ inquiry_id: inquiryId, ...EMPTY });
        setExisted(false);
      }
      setLoading(false);
    })();
  }, [inquiryId]);

  const setField = (patch: Partial<InquiryProjection>) => setProj(prev => ({ ...(prev || {}), ...patch }));

  const persist = async (patch: Partial<InquiryProjection>) => {
    const next = { ...(proj || {}), ...patch, inquiry_id: inquiryId };
    setProj(next);
    if (!existed) {
      const { error } = await (supabase as any).from('inquiry_projections').insert(next);
      if (error) { toast.error(error.message); return; }
      setExisted(true);
    } else {
      const { error } = await (supabase as any).from('inquiry_projections').update(patch).eq('inquiry_id', inquiryId);
      if (error) { toast.error(error.message); return; }
    }
  };

  /** Re-derive schedule months from start + duration, persisting both the inputs and the derived. */
  const onStartOrDurationChange = (patch: Partial<InquiryProjection>) => {
    const after = { ...(proj || {}), ...patch };
    const sched = deriveScheduleMonths(after.start_month ?? null, after.duration_months ?? null);
    persist({ ...patch, ...(sched || {}) });
  };

  /** Method change: also seed duration if empty, then re-derive months. */
  const onShippingMethodChange = (method: 'air' | 'sea' | 'ground') => {
    const patch: Partial<InquiryProjection> = { shipping_method: method };
    if (proj?.duration_months == null) patch.duration_months = defaultDurationMonths(method);
    onStartOrDurationChange(patch);
  };

  const autoCertainty = useMemo(
    () => effectiveCertainty({ certainty_override: null } as any, products as any, inquiryStatus),
    [products, inquiryStatus],
  );
  const effCertainty = useMemo(
    () => effectiveCertainty(proj as any, products as any, inquiryStatus),
    [proj, products, inquiryStatus],
  );

  const autoMh = useMemo(() => effectiveManHours({ estimated_man_hours: null } as any, productMh), [productMh]);
  const effMh = useMemo(() => effectiveManHours(proj as any, productMh), [proj, productMh]);

  const locked = projectionIsLocked(inquiryStatus);
  const effFob = effectiveFobUsd(proj as any, inquiryStatus, autoFob);
  const effGpmVal = effectiveGpm(proj as any, inquiryStatus, autoGpm);
  const fob = effFob;
  const gpm = effGpmVal;
  const ship = shippingEstimateUsd(!!proj?.paying_shipping, proj?.shipping_method ?? null, fob);
  const expectedRevenue = weightedProjectedRevenue(effFob, effCertainty);
  const expectedGp = projectedGrossProfit(effFob, effGpmVal) * effCertainty;

  const sellingRetentionPct = Number(proj?.selling_retention_pct || 0);
  const ieTotal = fob * (1 - sellingRetentionPct);
  const vendorTotal = fob * (1 - gpm);

  const showIE = !!(
    proj?.selling_entity_id &&
    proj?.producing_entity_id &&
    proj.selling_entity_id !== proj.producing_entity_id
  );

  if (loading) return <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>;

  const pct = (v: any) => v == null || v === '' ? '' : String(Math.round(Number(v) * 1000) / 10);
  const parsePct = (s: string) => s === '' ? null : Number(s) / 100;
  const monthInput = (v: any) => dateToMonthInput(v);
  const num = (v: any) => v == null || v === '' ? '' : String(v);
  const fmtMonth = (v: any) => {
    if (!v) return '—';
    const d = new Date(v);
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  };

  // Build the read-only payment schedule rows
  const scheduleRows: Array<{ label: string; month: any; amount: number; group: string }> = [];
  if (proj?.cust_deposit_pct) {
    scheduleRows.push({
      group: 'Customer',
      label: `Deposit (${Math.round(Number(proj.cust_deposit_pct) * 100)}%)`,
      month: proj.cust_deposit_month,
      amount: fob * Number(proj.cust_deposit_pct),
    });
  }
  if (proj?.cust_final_pct) {
    const finalAmt = fob * Number(proj.cust_final_pct) + (ship.revenue || 0);
    scheduleRows.push({
      group: 'Customer',
      label: `Final (${Math.round(Number(proj.cust_final_pct) * 100)}%)${ship.revenue ? ' + shipping' : ''}`,
      month: proj.cust_final_month,
      amount: finalAmt,
    });
  }
  if (proj?.cust_other_pct) {
    scheduleRows.push({
      group: 'Customer',
      label: `Other (${Math.round(Number(proj.cust_other_pct) * 100)}%)`,
      month: proj.cust_other_month,
      amount: fob * Number(proj.cust_other_pct),
    });
  }
  if (showIE) {
    if (proj?.ie_deposit_pct) scheduleRows.push({
      group: 'Inter-entity',
      label: `Deposit (${Math.round(Number(proj.ie_deposit_pct) * 100)}%)`,
      month: proj.ie_deposit_month,
      amount: ieTotal * Number(proj.ie_deposit_pct),
    });
    if (proj?.ie_balance_pct) scheduleRows.push({
      group: 'Inter-entity',
      label: `Balance (${Math.round(Number(proj.ie_balance_pct) * 100)}%)`,
      month: proj.ie_balance_month,
      amount: ieTotal * Number(proj.ie_balance_pct),
    });
  }
  if (proj?.vendor_deposit_pct) scheduleRows.push({
    group: 'Vendor',
    label: `Deposit (${Math.round(Number(proj.vendor_deposit_pct) * 100)}%)`,
    month: proj.vendor_deposit_month,
    amount: vendorTotal * Number(proj.vendor_deposit_pct),
  });
  if (proj?.vendor_balance_pct) scheduleRows.push({
    group: 'Vendor',
    label: `Balance (${Math.round(Number(proj.vendor_balance_pct) * 100)}%)`,
    month: proj.vendor_balance_month,
    amount: vendorTotal * Number(proj.vendor_balance_pct),
  });
  if (proj?.paying_shipping && ship.cost) {
    scheduleRows.push({
      group: 'Vendor',
      label: `Shipping cost (${Math.round(ship.pct * 100)}% of FOB · ${proj.shipping_method})`,
      month: proj.shipping_month,
      amount: ship.cost,
    });
  }

  return (
    <div className="space-y-3">
      {/* ----- INPUTS ----- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Inputs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Selling entity</Label>
              <Select
                value={proj?.selling_entity_id ?? '__none__'}
                onValueChange={v => {
                  const val = v === '__none__' ? null : v;
                  const patch: any = { selling_entity_id: val };
                  if (val && !proj?.producing_entity_id) patch.producing_entity_id = val;
                  persist(patch);
                }}
              >
                <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Certainty override (%)</Label>
              <Input
                type="number" step="1" min={0} max={100}
                placeholder={`Auto: ${Math.round(autoCertainty * 100)}%`}
                value={pct(proj?.certainty_override)}
                onChange={e => setField({ certainty_override: parsePct(e.target.value) })}
                onBlur={e => persist({ certainty_override: parsePct(e.target.value) })}
                className="h-9 mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Stage-weighted default: {(autoCertainty * 100).toFixed(0)}%
              </p>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={!!proj?.repeat_order}
                  onCheckedChange={c => persist({ repeat_order: !!c })}
                />
                Repeat order
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Start month (deposit)</Label>
              <Input
                type="month"
                value={monthInput(proj?.start_month)}
                onChange={e => onStartOrDurationChange({ start_month: monthInputToDate(e.target.value) })}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Duration (months to shipping)</Label>
              <Input
                type="number" step="1" min={0}
                placeholder={`Default: ${defaultDurationMonths(proj?.shipping_method ?? null)}`}
                value={num(proj?.duration_months)}
                onChange={e => setField({ duration_months: e.target.value === '' ? null : Number(e.target.value) })}
                onBlur={e => onStartOrDurationChange({
                  duration_months: e.target.value === '' ? null : Number(e.target.value),
                })}
                className="h-9 mt-1"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Shipping month derived: <span className="font-medium text-foreground">{fmtMonth(proj?.shipping_month)}</span>
              </p>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Shipping method</Label>
              <RadioGroup
                value={proj?.shipping_method ?? ''}
                onValueChange={v => onShippingMethodChange(v as any)}
                className="flex gap-4"
              >
                {['air', 'sea', 'ground'].map(m => (
                  <label key={m} className="flex items-center gap-1.5 text-sm capitalize cursor-pointer">
                    <RadioGroupItem value={m} /> {m}
                  </label>
                ))}
              </RadioGroup>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2">
            <div>
              <div className="text-sm font-medium">We pay shipping</div>
              <div className="text-[11px] text-muted-foreground">
                {proj?.paying_shipping
                  ? (proj.shipping_method
                      ? `Pass-through: ${fmt.usd(ship.revenue)} rev / ${fmt.usd(ship.cost)} cost (${Math.round(ship.pct * 100)}% of FOB, ${proj.shipping_method}).`
                      : 'Select a shipping method to compute the estimate.')
                  : 'Customer arranges shipping — no shipping in our cashflow.'}
              </div>
            </div>
            <Switch
              checked={!!proj?.paying_shipping}
              onCheckedChange={c => persist({ paying_shipping: !!c })}
            />
          </div>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? '' : '-rotate-90'}`} />
              Advanced (producing entity, retention)
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Producing entity</Label>
                  <Select
                    value={proj?.producing_entity_id ?? '__none__'}
                    onValueChange={v => persist({ producing_entity_id: v === '__none__' ? null : v })}
                  >
                    <SelectTrigger className="h-9 mt-1"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {entities.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Defaults to selling entity. Set differently to enable inter-entity payments.
                  </p>
                </div>
                {showIE && (
                  <div>
                    <Label className="text-xs">Selling entity retention %</Label>
                    <Input
                      type="number" step="0.1" min={0} max={100}
                      placeholder="% of FOB the selling entity keeps"
                      value={pct(proj?.selling_retention_pct)}
                      onChange={e => setField({ selling_retention_pct: parsePct(e.target.value) })}
                      onBlur={e => persist({ selling_retention_pct: parsePct(e.target.value) })}
                      className="h-9 mt-1"
                    />
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ----- DERIVED ----- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Derived (live from costing)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Financials */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs flex items-center gap-1">
                FOB revenue (USD)
                {locked ? <Lock className="h-3 w-3 text-muted-foreground" /> : null}
              </Label>
              {locked ? (
                <Input
                  type="number" step="0.01"
                  placeholder={autoFob > 0 ? `Live: ${fmt.usd(autoFob)}` : undefined}
                  value={num(proj?.projected_fob_revenue_usd ?? (autoFob > 0 ? autoFob : ''))}
                  onChange={e => setField({ projected_fob_revenue_usd: e.target.value === '' ? null : Number(e.target.value) })}
                  onBlur={e => persist({ projected_fob_revenue_usd: e.target.value === '' ? null : Number(e.target.value) })}
                  className="h-9 mt-1"
                />
              ) : (
                <div className="h-9 mt-1 px-3 flex items-center rounded-md border bg-muted/30 text-sm tabular-nums">
                  {fmt.usd(autoFob)}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                {locked ? 'Locked at PO. Edit to record actual.' : 'Live — locks at PO.'}
              </p>
            </div>
            <div>
              <Label className="text-xs flex items-center gap-1">
                GPM
                {locked ? <Lock className="h-3 w-3 text-muted-foreground" /> : null}
              </Label>
              {locked ? (
                <Input
                  type="number" step="0.1" min={0} max={100}
                  placeholder={autoGpm > 0 ? `Live: ${(autoGpm * 100).toFixed(1)}%` : undefined}
                  value={pct(proj?.project_gpm ?? (autoGpm > 0 ? autoGpm : ''))}
                  onChange={e => setField({ project_gpm: parsePct(e.target.value) })}
                  onBlur={e => persist({ project_gpm: parsePct(e.target.value) })}
                  className="h-9 mt-1"
                />
              ) : (
                <div className="h-9 mt-1 px-3 flex items-center rounded-md border bg-muted/30 text-sm tabular-nums">
                  {(autoGpm * 100).toFixed(1)}%
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                {locked ? 'Locked at PO.' : '(rev − COGS) / rev, live.'}
              </p>
            </div>
            <div>
              <Label className="text-xs">Shipping estimate</Label>
              <div className="h-9 mt-1 px-3 flex items-center rounded-md border bg-muted/30 text-sm tabular-nums">
                {proj?.paying_shipping
                  ? `${fmt.usd(ship.revenue)} (pass-through)`
                  : '—'}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {proj?.paying_shipping
                  ? `Revenue = cost. ${Math.round(ship.pct * 100)}% of FOB.`
                  : 'Customer arranges.'}
              </p>
            </div>
          </div>

          {/* Summary metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs pt-2 border-t">
            <div>
              <div className="text-muted-foreground">Effective certainty</div>
              <div className="font-medium tabular-nums text-sm">{(effCertainty * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-muted-foreground">Expected revenue</div>
              <div className="font-medium tabular-nums text-sm">{fmt.usd(expectedRevenue)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Expected gross profit</div>
              <div className="font-medium tabular-nums text-sm">{fmt.usd(expectedGp)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total man-hours</div>
              <div className="font-medium tabular-nums text-sm">{effMh.toFixed(1)} MH</div>
            </div>
          </div>

          {/* Payment schedule */}
          <div className="pt-2 border-t">
            <div className="text-xs font-medium mb-2">Payment schedule</div>
            {scheduleRows.length === 0 ? (
              <div className="text-xs text-muted-foreground">
                Set start month + duration above to derive the schedule.
              </div>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium">Group</th>
                      <th className="text-left px-2 py-1.5 font-medium">Milestone</th>
                      <th className="text-left px-2 py-1.5 font-medium">Month</th>
                      <th className="text-right px-2 py-1.5 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleRows.map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">{r.group}</td>
                        <td className="px-2 py-1.5">{r.label}</td>
                        <td className="px-2 py-1.5 tabular-nums">{fmtMonth(r.month)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt.usd(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-2">
              Months auto-derive from start + duration. Percentages use customer 30/70, vendor 30/70 defaults.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ----- ACTUALS ----- */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Actuals (optional)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Committed days</Label>
            <Input type="number" step="1" value={num(proj?.committed_days)}
              onChange={e => setField({ committed_days: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={e => persist({ committed_days: e.target.value === '' ? null : Number(e.target.value) })}
              className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Actual PO date</Label>
            <Input type="date" value={proj?.actual_po_date ?? ''}
              onChange={e => persist({ actual_po_date: e.target.value || null })}
              className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Actual ready date</Label>
            <Input type="date" value={proj?.actual_ready_date ?? ''}
              onChange={e => persist({ actual_ready_date: e.target.value || null })}
              className="h-9 mt-1" />
          </div>
        </CardContent>
      </Card>

      {/* ----- NOTES ----- */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Notes</CardTitle></CardHeader>
        <CardContent>
          <Textarea
            rows={3}
            value={proj?.notes ?? ''}
            onChange={e => setField({ notes: e.target.value })}
            onBlur={e => persist({ notes: e.target.value || null })}
            className="text-sm"
            placeholder="Anything that informs this projection…"
          />
        </CardContent>
      </Card>
    </div>
  );
}
