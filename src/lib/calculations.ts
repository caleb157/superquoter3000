// DKT Costing App — Pure Calculation Engine
// All business math lives here. Components call these functions.

// ============================================================
// Types
// ============================================================

export interface GlobalSettings {
  exchange_rate: number;
  total_available_mh_per_month?: number | null;
  indirect_overhead_monthly: number;
  packaging_cost_per_cbm: number;
  default_shipping_type: string;
}

export interface ProductType {
  id: string;
  name: string;
  pkg_ic_add_per_side_in: number;
  finishing_color_per_100ri: number;
  finishing_sealer_l_per_100ri: number;
  finishing_lacquer_per_100ri: number;
  finishing_mh_per_100ri: number;
  pkg_ic_rate_mh_per_cbm: number;
  pkg_ic_mc_rate_mh_per_cbm: number;
  pkg_corrugate_bubble_rate_mh_per_cbm: number;
}

export interface ProductDimensions {
  width_inch: number;
  depth_inch: number;
  height_inch: number;
  weight_kg: number;
  quantity: number;
  percent_wood: number;
  finishing_difficulty: string;
}

export interface ICConfig {
  ic_type: string;
  products_per_ic: number;
  ic_addition_per_side: number; // from product_type
  product_width: number;
  product_depth: number;
  product_height: number;
}

export interface MCConfig {
  include_mc: boolean;
  mc_type: string;
  mc_max_width: number;
  mc_max_depth: number;
  mc_max_height: number;
  mc_buffer_inch: number; // W/D buffer
  mc_height_buffer_inch?: number; // separate height buffer (defaults to mc_buffer_inch if absent)
  mc_weight_limit_kg: number;
  mc_empty_weight_kg: number;
  product_weight_kg: number;
  quantity: number;
  products_per_ic: number;
  ic_width: number;
  ic_depth: number;
  ic_height: number;
}

export interface BoxDataRow {
  box_type: string;
  cost_per_sq_in: number;
}

export interface CogsItem {
  include: string;
  components_per_product: number;
  unit_cost_inr: number;
  waste_factor: number;
}

export interface NonUnitCogsItem {
  include: string;
  total_quantity: number;
  cost_each_inr: number;
}

export interface OverheadItem {
  include: string;
  labor_type: string;
  man_hours_per_unit: number;
  hourly_rate: number; // avg from employees
}

export interface ShippingConfig {
  cost_inr: number;
  per_unit: 'CBM' | 'KG';
  final_unit_cbm: number;
  weight_kg: number;
}

// ============================================================
// Volume & Packing
// ============================================================

export function prePackagedCbm(w: number, d: number, h: number): number {
  if (!w || !d || !h) return 0;
  return (w * d * h) / 61020;
}

export function runningInches(w: number, d: number, h: number): number {
  const sorted = [w || 0, d || 0, h || 0].sort((a, b) => b - a);
  return sorted[0] + sorted[1];
}

export function calcICDimensions(
  productW: number, productD: number, productH: number,
  additionPerSide: number
): { ic_width: number; ic_depth: number; ic_height: number } {
  return {
    ic_width: (productW || 0) + 2 * additionPerSide,
    ic_depth: (productD || 0) + 2 * additionPerSide,
    ic_height: (productH || 0) + 2 * additionPerSide,
  };
}

export function surfaceAreaSqIn(w: number, d: number, h: number): number {
  return w * d * 2 + d * h * 2 + h * w * 2;
}

export function calcICCostEstimate(
  icW: number, icD: number, icH: number,
  avgCostPerSqIn: number
): number {
  const sa = surfaceAreaSqIn(icW, icD, icH);
  return sa * avgCostPerSqIn;
}

export function calcICVolumeCbm(icW: number, icD: number, icH: number): number {
  return (icW * icD * icH) / 61020;
}

