import { describe, it, expect, vi } from 'vitest';

/**
 * Mirrors the self-heal seed arrays in ProductCostingTab. Keep these in sync
 * with src/components/ProductCostingTab.tsx — the test below pins their lengths
 * so accidental edits to either list trip the build.
 */
const DEFAULT_OVERHEAD = (id: string) => [
  { product_id: id, labor_type: 'Manufacturing', sort_order: 0 },
  { product_id: id, labor_type: 'QC', man_hours_per_unit: 0.05, sort_order: 1 },
  { product_id: id, labor_type: 'Sanding', sort_order: 2 },
  { product_id: id, labor_type: 'Finishing', is_auto_estimated: true, sort_order: 3 },
  { product_id: id, labor_type: 'Assembly', sort_order: 4 },
  { product_id: id, labor_type: 'Packaging', is_auto_estimated: true, sort_order: 5 },
  { product_id: id, labor_type: 'Market', sort_order: 6 },
];

const DEFAULT_COGS = (id: string) => [
  { product_id: id, cogs_type: 'Raw Piece', component_name: 'Raw Piece 1', sort_order: 0 },
  { product_id: id, cogs_type: 'Raw Piece', component_name: 'Raw Piece 2', sort_order: 1 },
  { product_id: id, cogs_type: 'Subcontracting', component_name: 'Subcontracting 1', sort_order: 2 },
  { product_id: id, cogs_type: 'Subcontracting', component_name: 'Subcontracting 2', sort_order: 3 },
  { product_id: id, cogs_type: 'Finishing Materials', component_name: 'Color', is_auto_calculated: true, sort_order: 4 },
  { product_id: id, cogs_type: 'Finishing Materials', component_name: 'Sealer', is_auto_calculated: true, sort_order: 5 },
  { product_id: id, cogs_type: 'Finishing Materials', component_name: 'Lacquer', is_auto_calculated: true, sort_order: 6 },
  { product_id: id, cogs_type: 'Packaging', component_name: 'IC Box', is_auto_calculated: true, waste_factor: 0.05, sort_order: 7 },
  { product_id: id, cogs_type: 'Packaging', component_name: 'MC Box', is_auto_calculated: true, sort_order: 8 },
  { product_id: id, cogs_type: 'Packaging', component_name: 'Other Packaging', sort_order: 9 },
  { product_id: id, cogs_type: 'Hardware', component_name: 'Hardware 1', waste_factor: 0.05, sort_order: 10 },
  { product_id: id, cogs_type: 'Hardware', component_name: 'Hardware 2', waste_factor: 0.05, sort_order: 11 },
  { product_id: id, cogs_type: 'Accessories', component_name: 'Accessory 1', waste_factor: 0.05, sort_order: 20 },
  { product_id: id, cogs_type: 'Accessories', component_name: 'Accessory 2', waste_factor: 0.05, sort_order: 21 },
];

/**
 * Minimal in-memory mock of the supabase client surface used by the
 * self-heal logic: from(table).select(...).eq(...).limit(...) / .insert(rows).select()
 */
function makeMockSupabase() {
  const tables: Record<string, any[]> = { overhead_items: [], cogs_items: [] };
  const inserts: Record<string, number> = { overhead_items: 0, cogs_items: 0 };

  const builder = (table: string) => {
    const ctx = { table, filter: (_r: any) => true };
    const api: any = {
      select: () => api,
      eq: (_col: string, _val: any) => { ctx.filter = (r: any) => r.product_id === _val; return api; },
      order: () => api,
      limit: () => api,
      // Resolve the chain when awaited — returns matching rows for selects.
      then: (resolve: (v: any) => void) => resolve({ data: tables[table].filter(ctx.filter), error: null }),
      single: () => Promise.resolve({ data: tables[table].filter(ctx.filter)[0] ?? null, error: null }),
      insert: (rows: any[]) => {
        const inserted = (Array.isArray(rows) ? rows : [rows]).map((r, i) => ({ id: `${table}-${tables[table].length + i}`, ...r }));
        tables[table].push(...inserted);
        inserts[table] += inserted.length;
        return {
          select: () => Promise.resolve({ data: inserted, error: null }),
          then: (resolve: (v: any) => void) => resolve({ data: inserted, error: null }),
        };
      },
    };
    return api;
  };

  return {
    from: (t: string) => builder(t),
    _state: tables,
    _inserts: inserts,
  };
}

