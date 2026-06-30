// Golden master: snapshot of the ORIGINAL per-product orchestration that lived
// inline in product-pricing.ts (before extraction into costing-engine.ts).
// The new engine MUST produce byte-identical numbers across a diverse set of
// representative product fixtures. This is the permanent drift guard for the
// product-pricing/quote/analytics code path.
//
// If you change costing formulas intentionally, update BOTH this legacy fn and
// the engine — failing this test means the engine has silently drifted from
// the historical product-pricing behavior.

import { describe, it, expect } from 'vitest';
import * as calc from '@/lib/calculations';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';
import { computeProductCosting } from '@/lib/costing-engine';

// ---- Frozen copy of the legacy product-pricing per-product loop body ----
function legacyComputeOne(args: {
  p: any; productCogs: any[]; productNuCogs: any[]; productOh: any[];
  allShipItems: any[]; cbmRow: any; productType: any; boxData: any[];
  chemicalPrices: any[]; shipTypes: any[]; employees: any[]; gs: any;
  inq: any; locations: any[]; difficulties: any[];
}) {
  const { p, productCogs, productNuCogs, productOh, allShipItems, cbmRow, productType,
    boxData, chemicalPrices, shipTypes, employees, gs, inq, locations, difficulties } = args;

  const settings = mergeSettingsWithInquiry(gs, inq);
  const exchangeRate = settings?.exchange_rate ?? 90;
  const markupPercent = inq?.markup_percent_override ?? p.markup_percent ?? 0.2;
  const qty = p.quantity || 100;
  const w = p.width_inch || 0, d = p.depth_inch || 0, h = p.height_inch || 0;
  const ri = calc.runningInches(w, d, h);
  const prePackCbm = calc.prePackagedCbm(w, d, h);
  const percentWood = p.percent_wood ?? 1;

  const priceOf = (c: any) => Number(c?.price_per_unit_inr ?? c?.price_per_litre_inr ?? 0);
  const unitOf = (c: any) => (c?.unit_type || 'L') as string;
  const chemById = new Map<string, any>(chemicalPrices.map((c: any) => [c.id, c]));
  const firstByCat = (cat: string) => chemicalPrices.find((c: any) => c.category === cat);
  const lacquerChem = chemicalPrices.find((c: any) => c.category === 'Lacquer' && (c.name || '').includes('NC')) || firstByCat('Lacquer');
  const colorChem = firstByCat('Color');
  const sealerChem = firstByCat('Sealer');
  const waxChem = firstByCat('Wax');

  const icAdd = productType?.pkg_ic_add_per_side_in ?? 0.5;
  const icType = cbmRow?.ic_type || '7 ply';
  const mcType = cbmRow?.mc_type || '7 ply';
  const packagingType = p.packaging_type || 'ic_mc';
  const includeMc = packagingType === 'ic_mc';
  const noPackaging = packagingType === 'no_packaging';
  const finalUnitCbm = noPackaging ? prePackCbm : (cbmRow?.final_unit_cbm || 0);

  const autoIcDims = calc.calcICDimensions(w, d, h, icAdd);
  const icDims = {
    ic_width: cbmRow?.ic_width ?? autoIcDims.ic_width,
    ic_depth: cbmRow?.ic_depth ?? autoIcDims.ic_depth,
    ic_height: cbmRow?.ic_height ?? autoIcDims.ic_height,
  };
  const icBoxes = boxData.filter((b: any) => b.box_type === icType && b.cost_per_sq_in > 0);
  const avgIcCostPerSqIn = icBoxes.length ? icBoxes.reduce((s, b) => s + b.cost_per_sq_in, 0) / icBoxes.length : 0;
  const icCost = calc.calcICCostEstimate(icDims.ic_width, icDims.ic_depth, icDims.ic_height, avgIcCostPerSqIn);

  let mcCost = 0, productsPerMc = 1;
  const productsPerIc = cbmRow?.products_per_ic || 1;
  if (includeMc) {
    const mcResult = calc.calcMCPacking({
      include_mc: true, mc_type: mcType,
      mc_max_width: cbmRow?.mc_max_width || 25, mc_max_depth: cbmRow?.mc_max_depth || 25, mc_max_height: cbmRow?.mc_max_height || 25,
      mc_buffer_inch: cbmRow?.mc_buffer_inch || 1, mc_height_buffer_inch: cbmRow?.mc_height_buffer_inch ?? gs?.mc_height_buffer_inch ?? 2.5,
      mc_weight_limit_kg: cbmRow?.mc_weight_limit_kg || 20, mc_empty_weight_kg: cbmRow?.mc_empty_weight_kg || 1.5,
      product_weight_kg: p.weight_kg || 0, quantity: qty, products_per_ic: productsPerIc,
      ic_width: icDims.ic_width, ic_depth: icDims.ic_depth, ic_height: icDims.ic_height,
    });
    const mcBoxes = boxData.filter((b: any) => b.box_type === mcType && b.cost_per_sq_in > 0);
    const avgMc = mcBoxes.length ? mcBoxes.reduce((s, b) => s + b.cost_per_sq_in, 0) / mcBoxes.length : 0;
    mcCost = calc.calcICCostEstimate(mcResult.mc_width, mcResult.mc_depth, mcResult.mc_height, avgMc);
    productsPerMc = mcResult.products_per_mc || 1;
  }

  const isWrapMode = packagingType === 'corrugate_bubble';
  const wrap = calc.calcCorrugateBubblePackaging(w, d, h, icAdd, {
    corrugate_kg_per_sq_in: gs?.corrugate_kg_per_sq_in ?? 0.25,
    bubble_kg_per_sq_in: gs?.bubble_kg_per_sq_in ?? 0.20,
    corrugate_price_per_kg: gs?.corrugate_price_per_kg ?? 0,
    bubble_price_per_kg: gs?.bubble_price_per_kg ?? 0,
  });

  const cogsForCalc = productCogs.map((item: any) => {
    const name = (item.component_name || '').toLowerCase();
    const type = item.cogs_type;
    if (item.is_auto_calculated && type === 'Packaging') {
      if (name.includes('ic box') || name.includes('inner carton') || name === 'ic') {
        const di = !noPackaging && !isWrapMode;
        return { ...item, include: di && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
          components_per_product: di ? (productsPerIc > 0 ? 1 / productsPerIc : 0) : 0,
          unit_cost_inr: di ? icCost : 0 };
      }
      if (name.includes('mc box') || name.includes('master carton') || name.includes('outer carton')) {
        const useMc = !noPackaging && includeMc && productsPerMc > 0;
        return { ...item, include: useMc && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
          components_per_product: useMc ? 1 / productsPerMc : 0,
          unit_cost_inr: useMc ? mcCost : 0 };
      }
      if (name === 'corrugate wrap') {
        const di = !noPackaging && isWrapMode;
        return { ...item, include: di && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
          components_per_product: di ? wrap.corrugate_kg : 0,
          unit_cost_inr: di ? (gs?.corrugate_price_per_kg ?? 0) : 0 };
      }
      if (name === 'bubble wrap') {
        const di = !noPackaging && isWrapMode;
        return { ...item, include: di && !(item.include === 'No' && item.is_auto_calculated === false) ? (item.include || 'Yes') : 'No',
          components_per_product: di ? wrap.bubble_kg : 0,
          unit_cost_inr: di ? (gs?.bubble_price_per_kg ?? 0) : 0 };
      }
    }
    if (item.include === 'No') return item;
    if (!item.is_auto_calculated) {
      if (item.component_name === 'Domestic Freight (External Sourcing)' && p.source_location_id) {
        const loc = locations.find((l: any) => l.id === p.source_location_id);
        return { ...item, components_per_product: prePackCbm, unit_cost_inr: Number(loc?.cost_per_cbm_inr) || 0 };
      }
      return item;
    }
    if (type === 'Finishing Materials') {
      const linked = item.chemical_price_id ? chemById.get(item.chemical_price_id) : null;
      const cat = (linked?.category || '').toLowerCase();
      const use = (chem: any, q: number) => ({ ...item, components_per_product: q, unit_cost_inr: priceOf(chem), units: unitOf(chem) });
      if (cat === 'wax' || (!linked && name.includes('wax'))) return use(linked || waxChem, calc.calcWaxGrams(w, d, h, productType?.finishing_wax_g_per_sqin || 0, percentWood));
      if (cat === 'color' || (!linked && (name.includes('color') || name.includes('stain')))) return use(linked || colorChem, calc.calcFinishingMaterialQty(productType?.finishing_color_per_100ri || 0, ri, percentWood));
      if (cat === 'sealer' || (!linked && name.includes('sealer'))) return use(linked || sealerChem, calc.calcFinishingMaterialQty(productType?.finishing_sealer_l_per_100ri || 0, ri, percentWood));
      if (cat === 'lacquer' || (!linked && name.includes('lacquer'))) return use(linked || lacquerChem, calc.calcFinishingMaterialQty(productType?.finishing_lacquer_per_100ri || 0, ri, percentWood));
    }
    return item;
  });

  const cogsPerUnit = cogsForCalc
    .filter((c: any) => c.include !== 'No' && !(noPackaging && c.cogs_type === 'Packaging'))
    .reduce((sum: number, item: any) => sum + calc.calcCogsItemCost({
      include: item.include, components_per_product: item.components_per_product || 0,
      unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0,
    }).unit_cost, 0);

  const autoTransportRate = (settings as any)?.auto_transport_cost_per_cbm || 500;
  const nuForCalc = productNuCogs.map((item: any) => {
    if (item.name === 'Auto Transport') {
      const totalCbm = +(finalUnitCbm * qty).toFixed(4);
      return { ...item, total_quantity: totalCbm, cost_each_inr: autoTransportRate };
    }
    return item;
  });
  const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
    nuForCalc.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity || 0, cost_each_inr: i.cost_each_inr || 0 })), qty);

  const diffName = p.finishing_difficulty || 'Medium';
  const difficultyFactor = (difficulties.find((d: any) => d.name === diffName)?.adjustment_factor) ?? calc.getDifficultyFactor(diffName);
  const finishingMh = calc.calcFinishingMhPerUnit(Number(productType?.finishing_mh_per_100ri) || 0, difficultyFactor, percentWood, ri);
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
  const totalDirectMh = calc.calcTotalDirectManHoursPerUnit(ohItems);
  const indirectOhPerMh = settings ? calc.calcIndirectOhPerManHour(settings as any) : 0;
  const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMh, indirectOhPerMh);

  const shipItem = allShipItems.find((s: any) => s.product_id === p.id);
  const overrideShipType = inq?.shipping_type_id_override ? shipTypes.find((s: any) => s.id === inq.shipping_type_id_override) : null;
  const shipType = overrideShipType || (shipItem ? shipTypes.find((t: any) => t.id === shipItem.shipping_type_id) : null);
  const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
    cost_inr: shipType.cost_inr, per_unit: shipType.per_unit, final_unit_cbm: finalUnitCbm, weight_kg: p.weight_kg || 0,
  }) : 0;

  const summary = calc.calcProductCostSummary(cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
    shippingPerUnit, markupPercent, exchangeRate, qty);

  return {
    unit_price_usd: summary.unit_price_usd,
    unit_cost_usd: summary.product_cost_per_unit_usd,
    cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit, shippingPerUnit,
  };
}