export function calcMCPacking(config: MCConfig & {
  ic_od_width?: number;
  ic_od_depth?: number;
  ic_od_height?: number;
}): {
  mc_ics_along_w: number;
  mc_ics_along_d: number;
  mc_ics_along_h: number;
  products_per_mc: number;
  mc_width: number;
  mc_depth: number;
  mc_height: number;
  mc_volume_cbm: number;
} {
  if (!config.include_mc) {
    return {
      mc_ics_along_w: 0, mc_ics_along_d: 0, mc_ics_along_h: 0,
      products_per_mc: 0, mc_width: 0, mc_depth: 0, mc_height: 0, mc_volume_cbm: 0,
    };
  }

  const { mc_max_width, mc_max_depth, mc_max_height, mc_buffer_inch,
    mc_weight_limit_kg, mc_empty_weight_kg, product_weight_kg,
    quantity, products_per_ic, ic_width, ic_depth, ic_height } = config;
  const wd_buffer = mc_buffer_inch;
  const h_buffer = config.mc_height_buffer_inch ?? mc_buffer_inch;

  // Phase 3a: layout math uses IC OD when provided, falls back to IC ID for backward compat.
  const layoutW = config.ic_od_width ?? ic_width;
  const layoutD = config.ic_od_depth ?? ic_depth;
  const layoutH = config.ic_od_height ?? ic_height;

  const along_w = Math.max(1, Math.floor((mc_max_width - wd_buffer) / layoutW));
  const along_d = Math.max(1, Math.floor((mc_max_depth - wd_buffer) / layoutD));
  const along_h = Math.max(1, Math.floor((mc_max_height - h_buffer) / layoutH));

  let max_by_weight = along_w * along_d * along_h;
  if (mc_weight_limit_kg > 0 && product_weight_kg > 0) {
    max_by_weight = Math.floor((mc_weight_limit_kg - mc_empty_weight_kg) / product_weight_kg);
  }

  const ics_needed = Math.ceil(quantity / products_per_ic);
  const target = Math.min(ics_needed, along_w * along_d * along_h, max_by_weight);

  // Complete row/layer rule
  const actual_w = Math.min(target, along_w);
  const actual_d = target < along_w ? 1 : Math.min(along_d, Math.ceil(target / along_w));
  const actual_h = target < along_w * along_d ? 1 : Math.min(along_h, Math.ceil(target / (along_w * along_d)));

  const products_per_mc = actual_w * actual_d * actual_h * products_per_ic;

  // MC ID dimensions reflect packing of IC ODs (or IC IDs if OD not supplied).
  const mc_width = layoutW * actual_w + wd_buffer;
  const mc_depth = layoutD * actual_d + wd_buffer;
  const mc_height = layoutH * actual_h + h_buffer;
  const mc_volume_cbm = (mc_width * mc_depth * mc_height) / 61020;

  return {
    mc_ics_along_w: actual_w, mc_ics_along_d: actual_d, mc_ics_along_h: actual_h,
    products_per_mc, mc_width, mc_depth, mc_height, mc_volume_cbm,
  };
}

// ============================================================
// Box OD offsets (Phase 3a)
// ============================================================

export function getBoxOdOffsets(
  boxData: Array<{ box_type: string; od_length_add_in?: number; od_width_add_in?: number; od_height_add_in?: number }>,
  boxType: string,
): { lAdd: number; wAdd: number; hAdd: number } {
  const matching = boxData.filter(b => b.box_type === boxType);
  if (matching.length === 0) return { lAdd: 0, wAdd: 0, hAdd: 0 };
  const lAdd = matching.reduce((s, b) => s + (b.od_length_add_in || 0), 0) / matching.length;
  const wAdd = matching.reduce((s, b) => s + (b.od_width_add_in || 0), 0) / matching.length;
  const hAdd = matching.reduce((s, b) => s + (b.od_height_add_in || 0), 0) / matching.length;
  return { lAdd, wAdd, hAdd };
}

export function calcIcOd(
  icIdW: number, icIdD: number, icIdH: number,
  offsets: { lAdd: number; wAdd: number; hAdd: number },
): { ic_od_width: number; ic_od_depth: number; ic_od_height: number } {
  return {
    ic_od_width: icIdW + offsets.lAdd,
    ic_od_depth: icIdD + offsets.wAdd,
    ic_od_height: icIdH + offsets.hAdd,
  };
}

