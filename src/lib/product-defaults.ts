// Shared helper to seed a newly-created product with default costing rows
// (COGS items, overhead items, CBM estimate, non-unit COGS).
// Mirrors the defaults used by UploadParseDialog so that products created via
// QuickAdd / other paths get the same starting structure.
import { supabase } from '@/integrations/supabase/client';

// Module-level cache for global settings used during seeding.
// Avoids one extra DB round-trip per product when seeding many in a row
// (e.g. QuickAdd adds 5 products → 1 fetch instead of 5).
const SETTINGS_TTL_MS = 60_000; // 1 minute is plenty for a single bulk-add session
let cachedMcHBuffer: { value: number; at: number } | null = null;

export async function getCachedMcHeightBuffer(): Promise<number> {
  const now = Date.now();
  if (cachedMcHBuffer && now - cachedMcHBuffer.at < SETTINGS_TTL_MS) {
    return cachedMcHBuffer.value;
  }
  const { data } = await (supabase as any)
    .from('global_settings').select('mc_height_buffer_inch').limit(1).single();
  const value = (data as any)?.mc_height_buffer_inch ?? 2.5;
  cachedMcHBuffer = { value, at: now };
  return value;
}

/** Clear the cached global settings (call after editing them in Settings). */
export function clearProductDefaultsCache() {
  cachedMcHBuffer = null;
}

export async function seedProductDefaults(productId: string, opts?: { mcHBuffer?: number }) {
  // The DB trigger `trg_seed_product_defaults` now seeds 14 COGS + 7 overhead +
  // CBM estimate + 1 non-unit COGS row automatically on product INSERT. This
  // function is kept as a safety-net self-heal for legacy products that were
  // created before the trigger existed (or any product that ended up with
  // zero COGS rows for any reason).
  const { count: cogsCount } = await (supabase as any)
    .from('cogs_items').select('id', { count: 'exact', head: true }).eq('product_id', productId);

  const defaultCogs = [
    { product_id: productId, cogs_type: 'Raw Piece', component_name: 'Raw Piece 1', sort_order: 0 },
    { product_id: productId, cogs_type: 'Raw Piece', component_name: 'Raw Piece 2', sort_order: 1 },
    { product_id: productId, cogs_type: 'Subcontracting', component_name: 'Subcontracting 1', sort_order: 2 },
    { product_id: productId, cogs_type: 'Subcontracting', component_name: 'Subcontracting 2', sort_order: 3 },
    { product_id: productId, cogs_type: 'Finishing Materials', component_name: 'Color', is_auto_calculated: true, sort_order: 4 },
    { product_id: productId, cogs_type: 'Finishing Materials', component_name: 'Sealer', is_auto_calculated: true, sort_order: 5 },
    { product_id: productId, cogs_type: 'Finishing Materials', component_name: 'Lacquer', is_auto_calculated: true, sort_order: 6 },
    { product_id: productId, cogs_type: 'Packaging', component_name: 'IC Box', is_auto_calculated: true, waste_factor: 0.05, sort_order: 7 },
    { product_id: productId, cogs_type: 'Packaging', component_name: 'MC Box', is_auto_calculated: true, sort_order: 8 },
    { product_id: productId, cogs_type: 'Packaging', component_name: 'Other Packaging', sort_order: 9 },
    { product_id: productId, cogs_type: 'Hardware', component_name: 'Hardware 1', waste_factor: 0.05, sort_order: 10 },
    { product_id: productId, cogs_type: 'Hardware', component_name: 'Hardware 2', waste_factor: 0.05, sort_order: 11 },
    { product_id: productId, cogs_type: 'Accessories', component_name: 'Accessory 1', waste_factor: 0.05, sort_order: 20 },
    { product_id: productId, cogs_type: 'Accessories', component_name: 'Accessory 2', waste_factor: 0.05, sort_order: 21 },
  ];

  const defaultOverhead = [
    { product_id: productId, labor_type: 'Manufacturing', sort_order: 0 },
    { product_id: productId, labor_type: 'QC', man_hours_per_unit: 0.05, sort_order: 1 },
    
    { product_id: productId, labor_type: 'Finishing', is_auto_estimated: true, sort_order: 3 },
    { product_id: productId, labor_type: 'Assembly', sort_order: 4 },
    { product_id: productId, labor_type: 'Packaging', is_auto_estimated: true, sort_order: 5 },
    { product_id: productId, labor_type: 'Market', sort_order: 6 },
  ];

  const mcHBuffer = opts?.mcHBuffer ?? (await getCachedMcHeightBuffer());

  // Gate every insert on its existing row count so we never duplicate seeds —
  // critical because the DB trigger may have already populated everything.
  const [{ count: ohCount }, { count: cbmCount }, { count: nuCount }] = await Promise.all([
    (supabase as any).from('overhead_items').select('id', { count: 'exact', head: true }).eq('product_id', productId),
    (supabase as any).from('cbm_estimates').select('product_id', { count: 'exact', head: true }).eq('product_id', productId),
    (supabase as any).from('non_unit_cogs').select('id', { count: 'exact', head: true }).eq('product_id', productId),
  ]);

  await Promise.all([
    (cogsCount ?? 0) === 0 ? (supabase as any).from('cogs_items').insert(defaultCogs) : Promise.resolve(),
    (ohCount ?? 0) === 0 ? (supabase as any).from('overhead_items').insert(defaultOverhead) : Promise.resolve(),
    (cbmCount ?? 0) === 0 ? (supabase as any).from('cbm_estimates').insert({ product_id: productId, mc_height_buffer_inch: mcHBuffer }) : Promise.resolve(),
    (nuCount ?? 0) === 0 ? (supabase as any).from('non_unit_cogs').insert({
      product_id: productId, name: 'Auto Transport', total_quantity: 1, cost_each_inr: 0, include: 'Yes', sort_order: 0,
    }) : Promise.resolve(),
  ]);
}

export async function seedProductDefaultsForMany(productIds: string[]) {
  // Fetch the global default once and pass it through, so even cold-cache
  // bulk inserts only do a single global_settings round-trip.
  const mcHBuffer = await getCachedMcHeightBuffer();
  await Promise.all(productIds.map(id => seedProductDefaults(id, { mcHBuffer })));
}
