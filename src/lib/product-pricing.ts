// Compute current calculated unit prices (USD) for many products at once.
// Used by Dashboard for the weighted pipeline value so we no longer rely on target_price_usd.
import { supabase } from '@/integrations/supabase/client';
import * as calc from '@/lib/calculations';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';

export type ProductUnitPriceMap = Record<string, { unit_price_usd: number; unit_price_inr: number; exchange_rate: number }>;

export async function computeProductUnitPrices(productIds: string[]): Promise<ProductUnitPriceMap> {
  const out: ProductUnitPriceMap = {};
  if (productIds.length === 0) return out;

  const empty = { data: [] as any[] } as any;
  const [
    productsRes,
    cogsRes,
    nuRes,
    ohRes,
    shipItemsRes,
    shipTypesRes,
    empRes,
    gsRes,
    cbmRes,
    ptRes,
    inquiriesRes,
  ] = await Promise.all([
    supabase.from('products').select('*').in('id', productIds),
    supabase.from('cogs_items').select('*').in('product_id', productIds),
    supabase.from('non_unit_cogs').select('*').in('product_id', productIds),
    supabase.from('overhead_items').select('*').in('product_id', productIds),
    supabase.from('shipping_items').select('*').in('product_id', productIds),
    supabase.from('shipping_types').select('*'),
    supabase.from('labor_employees').select('*'),
    supabase.from('global_settings').select('*').limit(1).single(),
    supabase.from('cbm_estimates').select('*').in('product_id', productIds),
    supabase.from('product_types').select('*'),
    supabase.from('customer_rfqs').select('id, exchange_rate_override, markup_percent_override, shipping_type_id_override, indirect_overhead_monthly_override, available_hours_per_month_override, num_laborers_override, packaging_cost_per_cbm_override, auto_transport_cost_per_cbm_override, local_transport_cost_per_cbm_override, contractor_to_inhouse_decrease_override'),
  ]);

  const products = productsRes.data || [];
  const cogs = cogsRes.data || [];
  const allNu = nuRes.data || [];
  const allOh = ohRes.data || [];
  const allShipItems = shipItemsRes.data || [];
  const shipTypes = shipTypesRes.data || [];
  const employees = empRes.data || [];
  const gs = gsRes.data as any;
  const allCbm = cbmRes.data || [];
  const productTypes = ptRes.data || [];
  const inquiries = inquiriesRes.data || [];
  const inquiryById = Object.fromEntries(inquiries.map((i: any) => [i.id, i]));

  for (const p of products as any[]) {
    const inq = p.customer_rfq_id ? inquiryById[p.customer_rfq_id] : null;
    const settings = mergeSettingsWithInquiry(gs, inq);
    const exchangeRate = settings?.exchange_rate ?? 90;
    const markupPercent = inq?.markup_percent_override ?? p.markup_percent ?? 0.2;
    const qty = p.quantity || 100;

    const productCogs = cogs.filter((c: any) => c.product_id === p.id && c.include !== 'No');
    const cogsPerUnit = productCogs.reduce((sum: number, item: any) => {
      const c = calc.calcCogsItemCost({
        include: item.include,
        components_per_product: item.components_per_product || 0,
        unit_cost_inr: item.unit_cost_inr || 0,
        waste_factor: item.waste_factor || 0,
      });
      return sum + c.unit_cost;
    }, 0);

    const productNuCogs = allNu.filter((n: any) => n.product_id === p.id);
    const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
      productNuCogs.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity || 0, cost_each_inr: i.cost_each_inr || 0 })),
      qty,
    );

    const productOh = allOh.filter((o: any) => o.product_id === p.id);
    const productType = productTypes.find((pt: any) => pt.id === p.product_type_id);
    const w = p.width_inch || 0;
    const d = p.depth_inch || 0;
    const h = p.height_inch || 0;
    const ri = calc.runningInches(w, d, h);
    const difficultyFactor = calc.getDifficultyFactor(p.finishing_difficulty || 'Medium');
    const cbmRow = allCbm.find((c: any) => c.product_id === p.id);
    const finalUnitCbm = cbmRow?.final_unit_cbm || 0;

    const avgFinishingRate = calc.avgRateByDesignation(employees, 'Finishing') || calc.avgRateByDesignation(employees, 'Sanding');
    const contractorRate = productType?.contractor_base_rate_per_ri || 0;
    const decrease = settings?.contractor_to_inhouse_decrease || 0;
    const finishingMh = calc.calcFinishingLaborMhPerUnit(contractorRate, decrease, difficultyFactor, avgFinishingRate, ri);
    const packagingMh = calc.calcPackagingLaborMhPerUnit(productType?.packaging_mh_per_cbm || 0, finalUnitCbm);

    const ohItems = productOh.map((item: any) => {
      let mh = item.man_hours_per_unit || 0;
      if (item.is_auto_estimated) {
        if (item.labor_type === 'Finishing' && finishingMh > 0) mh = parseFloat(finishingMh.toFixed(4));
        else if (item.labor_type === 'Packaging' && packagingMh > 0) mh = parseFloat(packagingMh.toFixed(4));
      }
      return {
        include: item.include,
        labor_type: item.labor_type,
        man_hours_per_unit: mh,
        hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
      };
    });
    const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
    const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
    const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs) : 0;
    const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

    const shipItem = allShipItems.find((s: any) => s.product_id === p.id);
    const overrideShipType = inq?.shipping_type_id_override
      ? shipTypes.find((s: any) => s.id === inq.shipping_type_id_override)
      : null;
    const shipType = overrideShipType || (shipItem ? shipTypes.find((t: any) => t.id === shipItem.shipping_type_id) : null);
    const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
      cost_inr: shipType.cost_inr,
      per_unit: shipType.per_unit as 'CBM' | 'KG',
      final_unit_cbm: finalUnitCbm,
      weight_kg: p.weight_kg || 0,
    }) : 0;

    const summary = calc.calcProductCostSummary(
      cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
      shippingPerUnit, markupPercent, exchangeRate, qty,
    );

    out[p.id] = {
      unit_price_usd: summary.unit_price_usd,
      unit_price_inr: summary.unit_price_inr,
      exchange_rate: exchangeRate,
    };
  }

  return out;
}
