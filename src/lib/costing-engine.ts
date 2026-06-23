// Pure costing engine — single source of truth for per-unit cost/price orchestration.
//
// Convention: pass `inquiryOverrides` RAW (the un-merged customer_rfqs row, or null).
// The engine internally calls mergeSettingsWithInquiry(globalSettings, inquiryOverrides)
// to produce the effective settings. This keeps callers from accidentally merging twice.
//
// This module is pure: NO React, NO supabase, NO side effects. All inputs are plain data.
// Ported byte-for-byte from product-pricing.ts (per-product loop body). Zero formula changes.

import * as calc from '@/lib/calculations';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';

export type CostingEngineInput = {
  product: any;
  cogsItems: any[];
  nonUnitCogs: any[];
  overheadItems: any[];
  shippingItems: any[];
  cbmRow: any | null;
  productType: any | null;
  boxData: any[];
  chemicalPrices: any[];
  shippingTypes: any[];
  laborEmployees: any[];
  globalSettings: any;
  inquiryOverrides: any | null; // RAW customer_rfqs row (un-merged)
  locations: any[];             // local_transport_locations
  difficulties: any[];          // finishing_difficulty
  rawMaterialCosts?: any[];     // for bulk_pack foam lookup
};

export type CostingEngineResult = {
  summary: ReturnType<typeof calc.calcProductCostSummary>;
  exchangeRate: number;
  markupPercent: number;
  cogsPerUnit: number;
  nonUnitCogsPerUnit: number;
  directOhPerUnit: number;
  indirectOhPerUnit: number;
  shippingPerUnit: number;
  manHoursPerUnit: number;
  resolvedCogsRows: any[];
  icDims: { ic_width: number; ic_depth: number; ic_height: number };
  icOd: { ic_od_width: number; ic_od_depth: number; ic_od_height: number };
  icCost: number;
  mcDims: { mc_width: number; mc_depth: number; mc_height: number };
  mcCost: number;
  productsPerIc: number;
  productsPerMc: number;
  finalUnitCbm: number;
  ri: number;
  prePackCbm: number;
  difficultyFactor: number;
  bulkPack?: {
    pieces_per_mc: number;
    mc_width: number;
    mc_depth: number;
    mc_height: number;
    mc_volume_cbm: number;
    column_height_in: number;
    foam_sq_in_per_piece: number;
    warning?: string;
  };
};