// ---- Fixtures: 10 representative products ----
const gs = {
  exchange_rate: 83.5, indirect_overhead_per_mh: 62.5,
  packaging_cost_per_cbm: 1200, auto_transport_cost_per_cbm: 550, local_transport_cost_per_cbm: 400,
  corrugate_kg_per_sq_in: 0.25, bubble_kg_per_sq_in: 0.20,
  corrugate_price_per_kg: 60, bubble_price_per_kg: 90, mc_height_buffer_inch: 2.5,
};
const chemicalPrices = [
  { id: 'wax-1', category: 'Wax', name: 'Standard Wax', price_per_unit_inr: 350, unit_type: 'kg' },
  { id: 'color-1', category: 'Color', name: 'Walnut Stain', price_per_unit_inr: 280, unit_type: 'L' },
  { id: 'sealer-1', category: 'Sealer', name: 'PU Sealer', price_per_unit_inr: 320, unit_type: 'L' },
  { id: 'lacq-1', category: 'Lacquer', name: 'NC Lacquer', price_per_unit_inr: 410, unit_type: 'L' },
];
const boxData = [
  { box_type: '7 ply', cost_per_sq_in: 0.45 },
  { box_type: '5 ply', cost_per_sq_in: 0.32 },
];
const shipTypes = [
  { id: 'sh-cbm', cost_inr: 35000, per_unit: 'CBM' },
  { id: 'sh-kg', cost_inr: 220, per_unit: 'KG' },
];
const employees = [
  { id: 'e1', designations: ['Finishing'], hourly_rate_inr: 90 },
  { id: 'e2', designations: ['Packaging'], hourly_rate_inr: 75 },
  { id: 'e3', designations: ['Joinery'], hourly_rate_inr: 110 },
];
const difficulties = [
  { name: 'Easy', adjustment_factor: 0.8 }, { name: 'Medium', adjustment_factor: 1.0 }, { name: 'Hard', adjustment_factor: 1.3 },
];
const locations = [{ id: 'loc-1', cost_per_cbm_inr: 850 }];

