import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { fmt } from '@/lib/formatters';
import {
  effectiveCertainty,
  weightedProjectedRevenue,
  projectedGrossProfit,
  effectiveManHours,
  suggestDefaultMonths,
  monthInputToDate,
  dateToMonthInput,
  type InquiryProjection,
} from '@/lib/projections';

type Props = { inquiryId: string };

const EMPTY: Partial<InquiryProjection> = {
  repeat_order: false,
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
        const [{ data: ohRows }, { data: cogsRows }, { data: nonUnitRows }, gsRes] = await Promise.all([
          (supabase as any).from('overhead_items').select('product_id, man_hours_per_unit, include').in('product_id', prodIds),
          (supabase as any).from('cogs_items').select('product_id, include, components_per_product, unit_cost_inr, waste_factor').in('product_id', prodIds),
          (supabase as any).from('non_unit_cogs').select('product_id, include, total_quantity, cost_each_inr').in('product_id', prodIds),
          (supabase as any).from('global_settings').select('exchange_rate').limit(1).maybeSingle(),
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

        // Auto FOB revenue + true GPM ((rev - cogs) / rev) from costing sheet
        const xr = Number(inq.data?.exchange_rate_override ?? (gsRes as any)?.data?.exchange_rate ?? 0);
        const cogsPerUnitInr: Record<string, number> = {};
        (cogsRows || []).forEach((r: any) => {
          if (r.include === 'No') return;
          const waste = Number(r.waste_factor || 0);
          const divisor = 1 - waste;
          const units = divisor > 0 ? Number(r.components_per_product || 0) / divisor : Number(r.components_per_product || 0);
          cogsPerUnitInr[r.product_id] = (cogsPerUnitInr[r.product_id] || 0) + Number(r.unit_cost_inr || 0) * units;
        });
        const nonUnitTotalInr: Record<string, number> = {};
        (nonUnitRows || []).forEach((r: any) => {
          if (r.include === 'No') return;
          nonUnitTotalInr[r.product_id] = (nonUnitTotalInr[r.product_id] || 0) + Number(r.total_quantity || 0) * Number(r.cost_each_inr || 0);
        });
        let totalRev = 0;
        let totalCogsUsd = 0;
        (prods.data || []).forEach((p: any) => {
          const qty = Number(p.quantity || 0);
          totalRev += Number(p.calculated_unit_price_usd || 0) * qty;
          const cogsInr = (cogsPerUnitInr[p.id] || 0) * qty + (nonUnitTotalInr[p.id] || 0);
          if (xr > 0) totalCogsUsd += cogsInr / xr;
        });
        setAutoFob(Math.round(totalRev * 100) / 100);
        setAutoGpm(totalRev > 0 ? (totalRev - totalCogsUsd) / totalRev : 0);
      } else {
        setProductMh([]);
        setAutoFob(0);
        setAutoGpm(0);
      }

      if (pr.data) {
        setProj(pr.data);
        setExisted(true);
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

  // Auto-suggest months when fob revenue is first entered and months are empty
  const maybeSuggestMonths = (patch: Partial<InquiryProjection>) => {
    const after = { ...(proj || {}), ...patch };
    if (after.projected_fob_revenue_usd && !after.start_month && !after.shipping_month && !after.delivery_month) {
      const suggested = suggestDefaultMonths(after.shipping_method ?? 'sea');
      return { ...patch, ...suggested };
    }
    return patch;
  };

  const autoCertainty = useMemo(() => {
    return effectiveCertainty({ certainty_override: null } as any, products as any, inquiryStatus);
  }, [products, inquiryStatus]);

  const effCertainty = useMemo(() => {
    return effectiveCertainty(proj as any, products as any, inquiryStatus);
  }, [proj, products, inquiryStatus]);

  const autoMh = useMemo(() => effectiveManHours({ estimated_man_hours: null } as any, productMh), [productMh]);
  const effMh = useMemo(() => effectiveManHours(proj as any, productMh), [proj, productMh]);

  const fob = Number(proj?.projected_fob_revenue_usd || 0);
  const gpm = Number(proj?.project_gpm || 0);
  const expectedRevenue = weightedProjectedRevenue(proj as any, effCertainty);
  const expectedGp = projectedGrossProfit(proj as any) * effCertainty;
  const ieTotal = fob * Number(proj?.inter_entity_markup_pct || 0);
  const vendorTotal = fob * (1 - gpm);

  const showIE = proj?.selling_entity_id && proj?.producing_entity_id && proj.selling_entity_id !== proj.producing_entity_id;

  if (loading) return <div className="text-sm text-muted-foreground p-8 text-center">Loading…</div>;

  const pct = (v: any) => v == null || v === '' ? '' : String(Math.round(Number(v) * 1000) / 10);
  const parsePct = (s: string) => s === '' ? null : Number(s) / 100;
  const monthInput = (v: any) => dateToMonthInput(v);
  const num = (v: any) => v == null || v === '' ? '' : String(v);

  const custMilestoneTotal = (Number(proj?.cust_deposit_pct || 0) + Number(proj?.cust_final_pct || 0) + Number(proj?.cust_other_pct || 0)) * 100;

  return (
    <div className="space-y-3">
      {/* Section 1 — Basics */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Basics</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
          </div>
          <div>
            <Label className="text-xs mb-2 block">Shipping method</Label>
            <RadioGroup
              value={proj?.shipping_method ?? ''}
              onValueChange={v => persist({ shipping_method: v as any })}
              className="flex gap-4"
            >
              {['air', 'sea', 'ground'].map(m => (
                <label key={m} className="flex items-center gap-1.5 text-sm capitalize cursor-pointer">
                  <RadioGroupItem value={m} /> {m}
                </label>
              ))}
            </RadioGroup>
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
        </CardContent>
      </Card>

      {/* Section 2 — Financials */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Financials</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Projected FOB revenue (USD)</Label>
            <Input
              type="number" step="0.01"
              placeholder={autoFob > 0 ? `Auto: $${fmt.usd(autoFob)}` : undefined}
              value={num(proj?.projected_fob_revenue_usd)}
              onChange={e => setField({ projected_fob_revenue_usd: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={e => {
                const val = e.target.value === '' ? null : Number(e.target.value);
                persist(maybeSuggestMonths({ projected_fob_revenue_usd: val }));
              }}
              className="h-9 mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Gross profit margin (%)</Label>
            <Input
              type="number" step="0.1" min={0} max={100}
              placeholder={autoGpm > 0 ? `Auto: ${(autoGpm * 100).toFixed(1)}%` : undefined}
              value={pct(proj?.project_gpm)}
              onChange={e => setField({ project_gpm: parsePct(e.target.value) })}
              onBlur={e => persist({ project_gpm: parsePct(e.target.value) })}
              className="h-9 mt-1"
            />
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
          </div>
          {(autoFob > 0 || autoGpm > 0) && (
            <div className="md:col-span-3 flex items-center gap-3 text-xs">
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  const patch: any = {};
                  if (autoFob > 0) patch.projected_fob_revenue_usd = autoFob;
                  if (autoGpm > 0) patch.project_gpm = Math.round(autoGpm * 10000) / 10000;
                  persist(maybeSuggestMonths(patch));
                }}
              >
                Pull from costing sheet
              </Button>
              <span className="text-muted-foreground">
                Revenue ${fmt.usd(autoFob)} · GPM {(autoGpm * 100).toFixed(1)}% (true GPM = (revenue − COGS) / revenue)
              </span>
            </div>
          )}
          <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t text-xs">
            <div><span className="text-muted-foreground">Effective certainty:</span> <span className="font-medium tabular-nums">{(effCertainty * 100).toFixed(1)}%</span></div>
            <div><span className="text-muted-foreground">Expected revenue:</span> <span className="font-medium tabular-nums">${fmt.usd(expectedRevenue)}</span></div>
            <div><span className="text-muted-foreground">Expected gross profit:</span> <span className="font-medium tabular-nums">${fmt.usd(expectedGp)}</span></div>
            <div className="md:col-span-3 text-[11px] text-muted-foreground">Stage-weighted certainty (used if no override): {(autoCertainty * 100).toFixed(1)}%</div>
          </div>
        </CardContent>
      </Card>

      {/* Section 3 — Man-Hours */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Man-Hours</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <Label className="text-xs">Estimated man-hours (override)</Label>
            <Input
              type="number" step="1"
              placeholder={`Auto: ${autoMh.toFixed(1)} MH`}
              value={num(proj?.estimated_man_hours)}
              onChange={e => setField({ estimated_man_hours: e.target.value === '' ? null : Number(e.target.value) })}
              onBlur={e => persist({ estimated_man_hours: e.target.value === '' ? null : Number(e.target.value) })}
              className="h-9 mt-1"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Auto-computed from products: <span className="font-medium text-foreground tabular-nums">{autoMh.toFixed(1)} MH</span>
            <div className="mt-1">Effective: <span className="font-medium text-foreground tabular-nums">{effMh.toFixed(1)} MH</span></div>
          </div>
          <div>
            <Button size="sm" variant="outline" onClick={() => persist({ estimated_man_hours: Math.round(autoMh * 10) / 10 })}>
              Use auto value
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Section 4 — Timeline */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Timeline</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Start month</Label>
            <Input type="month" value={monthInput(proj?.start_month)}
              onChange={e => persist({ start_month: monthInputToDate(e.target.value) })}
              className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Shipping month</Label>
            <Input type="month" value={monthInput(proj?.shipping_month)}
              onChange={e => persist({ shipping_month: monthInputToDate(e.target.value) })}
              className="h-9 mt-1" />
          </div>
          <div>
            <Label className="text-xs">Delivery month</Label>
            <Input type="month" value={monthInput(proj?.delivery_month)}
              onChange={e => persist({ delivery_month: monthInputToDate(e.target.value) })}
              className="h-9 mt-1" />
          </div>
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

      {/* Section 5 — Customer payments */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Customer Payments (to selling entity)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {[
            { name: 'Deposit', pctKey: 'cust_deposit_pct', monthKey: 'cust_deposit_month' },
            { name: 'Balance', pctKey: 'cust_final_pct', monthKey: 'cust_final_month' },
            { name: 'Other (optional)', pctKey: 'cust_other_pct', monthKey: 'cust_other_month' },
          ].map(row => {
            const pctV = Number((proj as any)?.[row.pctKey] || 0);
            const amt = fob * pctV;
            return (
              <div key={row.pctKey} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                <div className="text-xs font-medium md:pt-6">{row.name}</div>
                <div>
                  <Label className="text-xs">%</Label>
                  <Input type="number" step="1" min={0} max={100}
                    value={pct((proj as any)?.[row.pctKey])}
                    onChange={e => setField({ [row.pctKey]: parsePct(e.target.value) } as any)}
                    onBlur={e => persist({ [row.pctKey]: parsePct(e.target.value) } as any)}
                    className="h-9 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Month</Label>
                  <Input type="month" value={monthInput((proj as any)?.[row.monthKey])}
                    onChange={e => persist({ [row.monthKey]: monthInputToDate(e.target.value) } as any)}
                    className="h-9 mt-1" />
                </div>
                <div className="text-xs text-muted-foreground md:pt-6">
                  Amount: <span className="font-medium text-foreground tabular-nums">${fmt.usd(amt)}</span>
                </div>
              </div>
            );
          })}
          {Math.abs(custMilestoneTotal - 100) > 0.1 && (
            <div className="text-xs text-amber-600">
              Total: {custMilestoneTotal.toFixed(1)}% — does this include all payments?
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 6 — Inter-entity */}
      {showIE && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Inter-Entity Payments (selling → producing)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Inter-entity markup %</Label>
                <Input type="number" step="0.1" min={0} max={100}
                  placeholder="Selling entity's margin on producing entity's price"
                  value={pct(proj?.inter_entity_markup_pct)}
                  onChange={e => setField({ inter_entity_markup_pct: parsePct(e.target.value) })}
                  onBlur={e => persist({ inter_entity_markup_pct: parsePct(e.target.value) })}
                  className="h-9 mt-1" />
              </div>
              <div className="text-xs text-muted-foreground md:pt-6">
                IE total = FOB × markup = <span className="font-medium text-foreground tabular-nums">${fmt.usd(ieTotal)}</span>
              </div>
            </div>
            {[
              { name: 'Deposit', pctKey: 'ie_deposit_pct', monthKey: 'ie_deposit_month' },
              { name: 'Balance', pctKey: 'ie_balance_pct', monthKey: 'ie_balance_month' },
            ].map(row => {
              const pctV = Number((proj as any)?.[row.pctKey] || 0);
              return (
                <div key={row.pctKey} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                  <div className="text-xs font-medium md:pt-6">{row.name}</div>
                  <div>
                    <Label className="text-xs">%</Label>
                    <Input type="number" step="1" min={0} max={100}
                      value={pct((proj as any)?.[row.pctKey])}
                      onChange={e => setField({ [row.pctKey]: parsePct(e.target.value) } as any)}
                      onBlur={e => persist({ [row.pctKey]: parsePct(e.target.value) } as any)}
                      className="h-9 mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">Month</Label>
                    <Input type="month" value={monthInput((proj as any)?.[row.monthKey])}
                      onChange={e => persist({ [row.monthKey]: monthInputToDate(e.target.value) } as any)}
                      className="h-9 mt-1" />
                  </div>
                  <div className="text-xs text-muted-foreground md:pt-6">
                    Amount: <span className="font-medium text-foreground tabular-nums">${fmt.usd(ieTotal * pctV)}</span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Section 7 — Vendor */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Vendor Payments (producing entity → vendors)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            Vendor total = FOB × (1 − GPM) = <span className="font-medium text-foreground tabular-nums">${fmt.usd(vendorTotal)}</span>
          </div>
          {[
            { name: 'Deposit', pctKey: 'vendor_deposit_pct', monthKey: 'vendor_deposit_month' },
            { name: 'Balance', pctKey: 'vendor_balance_pct', monthKey: 'vendor_balance_month' },
          ].map(row => {
            const pctV = Number((proj as any)?.[row.pctKey] || 0);
            return (
              <div key={row.pctKey} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
                <div className="text-xs font-medium md:pt-6">{row.name}</div>
                <div>
                  <Label className="text-xs">%</Label>
                  <Input type="number" step="1" min={0} max={100}
                    value={pct((proj as any)?.[row.pctKey])}
                    onChange={e => setField({ [row.pctKey]: parsePct(e.target.value) } as any)}
                    onBlur={e => persist({ [row.pctKey]: parsePct(e.target.value) } as any)}
                    className="h-9 mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Month</Label>
                  <Input type="month" value={monthInput((proj as any)?.[row.monthKey])}
                    onChange={e => persist({ [row.monthKey]: monthInputToDate(e.target.value) } as any)}
                    className="h-9 mt-1" />
                </div>
                <div className="text-xs text-muted-foreground md:pt-6">
                  Amount: <span className="font-medium text-foreground tabular-nums">${fmt.usd(vendorTotal * pctV)}</span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Section 8 — Notes */}
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