export function computeProductCosting(input: CostingEngineInput): CostingEngineResult {
  const {
    product: p,
    cogsItems: productCogs,
    nonUnitCogs: productNuCogs,
    overheadItems: productOh,
    shippingItems,
    cbmRow,
    productType,
    boxData,
    chemicalPrices,
    shippingTypes: shipTypes,
    laborEmployees: employees,
    globalSettings: gs,
    inquiryOverrides: inq,
    locations,
    difficulties,
  } = input;

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

  // Chemical lookups (unit-aware, with legacy fallback)
  const priceOf = (c: any) => Number(c?.price_per_unit_inr ?? c?.price_per_litre_inr ?? 0);
  const unitOf = (c: any) => (c?.unit_type || 'L') as string;
  const chemById = new Map<string, any>((chemicalPrices as any[]).map((c: any) => [c.id, c]));
  const firstByCat = (cat: string) => (chemicalPrices as any[]).find((c: any) => c.category === cat);
  const lacquerChem = (chemicalPrices as any[]).find((c: any) => c.category === 'Lacquer' && (c.name || '').includes('NC')) || firstByCat('Lacquer');
  const colorChem = firstByCat('Color');
  const sealerChem = firstByCat('Sealer');
  const waxChem = firstByCat('Wax');

  // ===== IC/MC dims & costs =====
  const icAdd = productType?.pkg_ic_add_per_side_in ?? 0.5;
  const icType = cbmRow?.ic_type || '7 ply';
  const mcType = cbmRow?.mc_type || '7 ply';
  const packagingType: 'no_packaging' | 'ic_only' | 'ic_mc' | 'corrugate_bubble' | 'bulk_pack' = p.packaging_type || 'ic_mc';
  const includeMc = packagingType === 'ic_mc';
  const isBulkPack = packagingType === 'bulk_pack';
  const noPackaging = packagingType === 'no_packaging';
  let finalUnitCbm = noPackaging ? prePackCbm : (cbmRow?.final_unit_cbm || 0);

  const autoIcDims = calc.calcICDimensions(w, d, h, icAdd);
  const icDims = {
    ic_width: cbmRow?.ic_width ?? autoIcDims.ic_width,
    ic_depth: cbmRow?.ic_depth ?? autoIcDims.ic_depth,
    ic_height: cbmRow?.ic_height ?? autoIcDims.ic_height,
  };
  const icOd = {
    ic_od_width: (autoIcDims as any).ic_od_width ?? icDims.ic_width,
    ic_od_depth: (autoIcDims as any).ic_od_depth ?? icDims.ic_depth,
    ic_od_height: (autoIcDims as any).ic_od_height ?? icDims.ic_height,
  };
  const icBoxes = (boxData as any[]).filter((b: any) => b.box_type === icType && b.cost_per_sq_in > 0);
  const avgIcCostPerSqIn = icBoxes.length > 0
    ? icBoxes.reduce((s: number, b: any) => s + b.cost_per_sq_in, 0) / icBoxes.length
    : 0;
  const icCost = calc.calcICCostEstimate(icDims.ic_width, icDims.ic_depth, icDims.ic_height, avgIcCostPerSqIn);

  let mcCost = 0;
  let productsPerMc = 1;
  let mcDims = { mc_width: 0, mc_depth: 0, mc_height: 0 };
  const productsPerIc = cbmRow?.products_per_ic || 1;
  if (includeMc) {
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
    mcDims = { mc_width: mcResult.mc_width, mc_depth: mcResult.mc_depth, mc_height: mcResult.mc_height };
  }

  // Wrapping (Corrugate + Bubble) overrides
  const isWrapMode = packagingType === 'corrugate_bubble';
  const wrappingResult = calc.calcCorrugateBubblePackaging(w, d, h, icAdd, {
    corrugate_kg_per_sq_in: (gs as any)?.corrugate_kg_per_sq_in ?? 0.25,
    bubble_kg_per_sq_in: (gs as any)?.bubble_kg_per_sq_in ?? 0.20,
    corrugate_price_per_kg: (gs as any)?.corrugate_price_per_kg ?? 0,
    bubble_price_per_kg: (gs as any)?.bubble_price_per_kg ?? 0,
  });

  // Bulk pack: derive box size from user's chosen pieces-per-box & shrink factor.
  let bulkPackInfo: CostingEngineResult['bulkPack'] = undefined;
  const foamSurfaceSqInPerPiece = calc.surfaceAreaSqIn(w, d, h);
  const rawMatList = (input as any).rawMaterialCosts || [];
  const foamRow = (rawMatList as any[]).find((r: any) =>
    r?.active !== false && /foam/i.test(String(r?.name || ''))
  );
  const foamPricePerSqIn = Number(foamRow?.cost) || 0;
  if (isBulkPack) {
    const bulkRes = calc.calcBulkPacking({
      piece_width: w,
      piece_depth: d,
      piece_height: h,
      pieces_per_box: p.bulk_pieces_per_box || 1,
      shrink_factor: p.bulk_shrink_factor ?? 1,
      mc_buffer_inch: cbmRow?.mc_buffer_inch || 1,
      mc_height_buffer_inch: cbmRow?.mc_height_buffer_inch ?? gs?.mc_height_buffer_inch ?? 2.5,
    });
    const mcBoxes2 = (boxData as any[]).filter((b: any) => b.box_type === mcType && b.cost_per_sq_in > 0);
    const avgMcCostPerSqIn2 = mcBoxes2.length > 0
      ? mcBoxes2.reduce((s: number, b: any) => s + b.cost_per_sq_in, 0) / mcBoxes2.length
      : 0;
    mcCost = calc.calcICCostEstimate(bulkRes.mc_width, bulkRes.mc_depth, bulkRes.mc_height, avgMcCostPerSqIn2);
    productsPerMc = bulkRes.pieces_per_mc || 1;
    mcDims = { mc_width: bulkRes.mc_width, mc_depth: bulkRes.mc_depth, mc_height: bulkRes.mc_height };
    finalUnitCbm = productsPerMc > 0 ? bulkRes.mc_volume_cbm / productsPerMc : 0;

    // Optional non-blocking warning when the user-chosen count exceeds MC max size or weight
    const maxW = cbmRow?.mc_max_width || 0;
    const maxD = cbmRow?.mc_max_depth || 0;
    const maxH = cbmRow?.mc_max_height || 0;
    const weightLimit = cbmRow?.mc_weight_limit_kg || 0;
    const mcEmpty = cbmRow?.mc_empty_weight_kg || 0;
    const stackWeight = productsPerMc * (p.weight_kg || 0) + mcEmpty;
    const exceedsSize =
      (maxW > 0 && bulkRes.mc_width > maxW) ||
      (maxD > 0 && bulkRes.mc_depth > maxD) ||
      (maxH > 0 && bulkRes.mc_height > maxH);
    const exceedsWeight = weightLimit > 0 && stackWeight > weightLimit;
    bulkPackInfo = {
      pieces_per_mc: bulkRes.pieces_per_mc,
      mc_width: bulkRes.mc_width,
      mc_depth: bulkRes.mc_depth,
      mc_height: bulkRes.mc_height,
      mc_volume_cbm: bulkRes.mc_volume_cbm,
      column_height_in: bulkRes.column_height_in,
      foam_sq_in_per_piece: foamSurfaceSqInPerPiece,
      warning: exceedsSize || exceedsWeight
        ? 'This box exceeds your MC max size/weight — adjust pieces per box if needed.'
        : undefined,
    };
  }

  // Apply in-memory overrides for auto-calc COGS rows
  const cogsForCalc = productCogs.map((item: any) => {
    const name = (item.component_name || '').toLowerCase();
    const type = item.cogs_type;
    if (item.is_auto_calculated && type === 'Packaging') {
      if (name.includes('ic box') || name.includes('inner carton') || name === 'ic') {
        const defaultIncluded = !noPackaging && !isWrapMode && !isBulkPack;
        return { ...item, include: defaultIncluded && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
          components_per_product: defaultIncluded ? (productsPerIc > 0 ? 1 / productsPerIc : 0) : 0,
          unit_cost_inr: defaultIncluded ? icCost : 0 };
      }
      if (name.includes('mc box') || name.includes('master carton') || name === 'outer carton') {
        const useMc = !noPackaging && (includeMc || isBulkPack) && productsPerMc > 0;
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
      if (name.includes('foam') || name.includes('bulk pack')) {
        // Bulk-pack foam: surface area per piece × foam price per sq in (from raw_material_costs).
        const defaultIncluded = isBulkPack;
        return { ...item, include: defaultIncluded && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
          components_per_product: defaultIncluded ? foamSurfaceSqInPerPiece : 0,
          unit_cost_inr: defaultIncluded ? foamPricePerSqIn : 0,
          units: 'sq in' };
      }
    }
    if (item.include === 'No') return item;
    if (!item.is_auto_calculated) {
      if (item.component_name === 'Domestic Freight (External Sourcing)' && p.source_location_id) {
        const loc = locations.find((l: any) => l.id === p.source_location_id);
        const locRate = Number(loc?.cost_per_cbm_inr) || 0;
        return { ...item, components_per_product: prePackCbm, unit_cost_inr: locRate };
      }
      return item;
    }
    if (type === 'Finishing Materials') {
      const linked = item.chemical_price_id ? chemById.get(item.chemical_price_id) : null;
      const cat = (linked?.category || '').toLowerCase();
      const useChem = (chem: any, qty: number) => ({ ...item, components_per_product: qty, unit_cost_inr: priceOf(chem), units: unitOf(chem) });

      if (cat === 'wax' || (!linked && name.includes('wax'))) {
        const grams = calc.calcWaxGrams(w, d, h, productType?.finishing_wax_g_per_sqin || 0, percentWood);
        return useChem(linked || waxChem, grams);
      }
      if (cat === 'color' || (!linked && (name.includes('color') || name.includes('stain')))) {
        const q = calc.calcFinishingMaterialQty(productType?.finishing_color_per_100ri || 0, ri, percentWood);
        return useChem(linked || colorChem, q);
      }
      if (cat === 'sealer' || (!linked && name.includes('sealer'))) {
        const q = calc.calcFinishingMaterialQty(productType?.finishing_sealer_l_per_100ri || 0, ri, percentWood);
        return useChem(linked || sealerChem, q);
      }
      if (cat === 'lacquer' || (!linked && name.includes('lacquer'))) {
        const q = calc.calcFinishingMaterialQty(productType?.finishing_lacquer_per_100ri || 0, ri, percentWood);
        return useChem(linked || lacquerChem, q);
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

  // Non-unit COGS (Auto Transport in-memory override)
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
  const diffName = p.finishing_difficulty || 'Medium';
  const difficultyFactor = (difficulties.find((d: any) => d.name === diffName)?.adjustment_factor)
    ?? calc.getDifficultyFactor(diffName);
  const finishingMhPer100Ri = Number(productType?.finishing_mh_per_100ri) || 0;
  const finishingMh = calc.calcFinishingMhPerUnit(finishingMhPer100Ri, difficultyFactor, percentWood, ri);
  const pkgMhPerCbm = calc.packagingMhPerCbmForType(productType, packagingType);
  const packagingMh = noPackaging ? 0 : calc.calcPackagingLaborMhPerUnit(pkgMhPerCbm, finalUnitCbm);

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
  const shipItem = (shippingItems as any[]).find((s: any) => s.product_id === p.id);
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

  return {
    summary,
    exchangeRate,
    markupPercent,
    cogsPerUnit,
    nonUnitCogsPerUnit,
    directOhPerUnit,
    indirectOhPerUnit,
    shippingPerUnit,
    manHoursPerUnit: totalDirectMhPerUnit,
    resolvedCogsRows: cogsForCalc,
    icDims,
    icOd,
    icCost,
    mcDims,
    mcCost,
    productsPerIc,
    productsPerMc,
    finalUnitCbm,
    ri,
    prePackCbm,
    difficultyFactor,
  };
}