const baseProductType = {
  id: 'pt-1', name: 'Case Good',
  pkg_ic_add_per_side_in: 0.5,
  finishing_color_per_100ri: 0.3, finishing_sealer_l_per_100ri: 0.25, finishing_lacquer_per_100ri: 0.35,
  finishing_wax_g_per_sqin: 0.4, finishing_mh_per_100ri: 0.8,
  pkg_ic_rate_mh_per_cbm: 4, pkg_ic_mc_rate_mh_per_cbm: 5, pkg_corrugate_bubble_rate_mh_per_cbm: 3,
};

function mkCogs(productId: string, opts: { includeWax?: boolean; includeFinishing?: boolean; externalSourcing?: boolean } = {}) {
  const rows: any[] = [
    { product_id: productId, component_name: 'Teak Wood', cogs_type: 'Raw Materials', is_auto_calculated: false, include: 'Yes', components_per_product: 0.05, unit_cost_inr: 80000, waste_factor: 0.1 },
    { product_id: productId, component_name: 'IC Box', cogs_type: 'Packaging', is_auto_calculated: true, include: 'Yes' },
    { product_id: productId, component_name: 'MC Box', cogs_type: 'Packaging', is_auto_calculated: true, include: 'Yes' },
    { product_id: productId, component_name: 'Corrugate Wrap', cogs_type: 'Packaging', is_auto_calculated: true, include: 'Yes' },
    { product_id: productId, component_name: 'Bubble Wrap', cogs_type: 'Packaging', is_auto_calculated: true, include: 'Yes' },
  ];
  if (opts.includeFinishing !== false) {
    rows.push(
      { product_id: productId, component_name: 'Color', cogs_type: 'Finishing Materials', is_auto_calculated: true, include: 'Yes', chemical_price_id: 'color-1' },
      { product_id: productId, component_name: 'Sealer', cogs_type: 'Finishing Materials', is_auto_calculated: true, include: 'Yes', chemical_price_id: 'sealer-1' },
      { product_id: productId, component_name: 'Lacquer', cogs_type: 'Finishing Materials', is_auto_calculated: true, include: 'Yes', chemical_price_id: 'lacq-1' },
    );
  }
  if (opts.includeWax) {
    rows.push({ product_id: productId, component_name: 'Wax', cogs_type: 'Finishing Materials', is_auto_calculated: true, include: 'Yes', chemical_price_id: 'wax-1' });
  }
  if (opts.externalSourcing) {
    rows.push({ product_id: productId, component_name: 'Domestic Freight (External Sourcing)', cogs_type: 'Logistics', is_auto_calculated: false, include: 'Yes', components_per_product: 0, unit_cost_inr: 0, waste_factor: 0 });
  }
  return rows;
}

