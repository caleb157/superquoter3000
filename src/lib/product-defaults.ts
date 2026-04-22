// Shared helper to seed a newly-created product with default costing rows
// (COGS items, overhead items, CBM estimate, non-unit COGS).
// Mirrors the defaults used by UploadParseDialog so that products created via
// QuickAdd / other paths get the same starting structure.
import { supabase } from '@/integrations/supabase/client';

export async function seedProductDefaults(productId: string) {
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
    { product_id: productId, labor_type: 'Sanding', sort_order: 2 },
    { product_id: productId, labor_type: 'Finishing', is_auto_estimated: true, sort_order: 3 },
    { product_id: productId, labor_type: 'Assembly', sort_order: 4 },
    { product_id: productId, labor_type: 'Packaging', is_auto_estimated: true, sort_order: 5 },
    { product_id: productId, labor_type: 'Market', sort_order: 6 },
  ];

  await Promise.all([
    (supabase as any).from('cogs_items').insert(defaultCogs),
    (supabase as any).from('overhead_items').insert(defaultOverhead),
    (supabase as any).from('cbm_estimates').insert({ product_id: productId }),
    (supabase as any).from('non_unit_cogs').insert({
      product_id: productId, name: 'Auto Transport', total_quantity: 1, cost_each_inr: 0, include: 'Yes', sort_order: 0,
    }),
  ]);
}

export async function seedProductDefaultsForMany(productIds: string[]) {
  await Promise.all(productIds.map(seedProductDefaults));
}
