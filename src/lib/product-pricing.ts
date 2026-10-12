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
import { fetchAllByIds } from '@/lib/supabase-paged';
import { loadCostingReference, type CostingReference } from '@/lib/costing-reference';

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
  // Both passes run on one load of the data.
  const own = await fetchAllByIds<{ id: string; customer_rfq_id: string | null }>(productIds, (chunk) =>
    supabase.from('products').select('id, customer_rfq_id').in('id', chunk).order('id'));
  const inqIds = [...new Set((own || []).map((p: any) => p.customer_rfq_id).filter(Boolean))] as string[];
  let allIds = productIds;
  if (inqIds.length) {
    const sibs = await fetchAllByIds<{ id: string }>(inqIds, (chunk) =>
      supabase.from('products').select('id').in('customer_rfq_id', chunk).is('archived_at', null).order('id'));
    allIds = [...new Set([...productIds, ...sibs.map((s) => s.id)])];
  }
  const data = await loadCoreData(allIds, inqIds);
  const first = runCore(data, allIds, null, true);
  const pools = buildPoolsFromMap(first);
  return runCore(data, productIds, pools, false);
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

const byIds = (table: string, column: string, ids: string[], columns = '*') =>
  fetchAllByIds<any>(ids, (chunk) => (supabase as any).from(table).select(columns).in(column, chunk).order('id'));

const INQUIRY_OVERRIDE_COLUMNS = 'id, exchange_rate_override, markup_percent_override, shipping_type_id_override, indirect_overhead_per_mh_override, packaging_cost_per_cbm_override, auto_transport_cost_per_cbm_override, local_transport_cost_per_cbm_override, fob_pool_cbm_override, fob_pool_cartons_override, fob_fumigation, fob_wlc';

type CoreData = {
  productById: Map<string, any>;
  /** Cost lines grouped by product id, so each product's lookup is direct. */
  cogsBy: Map<string, any[]>;
  nuBy: Map<string, any[]>;
  ohBy: Map<string, any[]>;
  shipBy: Map<string, any>;
  cbmBy: Map<string, any>;
  inquiryById: Map<string, any>;
  productTypeById: Map<string, any>;
  ref: CostingReference;
};

function groupBy(rows: any[]): Map<string, any[]> {
  const m = new Map<string, any[]>();
  for (const r of rows) {
    const list = m.get(r.product_id);
    if (list) list.push(r); else m.set(r.product_id, [r]);
  }
  return m;
}
function firstBy(rows: any[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const r of rows) if (!m.has(r.product_id)) m.set(r.product_id, r);
  return m;
}

/** Everything the engine needs for these products, fetched once (rate tables cached). */
async function loadCoreData(productIds: string[], inquiryIds?: string[]): Promise<CoreData> {
  const [, ref, products, cogs, nu, oh, ship, cbm, knownInquiries] = await Promise.all([
    loadFobRates(),
    loadCostingReference(),
    // Every list is paged (fetchAllByIds): PostgREST returns at most 1,000 rows per
    // request, and a big inquiry easily has more cost lines than that.
    byIds('products', 'id', productIds),
    byIds('cogs_items', 'product_id', productIds),
    byIds('non_unit_cogs', 'product_id', productIds),
    byIds('overhead_items', 'product_id', productIds),
    byIds('shipping_items', 'product_id', productIds),
    byIds('cbm_estimates', 'product_id', productIds),
    inquiryIds ? byIds('customer_rfqs', 'id', inquiryIds, INQUIRY_OVERRIDE_COLUMNS) : Promise.resolve(null),
  ]);
  let inquiries = knownInquiries as any[] | null;
  const neededInq = [...new Set((products as any[]).map(p => p.customer_rfq_id).filter(Boolean))] as string[];
  const have = new Set((inquiries ?? []).map((i: any) => i.id));
  const missing = neededInq.filter(id => !have.has(id));
  if (missing.length) inquiries = [...(inquiries ?? []), ...(await byIds('customer_rfqs', 'id', missing, INQUIRY_OVERRIDE_COLUMNS))];
  return {
    productById: new Map((products as any[]).map(p => [p.id, p])),
    cogsBy: groupBy(cogs),
    nuBy: groupBy(nu),
    ohBy: groupBy(oh),
    shipBy: firstBy(ship),
    cbmBy: firstBy(cbm),
    inquiryById: new Map((inquiries ?? []).map((i: any) => [i.id, i])),
    productTypeById: new Map(ref.productTypes.map((pt: any) => [pt.id, pt])),
    ref,
  };
}

async function computeCore(productIds: string[], pools: Record<string, ShipmentPool> | null): Promise<ProductPriceCostMap> {
  if (productIds.length === 0) return {};
  return runCore(await loadCoreData(productIds), productIds, pools, true);
}

/** Run the engine over loaded data. `syncCbm` writes drifted packaged CBM back (once per load). */
function runCore(data: CoreData, productIds: string[], pools: Record<string, ShipmentPool> | null, syncCbm: boolean): ProductPriceCostMap {
  const out: ProductPriceCostMap = {};
  const { ref } = data;

  for (const id of productIds) {
    const p = data.productById.get(id);
    if (!p) continue;
    const inq = p.customer_rfq_id ? data.inquiryById.get(p.customer_rfq_id) ?? null : null;
    const productType = data.productTypeById.get(p.product_type_id);
    const cbmRow = data.cbmBy.get(p.id);
    const shipItem = data.shipBy.get(p.id);

    const result = computeProductCosting({
      product: p,
      cogsItems: data.cogsBy.get(p.id) ?? [],
      nonUnitCogs: data.nuBy.get(p.id) ?? [],
      overheadItems: data.ohBy.get(p.id) ?? [],
      shippingItems: shipItem ? [shipItem] : [],
      cbmRow,
      productType,
      boxData: ref.boxData,
      chemicalPrices: ref.chemicalPrices,
      shippingTypes: ref.shippingTypes,
      laborEmployees: ref.laborEmployees,
      globalSettings: ref.globalSettings,
      inquiryOverrides: inq,
      locations: ref.locations,
      difficulties: ref.difficulties,
      rawMaterialCosts: ref.rawMaterialCosts,
      shipmentPool: pools && p.customer_rfq_id ? pools[p.customer_rfq_id] : null,
    });

    // Keep stored packaged CBM in sync with the live OD-based value (single source of truth).
    const liveCbm = Number(result.finalUnitCbm) || 0;
    if (syncCbm && cbmRow?.id && Math.abs((Number(cbmRow.final_unit_cbm) || 0) - liveCbm) > 0.000001) {
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