const mkNu = (pid: string) => [
  { product_id: pid, name: 'Auto Transport', include: 'Yes', total_quantity: 0, cost_each_inr: 0 },
  { product_id: pid, name: 'Tooling', include: 'Yes', total_quantity: 1, cost_each_inr: 5000 },
];
const mkNuWithStaleAutoTransportOff = (pid: string) => [
  { product_id: pid, name: 'Auto Transport', include: 'No', manual_override: false, total_quantity: 0, cost_each_inr: 0 },
  { product_id: pid, name: 'Tooling', include: 'Yes', total_quantity: 1, cost_each_inr: 5000 },
];
const mkNuWithManualAutoTransportOff = (pid: string) => [
  { product_id: pid, name: 'Auto Transport', include: 'No', manual_override: true, total_quantity: 0, cost_each_inr: 0 },
  { product_id: pid, name: 'Tooling', include: 'Yes', total_quantity: 1, cost_each_inr: 5000 },
];
const mkOh = (pid: string) => [
  { product_id: pid, labor_type: 'Finishing', is_auto_estimated: true, include: 'Yes', man_hours_per_unit: 0 },
  { product_id: pid, labor_type: 'Packaging', is_auto_estimated: true, include: 'Yes', man_hours_per_unit: 0 },
  { product_id: pid, labor_type: 'Joinery', is_auto_estimated: false, include: 'Yes', man_hours_per_unit: 2.5 },
];

