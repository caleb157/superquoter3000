// Compute current calculated unit prices (USD) for many products at once.
// Used by Dashboard for the weighted pipeline value so we no longer rely on target_price_usd.
//
// IMPORTANT: This module runs the same engine as the product costing sheet
// in-memory so prices stay consistent with the costing sheet even when the user
// has not opened the costing tab to flush the latest auto-cost values to DB.
import { supabase } from '@/integrations/supabase/client';
import { loadFobRates } from '@/lib/fob-rates';
import { computeProductCosting, type ShipmentPool } from '@/lib/costing-engine';
import { costPointFromResult, type CostPoint } from '@/lib/cost-history';
import { fetchAllByIds, fetchAllRows } from '@/lib/supabase-paged';

let _difficultiesCache: Array<{ name: string; rupees_per_ri?: number | null }> | null = null;
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
  /** Cost history point for this result (logged when a cache heal writes the new price). */
  cost_point?: CostPoint;
}>;


// Back-compat alias for older imports
export type ProductUnitPriceMap = ProductPriceCostMap;

export async function computeProductPriceAndCost(productIds: string[]): Promise<ProductPriceCostMap> {
  if (productIds.length === 0) return {};
  // Expand to sibling products in the same inquiries so FOB shipping can be priced on the
  // whole inquiry shipment. Pass 1 gets CBM/cartons (shipping-independent), pass 2 uses the pool.
  const own = await fetchAllByIds<{ id: string; customer_rfq_id: string | null }>(productIds, (chunk) =>
    supabase.from('products').select('id, customer_rfq_id').in('id', chunk).order('id'));
  const inqIds = [...new Set((own || []).map((p: any) => p.customer_rfq_id).filter(Boolean))] as string[];
  let allIds = productIds;
  if (inqIds.length) {
    const sibs = await fetchAllByIds<{ id: string }>(inqIds, (chunk) =>
      supabase.from('products').select('id').in('customer_rfq_id', chunk).is('archived_at', null).order('id'));
    allIds = [...new Set([...productIds, ...sibs.map((s) => s.id)])];
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

const byIds = (table: string, column: string, ids: string[]) =>
  fetchAllByIds<any>(ids, (chunk) => (supabase as any).from(table).select('*').in(column, chunk).order('id'));
const all = (table: string, columns = '*') =>
  fetchAllRows<any>(() => (supabase as any).from(table).select(columns).order('id'));

async function computeCore(productIds: string[], pools: Record<string, ShipmentPool> | null): Promise<ProductPriceCostMap> {
  const out: ProductPriceCostMap = {};
  if (productIds.length === 0) return out;

  await loadFobRates();
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
    // Every list is paged (fetchAllRows / fetchAllByIds): PostgREST returns at most 1,000
    // rows per request, and a big inquiry easily has more cost lines than that.
    byIds('products', 'id', productIds),
    byIds('cogs_items', 'product_id', productIds),
    byIds('non_unit_cogs', 'product_id', productIds),
    byIds('overhead_items', 'product_id', productIds),
    byIds('shipping_items', 'product_id', productIds),
    all('shipping_types'),
    all('labor_employees'),
    supabase.from('global_settings').select('*').limit(1).single(),
    byIds('cbm_estimates', 'product_id', productIds),
    all('product_types'),
    all('customer_rfqs', 'id, exchange_rate_override, markup_percent_override, shipping_type_id_override, indirect_overhead_per_mh_override, packaging_cost_per_cbm_override, auto_transport_cost_per_cbm_override, local_transport_cost_per_cbm_override, fob_pool_cbm_override, fob_pool_cartons_override, fob_fumigation, fob_wlc'),
    all('chemical_prices'),
    all('box_data'),
    all('finishing_difficulty'),
    all('local_transport_locations', 'id, cost_per_cbm_inr'),
    all('raw_material_costs', 'id, name, cost, unit_type, active'),
  ]);

  const products = productsRes;
  const cogs = cogsRes;
  const allNu = nuRes;
  const allOh = ohRes;
  const allShipItems = shipItemsRes;
  const shipTypes = shipTypesRes;
  const employees = empRes;
  const gs = gsRes.data as any;
  const allCbm = cbmRes;
  const productTypes = ptRes;
  const inquiries = inquiriesRes;
  const inquiryById = Object.fromEntries(inquiries.map((i: any) => [i.id, i]));
  const chemicalPrices = chemRes;
  const boxData = boxRes;
  const difficulties: any[] = diffRes as any[];
  const locations: any[] = locRes as any[];
  const rawMaterialCosts: any[] = rawRes as any[];
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

    // Keep stored packaged CBM in sync with the live OD-based value (single source of truth).
    const liveCbm = Number(result.finalUnitCbm) || 0;
    if (cbmRow?.id && Math.abs((Number(cbmRow.final_unit_cbm) || 0) - liveCbm) > 0.000001) {
      void supabase.from('cbm_estimates')
        .update({ final_unit_cbm: liveCbm, total_cbm: +(liveCbm * (Number(p.quantity) || 0)).toFixed(4) })
        .eq('id', cbmRow.id).then(() => {});
    }

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
      cost_point: costPointFromResult(result),
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
