// The list engine (computeProductPriceAndCost) loads its data once per call, shares the
// rate tables between calls, and still prices exactly like the Costing Workspace.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bundle } from './workspace-fixture';

const b = bundle();
const products = b.products.map(p => ({ ...p, customer_rfq_id: 'inq1', archived_at: null }));
const tables: Record<string, any[]> = {
  products,
  cogs_items: b.cogs,
  non_unit_cogs: b.nu,
  overhead_items: b.oh,
  shipping_items: b.shipItems.map((s, i) => ({ id: `s${i}`, ...s })),
  cbm_estimates: b.cbm,
  customer_rfqs: [b.inq],
  global_settings: [b.gs],
  shipping_types: b.shipTypes,
  labor_employees: b.employees,
  product_types: b.productTypes,
  chemical_prices: b.chemicalPrices,
  box_data: b.boxData,
  finishing_difficulty: b.difficulties,
  local_transport_locations: b.locations,
  raw_material_costs: b.rawMaterialCosts,
};
const reads: string[] = [];

function query(table: string) {
  let rows = [...(tables[table] ?? [])];
  const q: any = {
    select: () => q,
    in: (col: string, vals: string[]) => { rows = rows.filter(r => vals.includes(r[col])); return q; },
    eq: (col: string, v: any) => { rows = rows.filter(r => r[col] === v); return q; },
    is: (col: string, v: any) => { rows = rows.filter(r => (r[col] ?? null) === v); return q; },
    order: () => q,
    limit: () => q,
    range: (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  };
  return q;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (t: string) => { reads.push(t); return query(t); } },
}));
vi.mock('@/lib/fob-rates', () => ({ loadFobRates: () => Promise.resolve() }));

import { computeProductPriceAndCost } from '@/lib/product-pricing';
import { invalidateCostingReference } from '@/lib/costing-reference';
import { computeResults } from '@/lib/costing-workspace';

describe('computeProductPriceAndCost data loading', () => {
  beforeEach(() => { reads.length = 0; invalidateCostingReference(); });

  it('prices every product exactly like the Costing Workspace', async () => {
    const map = await computeProductPriceAndCost(['a', 'b', 'c']);
    const ws = computeResults({ ...b, products });
    for (const id of ['a', 'b', 'c']) {
      expect(map[id].unit_price_usd).toBeCloseTo(ws.get(id)!.summary.unit_price_usd, 9);
      expect(map[id].man_hours_per_unit).toBeCloseTo(ws.get(id)!.manHoursPerUnit, 9);
    }
  });

  it('prices one product on its whole inquiry shipment', async () => {
    const all = await computeProductPriceAndCost(['a', 'b', 'c']);
    const one = await computeProductPriceAndCost(['b']);
    expect(Object.keys(one)).toEqual(['b']);
    expect(one.b.unit_price_usd).toBeCloseTo(all.b.unit_price_usd, 9);
  });

  it('reads cost lines once per call and rate tables once across calls', async () => {
    await computeProductPriceAndCost(['a', 'b', 'c']);
    await computeProductPriceAndCost(['a']);
    const count = (t: string) => reads.filter(r => r === t).length;
    expect(count('cogs_items')).toBe(2);
    expect(count('labor_employees')).toBe(1);
    expect(count('global_settings')).toBe(1);
  });
});