export function calcMcOd(
  mcIdW: number, mcIdD: number, mcIdH: number,
  offsets: { lAdd: number; wAdd: number; hAdd: number },
): { mc_od_width: number; mc_od_depth: number; mc_od_height: number } {
  return {
    mc_od_width: mcIdW + offsets.lAdd,
    mc_od_depth: mcIdD + offsets.wAdd,
    mc_od_height: mcIdH + offsets.hAdd,
  };
}

// ============================================================
// Corrugate + Bubble Wrap packaging
// ============================================================

export interface WrappingSettings {
  corrugate_kg_per_sq_in: number;
  bubble_kg_per_sq_in: number;
  corrugate_price_per_kg: number;
  bubble_price_per_kg: number;
}

export function calcCorrugateBubblePackaging(
  productW: number,
  productD: number,
  productH: number,
  icAddPerSide: number,
  s: WrappingSettings,
): {
  wrapped_w: number;
  wrapped_d: number;
  wrapped_h: number;
  final_unit_cbm: number;
  surface_area_sq_in: number;
  corrugate_kg: number;
  corrugate_cost: number;
  bubble_kg: number;
  bubble_cost: number;
} {
  const wrapped_w = (productW || 0) + 2 * icAddPerSide;
  const wrapped_d = (productD || 0) + 2 * icAddPerSide;
  const wrapped_h = (productH || 0) + 2 * icAddPerSide;
  const final_unit_cbm = (wrapped_w * wrapped_d * wrapped_h) / 61020;
  const sa = surfaceAreaSqIn(productW || 0, productD || 0, productH || 0);
  const corrugate_kg = sa * (s.corrugate_kg_per_sq_in || 0);
  const bubble_kg = sa * (s.bubble_kg_per_sq_in || 0);
  return {
    wrapped_w, wrapped_d, wrapped_h, final_unit_cbm,
    surface_area_sq_in: sa,
    corrugate_kg,
    corrugate_cost: corrugate_kg * (s.corrugate_price_per_kg || 0),
    bubble_kg,
    bubble_cost: bubble_kg * (s.bubble_price_per_kg || 0),
  };
}

export function calcFinalUnitCbm(
  includeMc: boolean,
  icVolumeCbm: number,
  productsPerIc: number,
  mcVolumeCbm: number,
  productsPerMc: number
): number {
  if (includeMc && productsPerMc > 0) {
    return mcVolumeCbm / productsPerMc;
  }
  if (productsPerIc > 0) {
    return icVolumeCbm / productsPerIc;
  }
  return 0;
}

export function calcTotalCbm(finalUnitCbm: number, quantity: number): number {
  return finalUnitCbm * quantity;
}

// ============================================================
// COGS
// ============================================================

export function calcCogsItemCost(item: CogsItem): {
  total_units_per_product: number;
  unit_cost: number;
  total_cost_per_product: number;
} {
  if (item.include === 'No') return { total_units_per_product: 0, unit_cost: 0, total_cost_per_product: 0 };

  const wasteDivisor = 1 - (item.waste_factor || 0);
  const total_units_per_product = wasteDivisor > 0
    ? item.components_per_product / wasteDivisor
    : item.components_per_product;

  const unit_cost = item.unit_cost_inr * total_units_per_product;
  return { total_units_per_product, unit_cost, total_cost_per_product: unit_cost };
}

export function calcTotalCogsPerUnit(items: CogsItem[], quantity: number): number {
  return items.reduce((sum, item) => sum + calcCogsItemCost(item).unit_cost, 0);
}

export function calcNonUnitCogsPerUnit(items: NonUnitCogsItem[], quantity: number): number {
  if (quantity <= 0) return 0;
  return items
    .filter(i => i.include !== 'No')
    .reduce((sum, item) => sum + (item.total_quantity * item.cost_each_inr) / quantity, 0);
}

