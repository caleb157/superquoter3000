// Compute current calculated unit prices (USD) for many products at once.
// Used by Dashboard for the weighted pipeline value so we no longer rely on target_price_usd.
//
// IMPORTANT: This module mirrors the auto-calculations performed by ProductCostingTab
// in-memory so prices stay consistent with the costing sheet even when the user
// has not opened the costing tab to flush the latest auto-cost values to DB.
import { supabase } from '@/integrations/supabase/client';
import { computeProductCosting, type ShipmentPool } from '@/lib/costing-engine';

let _difficultiesCache: Array<{ name: string; adjustment_factor: number }> | null = null;
let _locationsCache: Array<{ id: string; cost_per_cbm_inr: number }> | null = null;

export type ProductPriceCostMap = Record<string, {
  unit_cost_usd: number;     // FOB cost, no markup. Authoritative live engine recompute.
  unit_cogs_usd: number;     // COGS-only (materials + non-unit cogs), no labor/overhead/shipping
  unit_price_usd: number;    // cost + markup. Authoritative live engine recompute (= costing sheet).
  unit_price_inr: number;
  exchange_rate: number;
  man_hours_per_unit: number; // finishing + overhead labor MH per unit (included rows only)
  final_unit_cbm: number;     // packed CBM per unit straight from the costing engine
  products_per_mc: number;
  quantity: number;
  customer_rfq_id: string | null;
  archived: boolean;
  fob_estimate?: import('@/lib/fob').FobEstimate;
  markup_percent: number;     // effective markup used by the engine (inquiry override aware)
  // Per-unit cost buckets in INR (same split as the costing sheet summary table)
  buckets_inr: { cogs: number; directOh: number; indirectOh: number; shipping: number };
  unit_cost_inr: number;
  // For cache healing: the value currently stored in the products table.
  stored_price_usd: number | null;
  stored_cost_usd: number | null;
  cache_is_stale: boolean;
}>;


// Back-compat alias for older imports
export type ProductUnitPriceMap = ProductPriceCostMap;

export async function computeProductPriceAndCost(productIds: string[]): Promise<ProductPriceCostMap> {
  if (productIds.length === 0) return {};
  // Expand to sibling products in the same inquiries so FOB shipping can be priced on the
  // whole inquiry shipment. Pass 1 gets CBM/cartons (shipping-independent), pass 2 uses the pool.
  const { data: own } = await supabase.from('products').select('id, customer_rfq_id').in('id', productIds).limit(100000);
  const inqIds = [...new Set((own || []).map((p: any) => p.customer_rfq_id).filter(Boolean))] as string[];
  let allIds = productIds;
  if (inqIds.length) {
    const { data: sibs } = await supabase.from('products').select('id').in('customer_rfq_id', inqIds).is('archived_at', null).limit(100000);
    allIds = [...new Set([...productIds, ...((sibs || []).map((s: any) => s.id))])];
  }
  const first = await computeCore(allIds, null);
  const pools = buildPoolsFromMap(first);
  const second = await computeCore(productIds, pools);
  return second;
}

/** Build per-inquiry shipment pools from a pass-1 price map. */
export function buildPoolsFromMap(map: ProductPriceCostMap): Record<string, ShipmentPool> {
  const pools: Record<string, ShipmentPool> = {};
  for (const [id, v] of Object.entries(map)) {
    if (!v.customer_rfq_id || v.archived) continue;
    (pools[v.customer_rfq_id] ||= { lines: [] }).lines.push({
      product_id: id,
      cbm: v.quantity * v.final_unit_cbm,
      cartons: v.quantity > 0 ? Math.ceil(v.quantity / (v.products_per_mc || 1)) : 0,
    });
  }
  return pools;
}