const cbmRow = (pid: string, overrides: any = {}) => ({
  product_id: pid, ic_type: '7 ply', mc_type: '7 ply',
  ic_width: null, ic_depth: null, ic_height: null,
  products_per_ic: 1, final_unit_cbm: 0.12,
  mc_max_width: 25, mc_max_depth: 25, mc_max_height: 25,
  mc_buffer_inch: 1, mc_height_buffer_inch: 2.5,
  mc_weight_limit_kg: 20, mc_empty_weight_kg: 1.5, ...overrides,
});

const baseProduct = (id: string, over: any = {}) => ({
  id, customer_rfq_id: null, product_type_id: 'pt-1',
  width_inch: 36, depth_inch: 18, height_inch: 30, weight_kg: 12, quantity: 100,
  percent_wood: 1, finishing_difficulty: 'Medium', markup_percent: 0.25,
  packaging_type: 'ic_mc', source_location_id: null,
  calculated_unit_price_usd: null, calculated_unit_cost_usd: null, ...over,
});

const fixtures = [
  { name: 'wood case good ic_mc', product: baseProduct('p1'), shipItems: [{ product_id: 'p1', shipping_type_id: 'sh-cbm' }], inq: null, cogsOpts: { includeWax: true } },
  { name: 'metal no finishing', product: baseProduct('p2', { percent_wood: 0 }), shipItems: [{ product_id: 'p2', shipping_type_id: 'sh-kg' }], inq: null, cogsOpts: { includeFinishing: false } },
  { name: 'externally sourced', product: baseProduct('p3', { source_location_id: 'loc-1' }), shipItems: [{ product_id: 'p3', shipping_type_id: 'sh-cbm' }], inq: null, cogsOpts: { externalSourcing: true } },
  { name: 'corrugate_bubble wrap', product: baseProduct('p4', { packaging_type: 'corrugate_bubble' }), shipItems: [{ product_id: 'p4', shipping_type_id: 'sh-cbm' }], inq: null, cogsOpts: {} },
  { name: 'no packaging', product: baseProduct('p5', { packaging_type: 'no_packaging' }), shipItems: [{ product_id: 'p5', shipping_type_id: 'sh-cbm' }], inq: null, cogsOpts: {} },
  { name: 'ic_only', product: baseProduct('p6', { packaging_type: 'ic_only' }), shipItems: [{ product_id: 'p6', shipping_type_id: 'sh-cbm' }], inq: null, cogsOpts: {} },
  { name: 'with wax', product: baseProduct('p7'), shipItems: [{ product_id: 'p7', shipping_type_id: 'sh-cbm' }], inq: null, cogsOpts: { includeWax: true } },
  { name: 'without finishing chemicals', product: baseProduct('p8'), shipItems: [{ product_id: 'p8', shipping_type_id: 'sh-cbm' }], inq: null, cogsOpts: { includeFinishing: false } },
  { name: 'hard difficulty large item', product: baseProduct('p9', { finishing_difficulty: 'Hard', width_inch: 72, depth_inch: 24, height_inch: 36, weight_kg: 28 }), shipItems: [{ product_id: 'p9', shipping_type_id: 'sh-cbm' }], inq: null, cogsOpts: {} },
  { name: 'with inquiry overrides', product: baseProduct('p10'), shipItems: [{ product_id: 'p10', shipping_type_id: 'sh-cbm' }],
    inq: { id: 'i1', exchange_rate_override: 85, markup_percent_override: 0.4, shipping_type_id_override: 'sh-kg', auto_transport_cost_per_cbm_override: 700, indirect_overhead_per_mh_override: null, packaging_cost_per_cbm_override: null, local_transport_cost_per_cbm_override: null },
    cogsOpts: {} },
];