// ============================================================
// Finishing Materials (auto-calculated COGS)
// ============================================================

export function calcFinishingMaterialQty(
  chemicalRate_per100ri: number,
  ri: number,
  percentWood: number
): number {
  return chemicalRate_per100ri * (ri / 100) * percentWood;
}

/**
 * Surface area of a rectangular box in square inches. = 2(LW + LH + WH)
 */
export function calcSurfaceArea(w: number, d: number, h: number): number {
  if (w <= 0 || d <= 0 || h <= 0) return 0;
  return 2 * (w * d + w * h + d * h);
}

/**
 * Wax quantity in grams = surface_area * grams_per_sqin * percent_wood.
 * Only the wood surface gets waxed (matches per-chemical convention).
 */
export function calcWaxGrams(
  w: number, d: number, h: number,
  gramsPerSqIn: number,
  percentWood: number,
): number {
  return calcSurfaceArea(w, d, h) * (gramsPerSqIn || 0) * (percentWood ?? 1);
}

// ============================================================
// Difficulty Factor
// ============================================================

const DIFFICULTY_FACTORS: Record<string, number> = {
  'Extremely Easy': 0.5,
  'Very Easy': 0.7,
  'Easy': 0.9,
  'Medium': 1.0,
  'Hard': 1.1,
  'Very Hard': 1.3,
};

export function getDifficultyFactor(difficulty: string): number {
  return DIFFICULTY_FACTORS[difficulty] || 1.0;
}

// ============================================================
// Labor / Direct Overhead
// ============================================================

export function calcFinishingLaborMhPerUnit(
  contractorBaseRate: number,
  contractorToInhouseDecrease: number,
  difficultyFactor: number,
  avgFinishingSandingPay: number,
  ri: number,
  percentWood: number = 1
): number {
  if (avgFinishingSandingPay <= 0) return 0;
  const adjustedRate = contractorBaseRate * (1 - contractorToInhouseDecrease) * difficultyFactor;
  const mhPer100ri = (adjustedRate / avgFinishingSandingPay) * 100;
  const effectiveRi = ri * (percentWood ?? 1);
  return mhPer100ri * (effectiveRi / 100);
}

// Phase 3a: new direct finishing labor formula. Uses MH/100RI from product_type and
// adjustment factor from finishing_difficulty table (instead of contractor rate / payrate).
export function calcFinishingMhPerUnit(
  finishingMhPer100Ri: number,
  adjustmentFactor: number,
  percentWood: number,
  ri: number,
): number {
  if (!finishingMhPer100Ri || ri <= 0) return 0;
  return finishingMhPer100Ri * (adjustmentFactor || 1) * (percentWood ?? 1) * (ri / 100);
}

export function calcPackagingLaborMhPerUnit(
  packagingMhPerCbm: number,
  finalUnitCbm: number
): number {
  return packagingMhPerCbm * finalUnitCbm;
}

// Phase 3a: pick the right MH/CBM rate from product_types based on the product's packaging type.
export function packagingMhPerCbmForType(
  productType: any,
  packagingType: 'no_packaging' | 'ic_only' | 'ic_mc' | 'corrugate_bubble' | string,
): number {
  if (!productType) return 0;
  switch (packagingType) {
    case 'corrugate_bubble': return productType.pkg_corrugate_bubble_rate_mh_per_cbm ?? 0;
    case 'ic_only':          return productType.pkg_ic_rate_mh_per_cbm ?? 0;
    case 'ic_mc':            return productType.pkg_ic_mc_rate_mh_per_cbm ?? 0;
    case 'no_packaging':     return 0;
    default:                 return productType.pkg_ic_mc_rate_mh_per_cbm ?? 0;
  }
}

export function calcOverheadItemCost(item: OverheadItem, quantity: number): {
  total_man_hours: number;
  unit_cost: number;
  total_cost: number;
} {
  if (item.include === 'No') return { total_man_hours: 0, unit_cost: 0, total_cost: 0 };
  const total_man_hours = item.man_hours_per_unit * quantity;
  const unit_cost = item.man_hours_per_unit * item.hourly_rate;
  const total_cost = unit_cost * quantity;
  return { total_man_hours, unit_cost, total_cost };
}

