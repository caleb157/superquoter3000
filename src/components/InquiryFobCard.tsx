import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Ship } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { computeFob, type FobMode } from '@/lib/fob';
import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { fmt } from '@/lib/formatters';
import { FobEstimatePanel } from '@/components/FobEstimatePanel';

/**
 * Whole-inquiry FOB (origin) estimate. If `cbm`/`cartons` are passed (e.g. Container
 * Planner what-if quantities), those are used; otherwise the live inquiry pool is loaded.
 */
export function InquiryFobCard({ inquiryId, cbm, cartons, productCount, refreshKey }: {
  inquiryId: string; cbm?: number; cartons?: number; productCount?: number; refreshKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const [fx, setFx] = useState(0);
  const [ov, setOv] = useState<{ cbm: number | null; cartons: number | null; mode: FobMode | null }>({ cbm: null, cartons: null, mode: null });
  const [pool, setPool] = useState<{ cbm: number; cartons: number; count: number } | null>(null);
  const external = cbm != null && cartons != null;

  useEffect(() => {
    (async () => {
      const [gs, rfq] = await Promise.all([
        supabase.from('global_settings').select('exchange_rate').limit(1).maybeSingle(),
        supabase.from('customer_rfqs').select('fob_pool_cbm_override, fob_pool_cartons_override, fob_mode_override').eq('id', inquiryId).maybeSingle(),
      ]);
      setFx(Number((gs.data as any)?.exchange_rate) || 0);
      const r: any = rfq.data || {};
      setOv({
        cbm: r.fob_pool_cbm_override != null ? Number(r.fob_pool_cbm_override) : null,
        cartons: r.fob_pool_cartons_override != null ? Number(r.fob_pool_cartons_override) : null,
        mode: (r.fob_mode_override as FobMode) || null,
      });
    })();
  }, [inquiryId, refreshKey]);

  useEffect(() => {
    if (external) return;
    (async () => {
      const { data } = await supabase.from('products').select('id').eq('customer_rfq_id', inquiryId).is('archived_at', null);
      const ids = (data || []).map((p: any) => p.id);
      if (!ids.length) { setPool({ cbm: 0, cartons: 0, count: 0 }); return; }
      const map = await computeProductPriceAndCost(ids);
      let c = 0, k = 0;
      for (const id of ids) {
        const v = map[id]; if (!v) continue;
        c += v.quantity * v.final_unit_cbm;
        k += v.quantity > 0 ? Math.ceil(v.quantity / (v.products_per_mc || 1)) : 0;
      }
      setPool({ cbm: c, cartons: k, count: ids.length });
    })();
  }, [inquiryId, external, refreshKey]);

  const baseCbm = external ? cbm! : pool?.cbm ?? 0;
  const baseCartons = external ? cartons! : pool?.cartons ?? 0;
  const useCbm = ov.cbm ?? baseCbm;
  const useCartons = ov.cartons ?? baseCartons;
  if (!fx || useCbm <= 0) return null;

  const est = { ...computeFob('FOB_AUTO', useCbm, useCartons, fx, ov.mode), basis: 'product' as const };
  const hasOv = ov.cbm != null || ov.cartons != null || ov.mode != null;

  return (
    <Card>
      <CardContent className="pt-3 pb-3">
        <button className="flex w-full items-center gap-2 text-sm text-left" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Ship className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">FOB estimate</span>
          <span className="text-muted-foreground text-xs">
            {fmt.num(useCbm, 2)} CBM · {useCartons} cartons{(productCount ?? pool?.count) ? ` · ${productCount ?? pool?.count} products` : ''}
            {hasOv && ' · overrides applied'}
          </span>
          <span className="ml-auto font-mono text-xs">{est.selected.label}: {fmt.inr(est.selected.total_inr)} ({fmt.inr(est.selected.per_cbm_inr)}/CBM)</span>
        </button>
        {open && <FobEstimatePanel estimate={est} />}
      </CardContent>
    </Card>
  );
}