async function computeCore(productIds: string[], pools: Record<string, ShipmentPool> | null): Promise<ProductPriceCostMap> {
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
    rawRes,
  ] = await Promise.all([
    supabase.from('products').select('*').in('id', productIds).limit(100000),
    supabase.from('cogs_items').select('*').in('product_id', productIds).limit(100000),
    supabase.from('non_unit_cogs').select('*').in('product_id', productIds).limit(100000),
    supabase.from('overhead_items').select('*').in('product_id', productIds).limit(100000),
    supabase.from('shipping_items').select('*').in('product_id', productIds).limit(100000),
    supabase.from('shipping_types').select('*').limit(100000),
    supabase.from('labor_employees').select('*').limit(100000),
    supabase.from('global_settings').select('*').limit(1).single(),
    supabase.from('cbm_estimates').select('*').in('product_id', productIds).limit(100000),
    supabase.from('product_types').select('*').limit(100000),
    supabase.from('customer_rfqs').select('id, exchange_rate_override, markup_percent_override, shipping_type_id_override, indirect_overhead_per_mh_override, packaging_cost_per_cbm_override, auto_transport_cost_per_cbm_override, local_transport_cost_per_cbm_override, fob_pool_cbm_override, fob_pool_cartons_override, fob_mode_override').limit(100000),
    supabase.from('chemical_prices').select('*').limit(100000),
    supabase.from('box_data').select('*').limit(100000),
    (supabase as any).from('finishing_difficulty').select('name, adjustment_factor').limit(100000),
    (supabase as any).from('local_transport_locations').select('id, cost_per_cbm_inr').limit(100000),
    (supabase as any).from('raw_material_costs').select('id, name, cost, unit_type, active').limit(100000),
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
  const rawMaterialCosts: any[] = (rawRes as any).data || [];
  _difficultiesCache = difficulties as any;
  _locationsCache = locations as any;


  for (const p of products as any[]) {
    const inq = p.customer_rfq_id ? inquiryById[p.customer_rfq_id] : null;
    const productType = productTypes.find((pt: any) => pt.id === p.product_type_id) as any;
    const cbmRow = allCbm.find((c: any) => c.product_id === p.id) as any;

    const result = computeProductCosting({
      product: p,
      cogsItems: (cogs as any[]).filter((c: any) => c.product_id === p.id),
      nonUnitCogs: (allNu as any[]).filter((n: any) => n.product_id === p.id),
      overheadItems: (allOh as any[]).filter((o: any) => o.product_id === p.id),
      shippingItems: allShipItems as any[],
      cbmRow,
      productType,
      boxData: boxData as any[],
      chemicalPrices: chemicalPrices as any[],
      shippingTypes: shipTypes as any[],
      laborEmployees: employees as any[],
      globalSettings: gs,
      inquiryOverrides: inq,
      locations,
      difficulties,
      rawMaterialCosts,
      shipmentPool: pools && p.customer_rfq_id ? pools[p.customer_rfq_id] : null,
    });

    const { summary, exchangeRate, cogsPerUnit, nonUnitCogsPerUnit } = result;
    const totalCogsPerUnitInr = cogsPerUnit + nonUnitCogsPerUnit;
    const unitCogsUsd = exchangeRate > 0 ? totalCogsPerUnitInr / exchangeRate : 0;

    const recomputedPriceUsd = summary.unit_price_usd;
    const recomputedCostUsd = summary.product_cost_per_unit_usd;
    const storedPriceRaw = (p as any).calculated_unit_price_usd;
    const storedCostRaw = (p as any).calculated_unit_cost_usd;
    const storedPriceUsd = storedPriceRaw == null ? null : Number(storedPriceRaw);
    const storedCostUsd = storedCostRaw == null ? null : Number(storedCostRaw);

    out[p.id] = {
      // Unified engine — the live recompute IS the costing sheet. Use it as authoritative.
      unit_price_usd: recomputedPriceUsd,
      unit_cost_usd: recomputedCostUsd,
      unit_cogs_usd: unitCogsUsd,
      unit_price_inr: summary.unit_price_inr,
      exchange_rate: exchangeRate,
      man_hours_per_unit: result.manHoursPerUnit || 0,
      final_unit_cbm: Number(result.finalUnitCbm) || 0,
      markup_percent: result.markupPercent,
      products_per_mc: result.productsPerMc || 1,
      quantity: Number(p.quantity) || 0,
      customer_rfq_id: p.customer_rfq_id ?? null,
      archived: !!p.archived_at,
      fob_estimate: result.fobEstimate,
      unit_cost_inr: summary.product_cost_per_unit_inr,
      buckets_inr: {
        cogs: summary.total_cogs_per_unit,
        directOh: summary.total_direct_oh_per_unit,
        indirectOh: summary.total_indirect_oh_per_unit,
        shipping: summary.total_shipping_per_unit,
      },
      stored_price_usd: storedPriceUsd,
      stored_cost_usd: storedCostUsd,
      cache_is_stale:
        storedPriceUsd != null &&
        Number.isFinite(recomputedPriceUsd) &&
        Math.abs(storedPriceUsd - recomputedPriceUsd) > 0.01,
    };
  }


  return out;
}

// Back-compat alias for older imports
export const computeProductUnitPrices = computeProductPriceAndCost;


/** Pass-1 only: returns shipment pools keyed by inquiry id. */
export async function computeCoreFirstPass(productIds: string[]): Promise<Record<string, ShipmentPool>> {
  return buildPoolsFromMap(await computeCore(productIds, null));
}