export function calcTotalDirectOverheadPerUnit(items: OverheadItem[], quantity: number): number {
  return items.reduce((sum, item) => sum + calcOverheadItemCost(item, quantity).unit_cost, 0);
}

export function calcTotalDirectManHoursPerUnit(items: OverheadItem[]): number {
  return items
    .filter(i => i.include !== 'No')
    .reduce((sum, i) => sum + i.man_hours_per_unit, 0);
}

// ============================================================
// Indirect Overhead
// ============================================================

export function calcIndirectOhPerManHour(settings: GlobalSettings & { total_available_mh_per_month?: number | null }): number {
  const totalMh = Number(settings.total_available_mh_per_month) || 0;
  return totalMh > 0 ? settings.indirect_overhead_monthly / totalMh : 0;
}

export function calcIndirectOhPerUnit(
  totalDirectMhPerUnit: number,
  indirectOhPerManHour: number
): number {
  return totalDirectMhPerUnit * indirectOhPerManHour;
}

// ============================================================
// Shipping
// ============================================================

export function calcShippingPerUnit(config: ShippingConfig): number {
  if (config.per_unit === 'KG') {
    return config.cost_inr * (config.weight_kg || 0);
  }
  return config.cost_inr * (config.final_unit_cbm || 0);
}

// ============================================================
// Product Cost Summary
// ============================================================

export interface CostSummary {
  total_cogs_per_unit: number;
  total_direct_oh_per_unit: number;
  total_indirect_oh_per_unit: number;
  total_shipping_per_unit: number;
  product_cost_per_unit_inr: number;
  product_cost_per_unit_usd: number;
  unit_price_inr: number;
  unit_price_usd: number;
  total_revenue_inr: number;
  total_cost_inr: number;
  gross_profit_inr: number;
  net_profit_inr: number;
  gpm: number;
  npm: number;
}

export function calcProductCostSummary(
  cogsPerUnit: number,
  nonUnitCogsPerUnit: number,
  directOhPerUnit: number,
  indirectOhPerUnit: number,
  shippingPerUnit: number,
  markupPercent: number,
  exchangeRate: number,
  quantity: number
): CostSummary {
  const total_cogs_per_unit = cogsPerUnit + nonUnitCogsPerUnit;
  const product_cost_per_unit_inr = total_cogs_per_unit + directOhPerUnit + indirectOhPerUnit + shippingPerUnit;
  const product_cost_per_unit_usd = exchangeRate > 0 ? product_cost_per_unit_inr / exchangeRate : 0;

  const unit_price_inr = product_cost_per_unit_inr * (1 + markupPercent);
  const unit_price_usd = exchangeRate > 0 ? unit_price_inr / exchangeRate : 0;

  const total_revenue_inr = unit_price_inr * quantity;
  const total_cost_inr = product_cost_per_unit_inr * quantity;
  const total_cogs_total = total_cogs_per_unit * quantity;

  const gross_profit_inr = total_revenue_inr - total_cogs_total;
  const net_profit_inr = total_revenue_inr - total_cost_inr;

  const gpm = total_revenue_inr > 0 ? gross_profit_inr / total_revenue_inr : 0;
  const npm = total_revenue_inr > 0 ? net_profit_inr / total_revenue_inr : 0;

  return {
    total_cogs_per_unit,
    total_direct_oh_per_unit: directOhPerUnit,
    total_indirect_oh_per_unit: indirectOhPerUnit,
    total_shipping_per_unit: shippingPerUnit,
    product_cost_per_unit_inr,
    product_cost_per_unit_usd,
    unit_price_inr,
    unit_price_usd,
    total_revenue_inr,
    total_cost_inr,
    gross_profit_inr,
    net_profit_inr,
    gpm,
    npm,
  };
}

// ============================================================
// Variant Pricing
// ============================================================

