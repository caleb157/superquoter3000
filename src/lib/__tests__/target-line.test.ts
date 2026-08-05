// End-to-end (engine-level) check for the "Target this line" action.
// Filling the computed unit price into a row MUST make the live engine's
// unit price land exactly on the product's target price — which is what the
// sticky summary on desktop and mobile renders.

import { describe, it, expect } from 'vitest';
import { calcTargetLineUnitPrice, calcCogsItemCost } from '@/lib/calculations';
import { computeProductCosting } from '@/lib/costing-engine';

const gs = {
  exchange_rate: 83.5, indirect_overhead_per_mh: 62.5,
  packaging_cost_per_cbm: 1200, auto_transport_cost_per_cbm: 550, local_transport_cost_per_cbm: 400,
  corrugate_kg_per_sq_in: 0.25, bubble_kg_per_sq_in: 0.2,
  corrugate_price_per_kg: 60, bubble_price_per_kg: 90, mc_height_buffer_inch: 2.5,
};
const chemicalPrices = [
  { id: 'color-1', category: 'Color', name: 'Walnut Stain', price_per_unit_inr: 280, unit_type: 'L' },
  { id: 'sealer-1', category: 'Sealer', name: 'PU Sealer', price_per_unit_inr: 320, unit_type: 'L' },
  { id: 'lacq-1', category: 'Lacquer', name: 'NC Lacquer', price_per_unit_inr: 410, unit_type: 'L' },
];
const boxData = [{ box_type: '7 ply', cost_per_sq_in: 0.45 }, { box_type: '5 ply', cost_per_sq_in: 0.32 }];
const shipTypes = [{ id: 'sh-cbm', cost_inr: 35000, per_unit: 'CBM' }];
const employees = [
  { id: 'e1', designations: ['Finishing'], hourly_rate_inr: 90 },
  { id: 'e2', designations: ['Packaging'], hourly_rate_inr: 75 },
  { id: 'e3', designations: ['Joinery'], hourly_rate_inr: 110 },
];
const difficulties = [{ name: 'Medium', adjustment_factor: 1.0 }];
const locations = [{ id: 'loc-1', cost_per_cbm_inr: 850 }];
const productType = {
  id: 'pt-1', name: 'Case Good', pkg_ic_add_per_side_in: 0.5,
  finishing_color_per_100ri: 0.3, finishing_sealer_l_per_100ri: 0.25, finishing_lacquer_per_100ri: 0.35,
  finishing_wax_g_per_sqin: 0.4, finishing_mh_per_100ri: 0.8,
  pkg_ic_rate_mh_per_cbm: 4, pkg_ic_mc_rate_mh_per_cbm: 5, pkg_corrugate_bubble_rate_mh_per_cbm: 3,
};

const RAW_ROW = {
  product_id: 'tp1', component_name: 'Teak Wood', cogs_type: 'Raw Materials',
  is_auto_calculated: false, include: 'Yes',
  components_per_product: 0.05, unit_cost_inr: 80000, waste_factor: 0.1,
};

const mkCogs = (unitCost = RAW_ROW.unit_cost_inr) => [
  { ...RAW_ROW, unit_cost_inr: unitCost },
  { product_id: 'tp1', component_name: 'IC Box', cogs_type: 'Packaging', is_auto_calculated: true, include: 'Yes' },
  { product_id: 'tp1', component_name: 'MC Box', cogs_type: 'Packaging', is_auto_calculated: true, include: 'Yes' },
  { product_id: 'tp1', component_name: 'Color', cogs_type: 'Finishing Materials', is_auto_calculated: true, include: 'Yes', chemical_price_id: 'color-1' },
  { product_id: 'tp1', component_name: 'Lacquer', cogs_type: 'Finishing Materials', is_auto_calculated: true, include: 'Yes', chemical_price_id: 'lacq-1' },
];
const mkNu = (costEach = 5000) => [
  { product_id: 'tp1', name: 'Auto Transport', include: 'Yes', total_quantity: 0, cost_each_inr: 0 },
  { product_id: 'tp1', name: 'Tooling', include: 'Yes', total_quantity: 1, cost_each_inr: costEach },
];
const oh = [
  { product_id: 'tp1', labor_type: 'Finishing', is_auto_estimated: true, include: 'Yes', man_hours_per_unit: 0 },
  { product_id: 'tp1', labor_type: 'Packaging', is_auto_estimated: true, include: 'Yes', man_hours_per_unit: 0 },
  { product_id: 'tp1', labor_type: 'Joinery', is_auto_estimated: false, include: 'Yes', man_hours_per_unit: 2.5 },
];
const cbm = {
  product_id: 'tp1', ic_type: '7 ply', mc_type: '7 ply', ic_width: null, ic_depth: null, ic_height: null,
  products_per_ic: 1, final_unit_cbm: 0.12, mc_max_width: 25, mc_max_depth: 25, mc_max_height: 25,
  mc_buffer_inch: 1, mc_height_buffer_inch: 2.5, mc_weight_limit_kg: 20, mc_empty_weight_kg: 1.5,
};
const QTY = 100;
const product = {
  id: 'tp1', customer_rfq_id: null, product_type_id: 'pt-1',
  width_inch: 36, depth_inch: 18, height_inch: 30, weight_kg: 12, quantity: QTY,
  percent_wood: 1, finishing_difficulty: 'Medium', markup_percent: 0.25,
  packaging_type: 'ic_mc', source_location_id: null,
  calculated_unit_price_usd: null, calculated_unit_cost_usd: null,
};

