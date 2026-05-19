// Compute current calculated unit prices (USD) for many products at once.
// Used by Dashboard for the weighted pipeline value so we no longer rely on target_price_usd.
//
// IMPORTANT: This module mirrors the auto-calculations performed by ProductCostingTab
// in-memory so prices stay consistent with the costing sheet even when the user
// has not opened the costing tab to flush the latest auto-cost values to DB.
import { supabase } from '@/integrations/supabase/client';
import * as calc from '@/lib/calculations';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';

let _difficultiesCache: Array<{ name: string; adjustment_factor: number }> | null = null;
let _locationsCache: Array<{ id: string; cost_per_cbm_inr: number }> | null = null;

export type ProductPriceCostMap = Record<string, {
  unit_cost_usd: number;     // FOB cost, no markup (used by Dashboard pipeline)
  unit_price_usd: number;    // cost + markup (used by quotes)
  unit_price_inr: number;
  exchange_rate: number;
}>;

// Back-compat alias for older imports
export type ProductUnitPriceMap = ProductPriceCostMap;

export async function computeProductPriceAndCost(productIds: string[]): Promise<ProductPriceCostMap> {
  const out: ProductPriceCostMap = {};
  if (productIds.length === 0) return out;

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
    chemRes,
    boxRes,
    diffRes,
    locRes,
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
    supabase.from('customer_rfqs').select('id, exchange_rate_override, markup_percent_override, shipping_type_id_override, indirect_overhead_monthly_override, total_available_mh_per_month_override, packaging_cost_per_cbm_override, auto_transport_cost_per_cbm_override, local_transport_cost_per_cbm_override'),
    supabase.from('chemical_prices').select('*'),
    supabase.from('box_data').select('*'),
    (supabase as any).from('finishing_difficulty').select('name, adjustment_factor'),
    (supabase as any).from('local_transport_locations').select('id, cost_per_cbm_inr'),
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
  const chemicalPrices = chemRes.data || [];
  const boxData = boxRes.data || [];
  const difficulties: any[] = (diffRes as any).data || [];
  const locations: any[] = (locRes as any).data || [];
  _difficultiesCache = difficulties as any;
  _locationsCache = locations as any;

  // Pre-compute global chemical lookups
  const colorPrice = (chemicalPrices.find((c: any) => c.category === 'Color') as any)?.price_per_litre_inr || 0;
  const sealerPrice = (chemicalPrices.find((c: any) => c.category === 'Sealer') as any)?.price_per_litre_inr || 0;
  const lacquerPrice = (chemicalPrices.find((c: any) => c.category === 'Lacquer' && (c as any).name?.includes('NC')) as any)?.price_per_litre_inr ||
                       (chemicalPrices.find((c: any) => c.category === 'Lacquer') as any)?.price_per_litre_inr || 0;

  for (const p of products as any[]) {
    const inq = p.customer_rfq_id ? inquiryById[p.customer_rfq_id] : null;
    const settings = mergeSettingsWithInquiry(gs, inq);
    const exchangeRate = settings?.exchange_rate ?? 90;
    const markupPercent = inq?.markup_percent_override ?? p.markup_percent ?? 0.2;
    const qty = p.quantity || 100;
    const w = p.width_inch || 0;
    const d = p.depth_inch || 0;
    const h = p.height_inch || 0;
    const ri = calc.runningInches(w, d, h);
    const prePackCbm = calc.prePackagedCbm(w, d, h);
    const percentWood = p.percent_wood || 1;
    const productType = productTypes.find((pt: any) => pt.id === p.product_type_id) as any;
    const cbmRow = allCbm.find((c: any) => c.product_id === p.id) as any;

    // ===== In-memory COGS auto-overrides (mirror ProductCostingTab) =====
    const productCogs = (cogs as any[]).filter((c: any) => c.product_id === p.id);

    // Compute IC/MC dims & costs to override packaging COGS unit_cost_inr / qty
    const icAdd = productType?.pkg_ic_add_per_side_in ?? 0.5;
    const icType = cbmRow?.ic_type || '7 ply';
    const mcType = cbmRow?.mc_type || '7 ply';
    const packagingType: 'no_packaging' | 'ic_only' | 'ic_mc' | 'corrugate_bubble' = p.packaging_type || 'ic_mc';
    const includeMc = packagingType === 'ic_mc';
    const noPackaging = packagingType === 'no_packaging';
    const finalUnitCbm = noPackaging ? prePackCbm : (cbmRow?.final_unit_cbm || 0);

    const autoIcDims = calc.calcICDimensions(w, d, h, icAdd);
    const icDims = {
      ic_width: cbmRow?.ic_width ?? autoIcDims.ic_width,
      ic_depth: cbmRow?.ic_depth ?? autoIcDims.ic_depth,
      ic_height: cbmRow?.ic_height ?? autoIcDims.ic_height,
    };
    const icBoxes = (boxData as any[]).filter((b: any) => b.box_type === icType && b.cost_per_sq_in > 0);
    const avgIcCostPerSqIn = icBoxes.length > 0
      ? icBoxes.reduce((s: number, b: any) => s + b.cost_per_sq_in, 0) / icBoxes.length
      : 0;
    const icCost = calc.calcICCostEstimate(icDims.ic_width, icDims.ic_depth, icDims.ic_height, avgIcCostPerSqIn);

    let mcCost = 0;
    let productsPerMc = 1;
    if (includeMc) {
      const productsPerIc = cbmRow?.products_per_ic || 1;
      const mcResult = calc.calcMCPacking({
        include_mc: true,
        mc_type: mcType,
        mc_max_width: cbmRow?.mc_max_width || 25,
        mc_max_depth: cbmRow?.mc_max_depth || 25,
        mc_max_height: cbmRow?.mc_max_height || 25,
        mc_buffer_inch: cbmRow?.mc_buffer_inch || 1,
        mc_height_buffer_inch: cbmRow?.mc_height_buffer_inch ?? gs?.mc_height_buffer_inch ?? 2.5,
        mc_weight_limit_kg: cbmRow?.mc_weight_limit_kg || 20,
        mc_empty_weight_kg: cbmRow?.mc_empty_weight_kg || 1.5,
        product_weight_kg: p.weight_kg || 0,
        quantity: qty,
        products_per_ic: productsPerIc,
        ic_width: icDims.ic_width,
        ic_depth: icDims.ic_depth,
        ic_height: icDims.ic_height,
      });
      const mcBoxes = (boxData as any[]).filter((b: any) => b.box_type === mcType && b.cost_per_sq_in > 0);
      const avgMcCostPerSqIn = mcBoxes.length > 0
        ? mcBoxes.reduce((s: number, b: any) => s + b.cost_per_sq_in, 0) / mcBoxes.length
        : 0;
      mcCost = calc.calcICCostEstimate(mcResult.mc_width, mcResult.mc_depth, mcResult.mc_height, avgMcCostPerSqIn);
      productsPerMc = mcResult.products_per_mc || 1;
    }

    // Wrapping (Corrugate + Bubble) overrides
    const isWrapMode = packagingType === 'corrugate_bubble';
    const wrappingResult = calc.calcCorrugateBubblePackaging(w, d, h, icAdd, {
      corrugate_kg_per_sq_in: (gs as any)?.corrugate_kg_per_sq_in ?? 0.25,
      bubble_kg_per_sq_in: (gs as any)?.bubble_kg_per_sq_in ?? 0.20,
      corrugate_price_per_kg: (gs as any)?.corrugate_price_per_kg ?? 0,
      bubble_price_per_kg: (gs as any)?.bubble_price_per_kg ?? 0,
    });

    // Apply in-memory overrides for auto-calc rows so cost stays in sync with costing sheet
    const productsPerIc = cbmRow?.products_per_ic || 1;
    const transportRate = (settings as any)?.local_transport_cost_per_cbm || 3500;
    const cogsForCalc = productCogs.map((item: any) => {
      const name = (item.component_name || '').toLowerCase();
      const type = item.cogs_type;
      // Auto-calc rows: mirror ProductCostingTab's force-on/off behavior for packaging
      if (item.is_auto_calculated && type === 'Packaging') {
        if (name.includes('ic box') || name.includes('inner carton') || name === 'ic') {
          const defaultIncluded = !noPackaging && !isWrapMode;
          return { ...item, include: defaultIncluded && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
            components_per_product: defaultIncluded ? (productsPerIc > 0 ? 1 / productsPerIc : 0) : 0,
            unit_cost_inr: defaultIncluded ? icCost : 0 };
        }
        if (name.includes('mc box') || name.includes('master carton') || name.includes('outer carton')) {
          const useMc = !noPackaging && includeMc && productsPerMc > 0;
          return { ...item, include: useMc && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
            components_per_product: useMc ? 1 / productsPerMc : 0,
            unit_cost_inr: useMc ? mcCost : 0 };
        }
        if (name === 'corrugate wrap') {
          const defaultIncluded = !noPackaging && isWrapMode;
          return { ...item, include: defaultIncluded && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
            components_per_product: defaultIncluded ? wrappingResult.corrugate_kg : 0,
            unit_cost_inr: defaultIncluded ? ((gs as any)?.corrugate_price_per_kg ?? 0) : 0 };
        }
        if (name === 'bubble wrap') {
          const defaultIncluded = !noPackaging && isWrapMode;
          return { ...item, include: defaultIncluded && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
            components_per_product: defaultIncluded ? wrappingResult.bubble_kg : 0,
            unit_cost_inr: defaultIncluded ? ((gs as any)?.bubble_price_per_kg ?? 0) : 0 };
        }
      }
      if (item.include === 'No') return item;
      if (!item.is_auto_calculated) {
        // Domestic Freight (External Sourcing) is not auto_calculated but is name-driven
        if (item.component_name === 'Domestic Freight (External Sourcing)' && p.sourced_externally) {
          return { ...item, components_per_product: prePackCbm, unit_cost_inr: transportRate };
        }
        return item;
      }
      // Finishing materials
      if (type === 'Finishing Materials') {
        if (name.includes('color') || name.includes('stain')) {
          const qtyL = calc.calcFinishingMaterialQty(productType?.finishing_color_per_100ri || 0, ri, percentWood);
          return { ...item, components_per_product: qtyL, unit_cost_inr: colorPrice };
        }
        if (name.includes('sealer')) {
          const qtyL = calc.calcFinishingMaterialQty(productType?.finishing_sealer_per_100ri || 0, ri, percentWood);
          return { ...item, components_per_product: qtyL, unit_cost_inr: sealerPrice };
        }
        if (name.includes('lacquer')) {
          const qtyL = calc.calcFinishingMaterialQty(productType?.finishing_lacquer_per_100ri || 0, ri, percentWood);
          return { ...item, components_per_product: qtyL, unit_cost_inr: lacquerPrice };
        }
      }
      return item;
    });

    const cogsPerUnit = cogsForCalc
      .filter((c: any) => c.include !== 'No' && !(noPackaging && c.cogs_type === 'Packaging'))
      .reduce((sum: number, item: any) => {
        const c = calc.calcCogsItemCost({
          include: item.include,
          components_per_product: item.components_per_product || 0,
          unit_cost_inr: item.unit_cost_inr || 0,
          waste_factor: item.waste_factor || 0,
        });
        return sum + c.unit_cost;
      }, 0);

    // Non-unit COGS (apply Auto Transport override in memory)
    const productNuCogs = (allNu as any[]).filter((n: any) => n.product_id === p.id);
    const autoTransportRate = (settings as any)?.auto_transport_cost_per_cbm || 500;
    const nuForCalc = productNuCogs.map((item: any) => {
      if (item.name === 'Auto Transport') {
        const totalCbm = +(finalUnitCbm * qty).toFixed(4);
        return { ...item, total_quantity: totalCbm, cost_each_inr: autoTransportRate };
      }
      return item;
    });
    const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
      nuForCalc.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity || 0, cost_each_inr: i.cost_each_inr || 0 })),
      qty,
    );

    // Overhead (auto-estimated finishing/packaging mh applied in-memory)
    const productOh = (allOh as any[]).filter((o: any) => o.product_id === p.id);
    const difficultyFactor = calc.getDifficultyFactor(p.finishing_difficulty || 'Medium');
    const avgFinishingRate = calc.avgRateByDesignation(employees as any, 'Finishing') || calc.avgRateByDesignation(employees as any, 'Sanding');
    const contractorRate = productType?.contractor_base_rate_per_ri || 0;
    const decrease = (settings as any)?.contractor_to_inhouse_decrease || 0;
    const finishingMh = calc.calcFinishingLaborMhPerUnit(contractorRate, decrease, difficultyFactor, avgFinishingRate, ri, percentWood);
    const packagingMh = noPackaging ? 0 : calc.calcPackagingLaborMhPerUnit(productType?.packaging_mh_per_cbm || 0, finalUnitCbm);

    const ohItems = productOh.map((item: any) => {
      let mh = item.man_hours_per_unit || 0;
      if (item.is_auto_estimated) {
        if (item.labor_type === 'Finishing' && finishingMh > 0) mh = parseFloat(finishingMh.toFixed(4));
        else if (item.labor_type === 'Packaging' && packagingMh > 0) mh = parseFloat(packagingMh.toFixed(4));
      }
      return {
        include: noPackaging && item.labor_type === 'Packaging' ? 'No' : item.include,
        labor_type: item.labor_type,
        man_hours_per_unit: noPackaging && item.labor_type === 'Packaging' ? 0 : mh,
        hourly_rate: calc.avgRateByDesignation(employees as any, item.labor_type),
      };
    });
    const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
    const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
    const indirectOhPerMh = settings ? calc.calcIndirectOhPerManHour(settings as any) : 0;
    const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

    // Shipping
    const shipItem = (allShipItems as any[]).find((s: any) => s.product_id === p.id);
    const overrideShipType = inq?.shipping_type_id_override
      ? (shipTypes as any[]).find((s: any) => s.id === inq.shipping_type_id_override)
      : null;
    const shipType = overrideShipType || (shipItem ? (shipTypes as any[]).find((t: any) => t.id === shipItem.shipping_type_id) : null);
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
      unit_cost_usd: summary.product_cost_per_unit_usd,
      unit_price_usd: summary.unit_price_usd,
      unit_price_inr: summary.unit_price_inr,
      exchange_rate: exchangeRate,
    };
  }

  return out;
}

// Back-compat alias for older imports
export const computeProductUnitPrices = computeProductPriceAndCost;