export function calcVariantCost(
  masterRawPieceCost: number,
  woodPriceFactor: number,
  otherCostsPerUnit: number,
  markupPercent: number,
  exchangeRate: number
): {
  variant_raw_piece_cost: number;
  variant_product_cost: number;
  variant_unit_price_inr: number;
  variant_unit_price_usd: number;
} {
  const variant_raw_piece_cost = masterRawPieceCost * woodPriceFactor;
  const variant_product_cost = variant_raw_piece_cost + otherCostsPerUnit;
  const variant_unit_price_inr = variant_product_cost * (1 + markupPercent);
  const variant_unit_price_usd = exchangeRate > 0 ? variant_unit_price_inr / exchangeRate : 0;
  return { variant_raw_piece_cost, variant_product_cost, variant_unit_price_inr, variant_unit_price_usd };
}

// ============================================================
// Assembly Pricing (multi-component products)
// ============================================================

export interface AssemblyComponent {
  product_cost_per_unit: number;
  final_unit_cbm: number;
  weight_kg: number;
  total_man_hours_per_unit: number;
  quantity_per_assembly: number;
}

export function calcAssemblyCost(
  components: AssemblyComponent[],
  markupPercent: number,
  exchangeRate: number
): {
  unit_cost_inr: number;
  unit_cbm: number;
  unit_weight_kg: number;
  unit_man_hours: number;
  unit_price_inr: number;
  unit_cost_usd: number;
  unit_price_usd: number;
  num_cartons: number;
} {
  const unit_cost_inr = components.reduce((sum, c) => sum + c.product_cost_per_unit * c.quantity_per_assembly, 0);
  const unit_cbm = components.reduce((sum, c) => sum + c.final_unit_cbm * c.quantity_per_assembly, 0);
  const unit_weight_kg = components.reduce((sum, c) => sum + c.weight_kg * c.quantity_per_assembly, 0);
  const unit_man_hours = components.reduce((sum, c) => sum + c.total_man_hours_per_unit * c.quantity_per_assembly, 0);
  const unit_price_inr = unit_cost_inr * (1 + markupPercent);
  const unit_cost_usd = exchangeRate > 0 ? unit_cost_inr / exchangeRate : 0;
  const unit_price_usd = exchangeRate > 0 ? unit_price_inr / exchangeRate : 0;
  const num_cartons = components.length;
  return { unit_cost_inr, unit_cbm, unit_weight_kg, unit_man_hours, unit_price_inr, unit_cost_usd, unit_price_usd, num_cartons };
}

// ============================================================
// Formatting Helpers
// ============================================================

export function formatINR(value: number): string {
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatUSD(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatQty(value: number): string {
  return Math.round(value).toLocaleString();
}

export function formatCbm(value: number): string {
  return `${value.toFixed(4)} CBM`;
}

export function formatDimensions(w: number, d: number, h: number): string {
  return `${w || 0}" × ${d || 0}" × ${h || 0}"`;
}

// ============================================================
// Average employee rate by designation
// ============================================================

export function avgRateByDesignation(
  employees: { hourly_rate_inr: number; designations: string[] }[],
  designation: string
): number {
  const matching = employees.filter(e => e.designations.includes(designation));
  if (matching.length === 0) return 0;
  return matching.reduce((sum, e) => sum + e.hourly_rate_inr, 0) / matching.length;
}

// ============================================================
// Net Profit Margin <-> Markup helpers
// ============================================================

/**
 * Convert net profit margin (decimal, e.g. 0.20 for 20%) to markup multiplier (e.g. 0.25).
 * markup = npm / (1 - npm)
 */
export function npmToMarkup(npm: number): number {
  if (!isFinite(npm) || npm >= 1) return Infinity;
  if (npm <= 0) return 0;
  return npm / (1 - npm);
}

/**
 * Convert markup multiplier (e.g. 0.25) to net profit margin (e.g. 0.20).
 * npm = markup / (1 + markup)
 */
export function markupToNpm(markup: number): number {
  if (!isFinite(markup) || markup <= 0) return 0;
  return markup / (1 + markup);
}