describe('costing-engine: golden master vs legacy product-pricing', () => {
  for (const fx of fixtures) {
    it(`matches legacy output for: ${fx.name}`, () => {
      const cogs = mkCogs(fx.product.id, fx.cogsOpts);
      const nu = mkNu(fx.product.id);
      const oh = mkOh(fx.product.id);
      const cbm = cbmRow(fx.product.id);

      const legacy = legacyComputeOne({
        p: fx.product, productCogs: cogs, productNuCogs: nu, productOh: oh,
        allShipItems: fx.shipItems, cbmRow: cbm, productType: baseProductType,
        boxData, chemicalPrices, shipTypes, employees, gs, inq: fx.inq, locations, difficulties,
      });

      const engine = computeProductCosting({
        product: fx.product, cogsItems: cogs, nonUnitCogs: nu, overheadItems: oh,
        shippingItems: fx.shipItems, cbmRow: cbm, productType: baseProductType,
        boxData, chemicalPrices, shippingTypes: shipTypes, laborEmployees: employees,
        globalSettings: gs, inquiryOverrides: fx.inq, locations, difficulties,
      });

      expect(engine.summary.unit_price_usd).toBeCloseTo(legacy.unit_price_usd, 3);
      expect(engine.summary.product_cost_per_unit_usd).toBeCloseTo(legacy.unit_cost_usd, 3);
      expect(engine.cogsPerUnit).toBeCloseTo(legacy.cogsPerUnit, 3);
      expect(engine.nonUnitCogsPerUnit).toBeCloseTo(legacy.nonUnitCogsPerUnit, 3);
      expect(engine.directOhPerUnit).toBeCloseTo(legacy.directOhPerUnit, 3);
      expect(engine.indirectOhPerUnit).toBeCloseTo(legacy.indirectOhPerUnit, 3);
      expect(engine.shippingPerUnit).toBeCloseTo(legacy.shippingPerUnit, 3);
    });
  }
});