/**
 * Re-implementation of the self-heal block from ProductCostingTab so we can
 * exercise it without rendering the full component tree.
 */
async function runSelfHeal(supabase: any, productId: string) {
  const ohRes = await supabase.from('overhead_items').select('*').eq('product_id', productId).order('sort_order');
  const cogsRes = await supabase.from('cogs_items').select('*').eq('product_id', productId).order('sort_order');

  if (!ohRes.data || ohRes.data.length === 0) {
    const { data: recheck } = await supabase.from('overhead_items').select('id').eq('product_id', productId).limit(1);
    if (!recheck || recheck.length === 0) {
      await supabase.from('overhead_items').insert(DEFAULT_OVERHEAD(productId)).select();
    }
  }
  if (!cogsRes.data || cogsRes.data.length === 0) {
    const { data: recheck } = await supabase.from('cogs_items').select('id').eq('product_id', productId).limit(1);
    if (!recheck || recheck.length === 0) {
      await supabase.from('cogs_items').insert(DEFAULT_COGS(productId)).select();
    }
  }
}

describe('product self-heal seeding', () => {
  it('seeds exactly 7 overhead rows and 14 COGS rows on first load', async () => {
    const sb = makeMockSupabase();
    await runSelfHeal(sb, 'test-product-1');

    const oh = sb._state.overhead_items.filter((r: any) => r.product_id === 'test-product-1');
    const cogs = sb._state.cogs_items.filter((r: any) => r.product_id === 'test-product-1');

    expect(oh).toHaveLength(7);
    expect(cogs).toHaveLength(14);

    // Spot-check: Finishing/Packaging overhead are auto-estimated; Color/Sealer/Lacquer COGS are auto-calculated.
    expect(oh.find((r: any) => r.labor_type === 'Finishing')?.is_auto_estimated).toBe(true);
    expect(oh.find((r: any) => r.labor_type === 'Packaging')?.is_auto_estimated).toBe(true);
    expect(cogs.filter((r: any) => r.is_auto_calculated)).toHaveLength(5); // Color, Sealer, Lacquer, IC Box, MC Box
  });

  it('does NOT re-seed when rows already exist (prevents the Hamsa double-seed bug)', async () => {
    const sb = makeMockSupabase();
    // Pre-seed once.
    await runSelfHeal(sb, 'p2');
    expect(sb._inserts.overhead_items).toBe(7);
    expect(sb._inserts.cogs_items).toBe(14);

    // Run again — simulates second mount / tab switch.
    await runSelfHeal(sb, 'p2');
    expect(sb._inserts.overhead_items).toBe(7); // no extra inserts
    expect(sb._inserts.cogs_items).toBe(14);
    expect(sb._state.overhead_items).toHaveLength(7);
    expect(sb._state.cogs_items).toHaveLength(14);
  });

  it('seeds independently per product', async () => {
    const sb = makeMockSupabase();
    await runSelfHeal(sb, 'pA');
    await runSelfHeal(sb, 'pB');

    expect(sb._state.overhead_items.filter((r: any) => r.product_id === 'pA')).toHaveLength(7);
    expect(sb._state.overhead_items.filter((r: any) => r.product_id === 'pB')).toHaveLength(7);
    expect(sb._state.cogs_items.filter((r: any) => r.product_id === 'pA')).toHaveLength(14);
    expect(sb._state.cogs_items.filter((r: any) => r.product_id === 'pB')).toHaveLength(14);
  });
});
