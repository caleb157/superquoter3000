// The rate tables every costing run reads (settings, labor rates, shipping types,
// chemicals, boxes, product types, ...). They are the same for every product, so they
// are fetched once and shared for a short while instead of on every engine batch: the
// Inquiries list runs the engine many batches in a row, each of which used to re-read
// all of them.
//
// Freshness: the cache lives at most CACHE_MS, only on the page that fetched it (opening
// another page reads fresh), and is dropped after a live-rates sync, so an edit in
// Settings shows up on the next page you open.
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/supabase-paged';

export type CostingReference = {
  globalSettings: any;
  shippingTypes: any[];
  laborEmployees: any[];
  productTypes: any[];
  chemicalPrices: any[];
  boxData: any[];
  difficulties: any[];
  locations: any[];
  rawMaterialCosts: any[];
};

const CACHE_MS = 30_000;

let cached: { at: number; path: string; promise: Promise<CostingReference> } | null = null;

const currentPath = () => (typeof window === 'undefined' ? '' : window.location.pathname);

const all = (table: string, columns = '*') =>
  fetchAllRows<any>(() => (supabase as any).from(table).select(columns).order('id'));

async function fetchReference(): Promise<CostingReference> {
  const [gsRes, shippingTypes, laborEmployees, productTypes, chemicalPrices, boxData, difficulties, locations, rawMaterialCosts] =
    await Promise.all([
      supabase.from('global_settings').select('*').limit(1).single(),
      all('shipping_types'),
      all('labor_employees'),
      all('product_types'),
      all('chemical_prices'),
      all('box_data'),
      all('finishing_difficulty'),
      all('local_transport_locations', 'id, cost_per_cbm_inr'),
      all('raw_material_costs', 'id, name, cost, unit_type, active'),
    ]);
  return {
    globalSettings: gsRes.data as any,
    shippingTypes, laborEmployees, productTypes, chemicalPrices, boxData, difficulties, locations, rawMaterialCosts,
  };
}

/** Shared rate tables for the costing engine; concurrent callers share one fetch. */
export function loadCostingReference(): Promise<CostingReference> {
  const path = currentPath();
  if (cached && cached.path === path && Date.now() - cached.at < CACHE_MS) return cached.promise;
  const promise = fetchReference();
  const entry = { at: Date.now(), path, promise };
  cached = entry;
  // A failed fetch is not kept: the next caller tries again.
  promise.catch(() => { if (cached === entry) cached = null; });
  return promise;
}

/** Drop the cached rate tables so the next costing run reads them fresh. */
export function invalidateCostingReference(): void {
  cached = null;
}