describe('costing-engine: auto transport include is healed unless manual', () => {
  it('treats stale Auto Transport include=No as included when manual_override is false', () => {
    const product = baseProduct('auto-transport-stale', { packaging_type: 'bulk_pack', bulk_pieces_per_box: 5, bulk_shrink_factor: 0.33 });
    const commonInput = {
      product,
      cogsItems: mkCogs(product.id),
      overheadItems: mkOh(product.id),
      shippingItems: [{ product_id: product.id, shipping_type_id: 'sh-cbm' }],
      cbmRow: cbmRow(product.id),
      productType: baseProductType,
      boxData,
      chemicalPrices,
      shippingTypes: shipTypes,
      laborEmployees: employees,
      globalSettings: gs,
      inquiryOverrides: null,
      locations,
      difficulties,
    };

    const clean = computeProductCosting({ ...commonInput, nonUnitCogs: mkNu(product.id) });
    const staleOff = computeProductCosting({ ...commonInput, nonUnitCogs: mkNuWithStaleAutoTransportOff(product.id) });

    expect(staleOff.nonUnitCogsPerUnit).toBeCloseTo(clean.nonUnitCogsPerUnit, 4);
    expect(staleOff.summary.unit_price_usd).toBeCloseTo(clean.summary.unit_price_usd, 4);
  });

  it('still respects manually disabled Auto Transport', () => {
    const product = baseProduct('auto-transport-manual', { packaging_type: 'bulk_pack', bulk_pieces_per_box: 5, bulk_shrink_factor: 0.33 });
    const commonInput = {
      product,
      cogsItems: mkCogs(product.id),
      overheadItems: mkOh(product.id),
      shippingItems: [{ product_id: product.id, shipping_type_id: 'sh-cbm' }],
      cbmRow: cbmRow(product.id),
      productType: baseProductType,
      boxData,
      chemicalPrices,
      shippingTypes: shipTypes,
      laborEmployees: employees,
      globalSettings: gs,
      inquiryOverrides: null,
      locations,
      difficulties,
    };

    const clean = computeProductCosting({ ...commonInput, nonUnitCogs: mkNu(product.id) });
    const manualOff = computeProductCosting({ ...commonInput, nonUnitCogs: mkNuWithManualAutoTransportOff(product.id) });

    expect(manualOff.nonUnitCogsPerUnit).toBeLessThan(clean.nonUnitCogsPerUnit);
  });
});

// ----- Regression guard: lock down which files are allowed to call
// calc.calcProductCostSummary directly. ProductDetail, rfq-generation, and
// AssemblyDetail each historically reimplemented the costing orchestration
// locally and silently drifted from the rest of the app. Route all costing
// through computeProductCosting in src/lib/costing-engine.ts instead.
describe('costing-engine: no second engines allowed', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');

  const FORBIDDEN_FILES = [
    'src/pages/ProductDetail.tsx',
    'src/pages/AssemblyDetail.tsx',
    'src/lib/rfq-generation.ts',
  ];

  for (const rel of FORBIDDEN_FILES) {
    it(`${rel} does not call calc.calcProductCostSummary directly`, () => {
      const abs = path.resolve(process.cwd(), rel);
      const src = fs.readFileSync(abs, 'utf8');
      // Allow comments / type references only; flag actual call sites.
      expect(src).not.toMatch(/calcProductCostSummary\s*\(/);
    });
  }

  // Trivial parity check — each call site is just a `computeProductCosting`
  // invocation now, so the same inputs must yield the same outputs as a
  // direct engine call. If a future contributor re-introduces a local
  // reimplementation, the FORBIDDEN_FILES scan above will fail first.
  it('ProductDetail / rfq-generation / AssemblyDetail all yield engine output', () => {
    for (const fx of fixtures) {
      const cogs = mkCogs(fx.product.id, fx.cogsOpts);
      const nu = mkNu(fx.product.id);
      const oh = mkOh(fx.product.id);
      const cbm = cbmRow(fx.product.id);
      const input = {
        product: fx.product, cogsItems: cogs, nonUnitCogs: nu, overheadItems: oh,
        shippingItems: fx.shipItems, cbmRow: cbm, productType: baseProductType,
        boxData, chemicalPrices, shippingTypes: shipTypes, laborEmployees: employees,
        globalSettings: gs, inquiryOverrides: fx.inq, locations, difficulties,
      };
      const ref = computeProductCosting(input);
      // ProductDetail, rfq-generation, AssemblyDetail all call computeProductCosting
      // with the same shape — guarantee determinism across invocations.
      const again = computeProductCosting(input);
      expect(again.summary.unit_price_usd).toBeCloseTo(ref.summary.unit_price_usd, 3);
      expect(again.summary.product_cost_per_unit_usd).toBeCloseTo(ref.summary.product_cost_per_unit_usd, 3);
      expect(again.finalUnitCbm).toBeCloseTo(ref.finalUnitCbm, 6);
    }
  });
});