const run = (cogsItems: any[], nonUnitCogs: any[]) => computeProductCosting({
  product, cogsItems, nonUnitCogs, overheadItems: oh,
  shippingItems: [{ product_id: 'tp1', shipping_type_id: 'sh-cbm' }],
  cbmRow: cbm, productType, boxData, chemicalPrices, shippingTypes: shipTypes,
  laborEmployees: employees, globalSettings: gs, inquiryOverrides: null,
  locations, difficulties, rawMaterialCosts: [],
} as any);

describe('Target this line → engine recompute', () => {
  it('COGS row: filling the computed price lands unit price exactly on target', () => {
    const before = run(mkCogs(), mkNu());
    const targetPriceUsd = before.summary.unit_price_usd * 0.85; // aim 15% cheaper

    const rowContributionInr = calcCogsItemCost({
      include: RAW_ROW.include,
      components_per_product: RAW_ROW.components_per_product,
      unit_cost_inr: RAW_ROW.unit_cost_inr,
      waste_factor: RAW_ROW.waste_factor,
    } as any).total_cost_per_product;

    const res = calcTargetLineUnitPrice({
      targetPriceUsd,
      markupPercent: before.markupPercent,
      exchangeRate: before.exchangeRate,
      totalCostPerUnitInr: before.summary.product_cost_per_unit_inr,
      thisRowCurrentContributionInr: rowContributionInr,
      componentsPerProduct: RAW_ROW.components_per_product,
      wasteFactor: RAW_ROW.waste_factor,
    });

    expect(res.feasible).toBe(true);
    expect(res.targetUnitCostInr!).toBeGreaterThan(0);
    expect(res.targetUnitCostInr!).toBeLessThan(RAW_ROW.unit_cost_inr);

    const after = run(mkCogs(res.targetUnitCostInr!), mkNu());
    // Sticky summary values (price + cost) both move, price lands on target.
    expect(after.summary.unit_price_usd).toBeCloseTo(targetPriceUsd, 6);
    expect(after.summary.product_cost_per_unit_usd).toBeLessThan(before.summary.product_cost_per_unit_usd);
    expect(after.summary.unit_price_inr).toBeCloseTo(targetPriceUsd * before.exchangeRate, 4);
  });

  it('Non-Unit COGS row: filling the computed cost-each lands unit price on target', () => {
    const before = run(mkCogs(), mkNu());
    // Halve this row's 50 INR/unit contribution — well within its available room.
    const targetPriceUsd = ((before.summary.product_cost_per_unit_inr - 25) * (1 + before.markupPercent)) / before.exchangeRate;

    const componentsPerProduct = 1 / QTY; // total_quantity(1) spread over qty
    const rowContributionInr = 5000 / QTY;

    const res = calcTargetLineUnitPrice({
      targetPriceUsd,
      markupPercent: before.markupPercent,
      exchangeRate: before.exchangeRate,
      totalCostPerUnitInr: before.summary.product_cost_per_unit_inr,
      thisRowCurrentContributionInr: rowContributionInr,
      componentsPerProduct,
      wasteFactor: 0,
    });

    expect(res.feasible).toBe(true);
    const after = run(mkCogs(), mkNu(res.targetUnitCostInr!));
    expect(after.summary.unit_price_usd).toBeCloseTo(targetPriceUsd, 6);
  });

  it('reports infeasible when the target is below the rest of the cost base', () => {
    const before = run(mkCogs(), mkNu());
    const res = calcTargetLineUnitPrice({
      targetPriceUsd: before.summary.unit_price_usd * 0.05,
      markupPercent: before.markupPercent,
      exchangeRate: before.exchangeRate,
      totalCostPerUnitInr: before.summary.product_cost_per_unit_inr,
      thisRowCurrentContributionInr: 100,
      componentsPerProduct: RAW_ROW.components_per_product,
      wasteFactor: RAW_ROW.waste_factor,
    });
    expect(res.feasible).toBe(false);
    expect(res.targetUnitCostInr).toBeNull();
  });
});
