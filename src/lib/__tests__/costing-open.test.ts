import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory Supabase stand-in: eq/in filters are applied, inserts land in the table, updates are applied.
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let nextId = 1;

function query(table: string) {
  const filters: Array<[string, string, any]> = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: any = null;
  const match = (r: Row) => filters.every(([k, c, v]) => (k === 'eq' ? r[c] === v : (v as any[]).includes(r[c])));
  const run = () => {
    db[table] ??= [];
    if (op === 'insert') {
      const rows = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: `n${nextId++}`, ...r }));
      db[table].push(...rows);
      return { data: rows, error: null };
    }
    if (op === 'update') {
      db[table].filter(match).forEach(r => Object.assign(r, payload));
      return { data: null, error: null };
    }
    let rows = db[table].filter(match);
    if (table === 'product_type_default_chemicals') {
      rows = rows.map(r => ({ ...r, chemical_price: db.chemical_prices.find(c => c.id === r.chemical_price_id) }));
    }
    return { data: rows, error: null };
  };
  const b: any = {
    select: () => b, order: () => b, limit: () => b,
    eq: (c: string, v: any) => { filters.push(['eq', c, v]); return b; },
    in: (c: string, v: any[]) => { filters.push(['in', c, v]); return b; },
    insert: (p: any) => { op = 'insert'; payload = p; return b; },
    update: (p: any) => { op = 'update'; payload = p; return b; },
    maybeSingle: () => { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null }); },
    single: () => b.maybeSingle(),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (t: string) => query(t) } }));

import { ensureCostingRowsOnOpen } from '../costing-seed';

const names = () => db.cogs_items.map(c => c.component_name);

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.products = [{ id: 'p1', packaging_type: 'ic_only', source_location_id: 'loc1', product_type_id: 't1' }];
  db.cogs_items = [
    { id: 'c1', product_id: 'p1', cogs_type: 'Finishing Materials', component_name: 'Wax', is_auto_calculated: true, sort_order: 3 },
    { id: 'c2', product_id: 'p1', cogs_type: 'Raw Piece', component_name: 'Raw Piece', unit_cost_inr: 900, components_per_product: 0, is_auto_calculated: false },
    { id: 'c3', product_id: 'p1', cogs_type: 'Raw Piece', component_name: 'Spare', unit_cost_inr: 0, components_per_product: 0, is_auto_calculated: false },
  ];
  db.non_unit_cogs = [];
  db.cbm_estimates = [];
  db.shipping_items = [];
  db.global_settings = [{ mc_height_buffer_inch: 3, default_shipping_type: 'LCL' }];
  db.shipping_types = [{ id: 's-fcl', name: 'FCL 40' }, { id: 's-lcl', name: 'LCL' }];
  db.chemical_prices = [
    { id: 'ch-wax', name: 'Bees Wax', category: 'Wax', unit_type: 'KG', price_per_unit_inr: 400 },
    { id: 'ch-seal', name: 'NC Sealer', category: 'Sealer', unit_type: 'L', price_per_unit_inr: 250 },
  ];
  db.product_type_default_chemicals = [
    { product_type_id: 't1', chemical_price_id: 'ch-wax' },
    { product_type_id: 't1', chemical_price_id: 'ch-seal' },
  ];
});

describe('ensureCostingRowsOnOpen', () => {
  it('creates the rows the costing screen needs, without bringing back replaced lines', async () => {
    expect(await ensureCostingRowsOnOpen('p1')).toBe(true);

    expect(db.cbm_estimates).toEqual([expect.objectContaining({ product_id: 'p1', mc_height_buffer_inch: 3 })]);
    expect(db.non_unit_cogs).toEqual([expect.objectContaining({ name: 'Auto Transport', include: 'Yes' })]);
    expect(db.shipping_items).toEqual([expect.objectContaining({ shipping_type_id: 's-lcl' })]);

    // Wax already covers the Wax category; the sealer default is added. No generic Color/Lacquer.
    expect(names()).toContain('NC Sealer');
    expect(names()).not.toContain('Bees Wax');
    expect(names()).not.toContain('Color');
    expect(names()).not.toContain('Lacquer');
    expect(names()).toContain('Domestic Freight (External Sourcing)');
    // New lines sort after the existing ones.
    expect(db.cogs_items.find(c => c.component_name === 'NC Sealer')!.sort_order).toBe(4);

    // Priced manual raw piece goes to qty 1; an unpriced one is left alone.
    expect(db.cogs_items.find(c => c.id === 'c2')!.components_per_product).toBe(1);
    expect(db.cogs_items.find(c => c.id === 'c3')!.components_per_product).toBe(0);
  });

  it('is idempotent', async () => {
    await ensureCostingRowsOnOpen('p1');
    const counts = () => ['cogs_items', 'non_unit_cogs', 'cbm_estimates', 'shipping_items'].map(t => db[t].length);
    const before = counts();
    expect(await ensureCostingRowsOnOpen('p1')).toBe(false);
    expect(counts()).toEqual(before);
  });

  it('adds no freight line for an in-house product', async () => {
    db.products[0] = { id: 'p1', packaging_type: 'ic_mc', source_location_id: null, product_type_id: null };
    await ensureCostingRowsOnOpen('p1');
    expect(names()).not.toContain('Domestic Freight (External Sourcing)');
  });
});