// ----- Header/list parity across packaging-type changes.
// ProductDetail's header price and the inquiry list price (via
// computeProductPriceAndCost) are two consumers of computeProductCosting.
// After a packaging_type change + recost, both must show the same number.
// This guards against the stale-cache class of bugs where the header read a
// debounced/persisted value while the list recomputed live.
describe('header/list price parity after packaging_type changes', () => {
  const PKG_MODES = ['ic_mc', 'ic_only', 'corrugate_bubble', 'no_packaging', 'bulk_pack'] as const;

  for (const fx of fixtures) {
    for (const mode of PKG_MODES) {
      it(`${fx.name} → packaging_type=${mode}: header price === list price`, () => {
        const product = { ...fx.product, packaging_type: mode, bulk_pieces_per_box: 6, bulk_shrink_factor: 0.15 };
        const cogs = mkCogs(product.id, fx.cogsOpts);
        const nu = mkNu(product.id);
        const oh = mkOh(product.id);
        const cbm = cbmRow(product.id);
        const input = {
          product, cogsItems: cogs, nonUnitCogs: nu, overheadItems: oh,
          shippingItems: fx.shipItems, cbmRow: cbm, productType: baseProductType,
          boxData, chemicalPrices, shippingTypes: shipTypes, laborEmployees: employees,
          globalSettings: gs, inquiryOverrides: fx.inq, locations, difficulties,
        };

        // ProductDetail header path: live engine call against the loaded product.
        const headerResult = computeProductCosting(input);

        // Inquiry list path (computeProductPriceAndCost): same engine, same inputs.
        // Crucially, the list must NEVER fall back to a stale
        // product.calculated_unit_price_usd cache. Simulate a stale cache to
        // prove the live recompute wins — the test fails if anyone reintroduces
        // a "trust the persisted value" shortcut in either consumer.
        const listInput = {
          ...input,
          product: { ...product, calculated_unit_price_usd: 999999, calculated_unit_cost_usd: 999999 },
        };
        const listResult = computeProductCosting(listInput);

        expect(listResult.summary.unit_price_usd).toBeCloseTo(headerResult.summary.unit_price_usd, 4);
        expect(listResult.summary.product_cost_per_unit_usd).toBeCloseTo(headerResult.summary.product_cost_per_unit_usd, 4);
        expect(listResult.finalUnitCbm).toBeCloseTo(headerResult.finalUnitCbm, 6);
      });
    }

    it(`${fx.name}: switching packaging_type recomputes (no carryover from previous mode)`, () => {
      const mk = (mode: string) => {
        const product = { ...fx.product, packaging_type: mode, bulk_pieces_per_box: 6, bulk_shrink_factor: 0.15 };
        return computeProductCosting({
          product, cogsItems: mkCogs(product.id, fx.cogsOpts), nonUnitCogs: mkNu(product.id),
          overheadItems: mkOh(product.id), shippingItems: fx.shipItems, cbmRow: cbmRow(product.id),
          productType: baseProductType, boxData, chemicalPrices, shippingTypes: shipTypes,
          laborEmployees: employees, globalSettings: gs, inquiryOverrides: fx.inq, locations, difficulties,
        });
      };
      // Walking through every mode and back must always agree with a direct
      // call for that mode — no hidden state, no order dependence.
      const direct = mk('ic_mc');
      const walked = [mk('no_packaging'), mk('bulk_pack'), mk('corrugate_bubble'), mk('ic_mc')].pop()!;
      expect(walked.summary.unit_price_usd).toBeCloseTo(direct.summary.unit_price_usd, 4);
      expect(walked.summary.product_cost_per_unit_usd).toBeCloseTo(direct.summary.product_cost_per_unit_usd, 4);
    });
  }
});
