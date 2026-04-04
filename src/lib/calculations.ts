// DKT Costing App — Pure Calculation Engine
// All business math lives here. Components call these functions.

// ============================================================
// Types
// ============================================================

export interface GlobalSettings {
  exchange_rate: number;
  num_laborers: number;
  available_hours_per_month: number;
  indirect_overhead_monthly: number;
  packaging_cost_per_cbm: number;
  contractor_to_inhouse_decrease: number;
  default_shipping_type: string;
}

export interface ProductType {
  id: string;
  name: string;
  contractor_base_rate_per_ri: number;
  ic_addition_per_side_inch: number;
  finishing_color_per_100ri: number;
  finishing_sealer_per_100ri: number;
  finishing_lacquer_per_100ri: number;
  packaging_mh_per_cbm: number;
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
  mc_buffer_inch: number;
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

export function calcMCPacking(config: MCConfig): {
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

  const along_w = Math.max(1, Math.floor((mc_max_width - mc_buffer_inch) / ic_width));
  const along_d = Math.max(1, Math.floor((mc_max_depth - mc_buffer_inch) / ic_depth));
  const along_h = Math.max(1, Math.floor((mc_max_height - mc_buffer_inch) / ic_height));

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

  const mc_width = ic_width * actual_w + mc_buffer_inch;
  const mc_depth = ic_depth * actual_d + mc_buffer_inch;
  const mc_height = ic_height * actual_h + mc_buffer_inch;
  const mc_volume_cbm = (mc_width * mc_depth * mc_height) / 61020;

  return {
    mc_ics_along_w: actual_w, mc_ics_along_d: actual_d, mc_ics_along_h: actual_h,
    products_per_mc, mc_width, mc_depth, mc_height, mc_volume_cbm,
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

// ============================================================
// Difficulty Factor
// ============================================================

const DIFFICULTY_FACTORS: Record<string, number> = {
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
  ri: number
): number {
  if (avgFinishingSandingPay <= 0) return 0;
  const adjustedRate = contractorBaseRate * (1 - contractorToInhouseDecrease) * difficultyFactor;
  const mhPer100ri = (adjustedRate / avgFinishingSandingPay) * 100;
  return mhPer100ri * (ri / 100);
}

export function calcPackagingLaborMhPerUnit(
  packagingMhPerCbm: number,
  finalUnitCbm: number
): number {
  return packagingMhPerCbm * finalUnitCbm;
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

export function calcIndirectOhPerManHour(settings: GlobalSettings): number {
  const denom = settings.num_laborers * settings.available_hours_per_month;
  return denom > 0 ? settings.indirect_overhead_monthly / denom : 0;
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
