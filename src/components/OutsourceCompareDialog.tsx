import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { compareInhouseVsOutsourced, findExistingOutsourcedInr } from '@/lib/outsource-compare';
import type { CostingEngineInput } from '@/lib/costing-engine';

type Props = { open: boolean; onOpenChange: (o: boolean) => void; inquiryId: string; productIds: string[] };

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Money({ v, fx, className }: { v: number; fx: number; className?: string }) {
  return (
    <div className={cn('text-right tabular-nums', className)}>
      <div>{inr(v)}</div>
      <div className="text-[10px] text-muted-foreground">{usd(fx > 0 ? v / fx : 0)}</div>
    </div>
  );
}

export function OutsourceCompareDialog({ open, onOpenChange, inquiryId, productIds }: Props) {
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState<Array<{ product: any; input: CostingEngineInput }>>([]);
  const [prices, setPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      let q = (supabase as any).from('products').select('*').eq('customer_rfq_id', inquiryId).is('archived_at', null).order('sort_order');
      if (productIds.length) q = q.in('id', productIds);
      const products = ((await q).data || []).filter((p: any) => !p.is_component);
      const ids = products.map((p: any) => p.id);
      const empty = { data: [] as any[] };
      const byIds = (t: string) => (ids.length ? (supabase as any).from(t).select('*').in('product_id', ids) : Promise.resolve(empty));
      const [cogs, nu, oh, ship, cbm, shipTypes, emp, gs, pt, inq, diff, box, loc, chem, raw] = await Promise.all([
        byIds('cogs_items'), byIds('non_unit_cogs'), byIds('overhead_items'), byIds('shipping_items'), byIds('cbm_estimates'),
        supabase.from('shipping_types').select('*'),
        supabase.from('labor_employees').select('*'),
        supabase.from('global_settings').select('*').limit(1).single(),
        supabase.from('product_types').select('*'),
        (supabase as any).from('customer_rfqs').select('*').eq('id', inquiryId).maybeSingle(),
        (supabase as any).from('finishing_difficulty').select('name, adjustment_factor'),
        supabase.from('box_data').select('*'),
        (supabase as any).from('local_transport_locations').select('id, cost_per_cbm_inr'),
        supabase.from('chemical_prices').select('*'),
        (supabase as any).from('raw_material_costs').select('id, name, cost, unit_type, active'),
      ]);
      const f = (r: any, id: string) => (r.data || []).filter((x: any) => x.product_id === id);
      const built = products.map((p: any) => ({
        product: p,
        input: {
          product: p,
          cogsItems: f(cogs, p.id), nonUnitCogs: f(nu, p.id), overheadItems: f(oh, p.id), shippingItems: f(ship, p.id),
          cbmRow: f(cbm, p.id)[0] || null,
          productType: (pt.data || []).find((t: any) => t.id === p.product_type_id) || null,
          boxData: box.data || [], chemicalPrices: chem.data || [], shippingTypes: shipTypes.data || [],
          laborEmployees: emp.data || [], globalSettings: gs.data, inquiryOverrides: inq.data || null,
          locations: loc.data || [], difficulties: diff.data || [], rawMaterialCosts: raw.data || [],
        } as CostingEngineInput,
      }));
      const init: Record<string, string> = {};
      built.forEach(({ product, input }: any) => {
        const ex = findExistingOutsourcedInr(product, input.cogsItems);
        init[product.id] = ex != null ? String(Math.round(ex * 100) / 100) : '';
      });
      setInputs(built);
      setPrices(init);
      setLoading(false);
    })();
  }, [open, inquiryId, productIds.join(',')]);

  const rows = useMemo(() => inputs.map(({ product, input }) => {
    const v = prices[product.id];
    const n = v === '' || v == null ? null : Number(v);
    return { product, cmp: compareInhouseVsOutsourced(input, n != null && isFinite(n) ? n : null) };
  }), [inputs, prices]);

  const fx = rows[0]?.cmp.exchangeRate || 90;
  const compared = rows.filter(r => r.cmp.outsourced);
  const tot = compared.reduce((a, { cmp }) => ({
    inCost: a.inCost + cmp.inhouse.product_cost_per_unit_inr * cmp.qty,
    outCost: a.outCost + cmp.outsourced!.product_cost_per_unit_inr * cmp.qty,
    inVal: a.inVal + cmp.inhouse.unit_price_inr * cmp.qty,
    outVal: a.outVal + cmp.outsourced!.unit_price_inr * cmp.qty,
  }), { inCost: 0, outCost: 0, inVal: 0, outVal: 0 });

  const persist = async (productId: string) => {
    const v = prices[productId];
    const n = v === '' ? null : Number(v);
    const row = inputs.find(i => i.product.id === productId);
    const outRow = row?.input.cogsItems.find((c: any) => (c.component_name || '').toLowerCase() === 'outsourced product');
    if (outRow) await supabase.from('cogs_items').update({ unit_cost_inr: n ?? 0, components_per_product: 1 }).eq('id', outRow.id);
    else await (supabase as any).from('products').update({ outsourced_unit_cost_inr: n }).eq('id', productId);
  };

  const diffCell = (d: number, base: number) => (
    <div className={cn('text-right tabular-nums', d < 0 ? 'text-success' : d > 0 ? 'text-destructive' : '')}>
      <div>{d > 0 ? '+' : ''}{inr(d)}</div>
      <div className="text-[10px]">{base > 0 ? `${d > 0 ? '+' : ''}${((d / base) * 100).toFixed(1)}%` : '—'}</div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>In-house vs Outsourced</DialogTitle>
          <DialogDescription>
            Outsourced replaces raw materials, finishing, packaging, labour and order-level costs with the purchase price.
            Shipping, cost of capital and markup stay the same. Negative difference = outsourcing is cheaper.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['In-house order cost', tot.inCost],
                ['Outsourced order cost', tot.outCost],
                ['In-house order value', tot.inVal],
                ['Outsourced order value', tot.outVal],
              ].map(([l, v]) => (
                <div key={l as string} className="rounded-md border p-2">
                  <div className="text-[11px] text-muted-foreground">{l}</div>
                  <div className="font-semibold tabular-nums">{inr(v as number)}</div>
                  <div className="text-[11px] text-muted-foreground">{usd((v as number) / fx)}</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              Totals cover {compared.length} of {rows.length} products with an outsourced price. Difference:{' '}
              <span className={cn('font-medium', tot.outCost - tot.inCost < 0 ? 'text-success' : 'text-destructive')}>
                {inr(tot.outCost - tot.inCost)} cost / {inr(tot.outVal - tot.inVal)} value
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right w-32">Outsourced ₹/unit</TableHead>
                  <TableHead className="text-right">In-house unit cost</TableHead>
                  <TableHead className="text-right">Outsourced unit cost</TableHead>
                  <TableHead className="text-right">Unit diff</TableHead>
                  <TableHead className="text-right">In-house order value</TableHead>
                  <TableHead className="text-right">Outsourced order value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ product, cmp }) => {
                  const ic = cmp.inhouse.product_cost_per_unit_inr;
                  const oc = cmp.outsourced?.product_cost_per_unit_inr;
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="text-xs">
                        <div className="font-medium">{product.name}</div>
                        {product.sku && <div className="text-muted-foreground">{product.sku}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{cmp.qty}</TableCell>
                      <TableCell>
                        <Input
                          type="number" step="0.01" placeholder="Enter ₹"
                          className="h-8 text-right"
                          value={prices[product.id] ?? ''}
                          onChange={e => setPrices(s => ({ ...s, [product.id]: e.target.value }))}
                          onBlur={() => persist(product.id)}
                        />
                      </TableCell>
                      <TableCell><Money v={ic} fx={fx} /></TableCell>
                      <TableCell>{oc != null ? <Money v={oc} fx={fx} /> : <div className="text-right text-muted-foreground">—</div>}</TableCell>
                      <TableCell>{oc != null ? diffCell(oc - ic, ic) : null}</TableCell>
                      <TableCell><Money v={cmp.inhouse.unit_price_inr * cmp.qty} fx={fx} /></TableCell>
                      <TableCell>{cmp.outsourced ? <Money v={cmp.outsourced.unit_price_inr * cmp.qty} fx={fx} /> : <div className="text-right text-muted-foreground">—</div>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6} className="text-xs">Total (compared products)</TableCell>
                  <TableCell><Money v={tot.inVal} fx={fx} /></TableCell>
                  <TableCell><Money v={tot.outVal} fx={fx} /></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
