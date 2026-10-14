import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- In-memory Supabase stand-in: each table is an array of rows; filters are recorded and
// applied for eq/in so the code under test sees only the rows it asked for. Writes are captured.
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const writes: Array<{ table: string; op: 'insert' | 'update'; payload: any; filters: Array<[string, string, any]> }> = [];

function query(table: string) {
  const filters: Array<[string, string, any]> = [];
  let op: 'select' | 'insert' | 'update' = 'select';
  let payload: any = null;
  const rows = () => (db[table] ?? []).filter(r => filters.every(([kind, col, v]) =>
    kind === 'eq' ? r[col] === v : kind === 'in' ? (v as any[]).includes(r[col]) : true));
  const run = () => {
    if (op === 'insert') {
      writes.push({ table, op, payload, filters });
      return { data: [{ id: 'snap-1', share_token: payload.share_token, quote_number: payload.quote_number }], error: null };
    }
    if (op === 'update') {
      writes.push({ table, op, payload, filters });
      return { data: null, error: null };
    }
    return { data: rows(), error: null };
  };
  const b: any = {
    select: () => b,
    order: () => b,
    limit: () => b,
    not: () => b,
    eq: (col: string, v: any) => { filters.push(['eq', col, v]); return b; },
    in: (col: string, v: any[]) => { filters.push(['in', col, v]); return b; },
    insert: (p: any) => { op = 'insert'; payload = p; return b; },
    update: (p: any) => { op = 'update'; payload = p; return b; },
    maybeSingle: () => { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error }); },
    single: () => b.maybeSingle(),
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (t: string) => query(t) } }));

const enginePrices: Record<string, any> = {};
vi.mock('@/lib/product-pricing', () => ({
  computeProductUnitPrices: async (ids: string[]) =>
    Object.fromEntries(ids.filter(id => enginePrices[id]).map(id => [id, enginePrices[id]])),
}));

import { createQuoteSnapshot, updateQuoteLineItems } from './quote-creation';
import { priceProductLines, priceAssemblyLines, referencePriceFor } from './quote-rough';
import { loadCurrencyMap } from './currency';

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  for (const k of Object.keys(enginePrices)) delete enginePrices[k];
  writes.length = 0;
  db.products = [
    { id: 'p1', name: 'Oak Table', sku: 'OT-1', quantity: 50, target_price_usd: 100, markup_percent: 0.2,
      width_inch: 40, depth_inch: 20, height_inch: 30, weight_kg: 15, moq: 20, hard_moq: false, quote_notes: 'Oiled' },
    { id: 'p2', name: 'Iron Stool', sku: 'IS-2', quantity: 10, target_price_usd: 30, markup_percent: 0,
      width_inch: 12, depth_inch: 12, height_inch: 18, weight_kg: 4, moq: null, hard_moq: null, quote_notes: null },
  ];
  db.cbm_estimates = [
    { product_id: 'p1', final_unit_cbm: 0.5, mc_width: 42, mc_depth: 22, mc_height: 32, products_per_mc: 1, products_per_ic: 1 },
  ];
  db.customer_rfqs = [
    { id: 'inq-1', rfq_number: 'CRFQ-2026-001', title: 'Spring line', customer_id: 'c1',
      exchange_rate_override: null, quoting_currency_rate_override: null, markup_percent_override: null,
      customers: { id: 'c1', name: 'Ana', company: 'Acme', email: 'ana@acme.test', logo_url: null } },
  ];
  db.company_entities = [{ id: 'e1', name: 'Parable Ventures', default_terms: null }];
  db.global_settings = [{ exchange_rate: 85 }];
  db.currencies = [
    { code: 'USD', name: 'US Dollar', import_rate: 84, export_rate: 86, units_per_inr_base: 1 },
    { code: 'GBP', name: 'Pound', import_rate: 105, export_rate: 108, units_per_inr_base: 1 },
  ];
  db.product_assemblies = [
    { id: 'a1', name: 'Bar Set', sku: 'BS-1', photo_url: null, moq: null, hard_moq: null, markup_percent: 0.3,
      assembly_components: [
        { id: 'ac1', product_id: 'p2', quantity_per_assembly: 4, sort_order: 1 },
        { id: 'ac2', product_id: 'p1', quantity_per_assembly: 1, sort_order: 0 },
      ] },
  ];
}

const inserted = () => writes.find(w => w.table === 'quote_snapshots' && w.op === 'insert')!.payload;

describe('createQuoteSnapshot', () => {
  beforeEach(async () => { seed(); await loadCurrencyMap(true); });

  it('refuses a quote with no products or no entity', async () => {
    expect(await createQuoteSnapshot({ inquiryId: 'inq-1', selectedProducts: [], entityId: 'e1', validUntil: '2026-11-01' }))
      .toEqual({ error: 'No products selected' });
    expect(await createQuoteSnapshot({ inquiryId: 'inq-1', selectedProducts: [{ id: 'p1', name: 'Oak Table' }], entityId: '', validUntil: '2026-11-01' }))
      .toEqual({ error: 'Company entity is required' });
    expect(writes).toHaveLength(0);
  });

  it('freezes lines, totals, customer, inquiry and terms into a draft', async () => {
    const res = await createQuoteSnapshot({
      inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01', currency: 'USD', incoterm: ' FOB ',
      selectedProducts: [
        { id: 'p1', name: 'Oak Table', quantity: 50, unit_price_override: 150 },
        { id: 'p2', name: 'Iron Stool', quantity: 10, unit_price_override: 40, display_name: 'Stool, iron' },
      ],
    });
    expect(res.error).toBeUndefined();
    expect(res.id).toBe('snap-1');
    expect(res.quote_number).toMatch(/^Q-\d+$/);

    const q = inserted();
    expect(q.status).toBe('draft');
    expect(q.customer_rfq_id).toBe('inq-1');
    expect(q.currency).toBe('USD');
    expect(q.currency_rate_inr_per_unit).toBe(84); // currencies table import rate wins over global FX
    expect(q.incoterm).toBe('FOB');
    expect(q.valid_until).toBe('2026-11-01');
    expect(q.customer).toEqual({ id: 'c1', name: 'Ana', company: 'Acme', email: 'ana@acme.test', logo_url: null });
    expect(q.inquiry).toEqual({ id: 'inq-1', rfq_number: 'CRFQ-2026-001', title: 'Spring line' });
    expect(Array.isArray(q.terms) && q.terms.length).toBeGreaterThan(0);

    const [oak, stool] = q.products;
    expect(oak).toMatchObject({ product_id: 'p1', name: 'Oak Table', sku: 'OT-1', quote_notes: 'Oiled', quantity: 50,
      unit_price_usd: 150, total: 7500, unit_cbm: 0.5, moq: 20,
      carton_width_inch: 42, units_per_carton: 1 });
    expect(oak.box_size).toContain('master carton');
    // No CBM row: falls back to the bare piece volume, and the carton is the piece itself.
    expect(stool.name).toBe('Stool, iron');
    expect(stool.unit_cbm).toBeCloseTo((12 * 12 * 18) / 61020, 6);
    expect(stool.units_per_carton).toBe(1);

    expect(q.totals).toMatchObject({ sku_count: 2, total_qty: 60, grand_total: 7900, freight: null });
    expect(q.totals.total_cbm).toBeCloseTo(50 * 0.5 + 10 * (12 * 12 * 18) / 61020, 6);
  });

  it('marks the quoted products as quoted', async () => {
    await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01',
      selectedProducts: [{ id: 'p1', name: 'Oak Table', unit_price_override: 1 }] });
    const upd = writes.find(w => w.table === 'products' && w.op === 'update')!;
    expect(upd.payload).toEqual({ quote_stage: 'quoted' });
    expect(upd.filters).toContainEqual(['in', 'id', ['p1']]);
  });

  it('prices from the target price plus markup when no override is given, honouring the inquiry markup', async () => {
    await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01',
      selectedProducts: [{ id: 'p1', name: 'Oak Table' }] });
    expect(inserted().products[0].unit_price_usd).toBeCloseTo(120, 6); // 100 × (1 + 0.2)
    expect(inserted().products[0].quantity).toBe(50); // product quantity when the line has none

    seed(); db.customer_rfqs[0].markup_percent_override = 0.5;
    await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01',
      selectedProducts: [{ id: 'p1', name: 'Oak Table' }] });
    expect(inserted().products[0].unit_price_usd).toBeCloseTo(150, 6);
  });

  it('freezes the rate for INR, other currencies and the inquiry override', async () => {
    await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01', currency: 'INR',
      selectedProducts: [{ id: 'p1', name: 'Oak Table' }] });
    expect(inserted().currency_rate_inr_per_unit).toBe(1);
    expect(inserted().products[0].unit_price_usd).toBeCloseTo(120 * 85, 6); // target USD → INR at global FX

    seed();
    await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01', currency: 'GBP',
      selectedProducts: [{ id: 'p1', name: 'Oak Table' }] });
    expect(inserted().currency_rate_inr_per_unit).toBe(105);
    expect(inserted().products[0].unit_price_usd).toBeCloseTo((120 * 85) / 105, 6);

    seed(); db.customer_rfqs[0].quoting_currency_rate_override = 110;
    await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01', currency: 'GBP',
      selectedProducts: [{ id: 'p1', name: 'Oak Table', unit_price_override: 99 }] });
    expect(inserted().currency_rate_inr_per_unit).toBe(110);
  });

  it('refuses a currency with no import rate', async () => {
    const res = await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01', currency: 'EUR',
      selectedProducts: [{ id: 'p1', name: 'Oak Table' }] });
    expect(res.error).toMatch(/No import rate configured for EUR/);
    expect(writes.filter(w => w.table === 'quote_snapshots')).toHaveLength(0);
  });

  it('explodes an assembly line into its components in sort order', async () => {
    await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01',
      selectedProducts: [{ id: 'a1', assembly_id: 'a1', name: 'Bar Set', quantity: 5, unit_price_override: 400 }] });
    const line = inserted().products[0];
    expect(line).toMatchObject({ product_id: null, assembly_id: 'a1', is_assembly: true, name: 'Bar Set', sku: 'BS-1',
      quantity: 5, unit_price_usd: 400, total: 2000 });
    expect(line.components.map((c: any) => c.product_id)).toEqual(['p1', 'p2']);
    expect(line.unit_cbm).toBeCloseTo(0.5 + 4 * (12 * 12 * 18) / 61020, 6);
    expect(line.weight_kg).toBe(15 + 4 * 4);
    // Assembly lines don't move component products to "quoted".
    expect(writes.find(w => w.table === 'products')).toBeUndefined();
  });

  it('adds a sea freight estimate when a rate is given', async () => {
    await createQuoteSnapshot({ inquiryId: 'inq-1', entityId: 'e1', validUntil: '2026-11-01',
      freight: { mode: 'sea', rate: 100 },
      selectedProducts: [{ id: 'p1', name: 'Oak Table', quantity: 50, unit_price_override: 150 }] });
    expect(inserted().totals.freight).toMatchObject({ mode: 'sea', rate: 100, total_cbm: 25, amount: 2500 });
  });
});

describe('updateQuoteLineItems', () => {
  beforeEach(() => { seed(); db.quote_snapshots = [{ id: 'snap-1', totals: { freight: { total: 12 }, discount_percent: 5 } }]; });

  it('recomputes totals, applies a discount and keeps the existing freight', async () => {
    const res = await updateQuoteLineItems('snap-1', [
      { name: 'Oak Table', quantity: 10, unit_price_usd: 100, unit_cbm: 0.5 },
      { name: 'Iron Stool', quantity: 4, unit_price_usd: 25 },
    ], { discount_percent: 10, notes: '  Delivered in two lots ' });
    expect(res.error).toBeUndefined();
    expect(res.totals).toMatchObject({ sku_count: 2, total_qty: 14, subtotal: 1100, discount_percent: 10,
      discount_amount: 110, grand_total: 990, total_cbm: 5, freight: { total: 12 } });
    const upd = writes.find(w => w.table === 'quote_snapshots' && w.op === 'update')!;
    expect(upd.payload.notes).toBe('Delivered in two lots');
    expect(upd.filters).toContainEqual(['eq', 'id', 'snap-1']);
  });

  it('keeps the previous discount when none is supplied and caps it at 100%', async () => {
    const kept = await updateQuoteLineItems('snap-1', [{ name: 'A', quantity: 1, unit_price_usd: 200 }]);
    expect(kept.totals).toMatchObject({ discount_percent: 5, grand_total: 190 });
    const capped = await updateQuoteLineItems('snap-1', [{ name: 'A', quantity: 1, unit_price_usd: 200 }], { discount_percent: 150 });
    expect(capped.totals).toMatchObject({ discount_percent: 100, grand_total: 0 });
  });
});

describe('rough quote pricing', () => {
  beforeEach(async () => { seed(); await loadCurrencyMap(true); });

  it('prefers a supplied USD reference, else the engine price, else zero', () => {
    const prices: any = { p1: { unit_price_usd: 110, unit_price_inr: 9350, unit_cost_usd: 90, exchange_rate: 85 } };
    expect(referencePriceFor({ id: 'p1', name: 'x', reference_price_usd: 120 }, prices, 'USD')).toBe(120);
    expect(referencePriceFor({ id: 'p1', name: 'x', reference_price_usd: 120 }, prices, 'INR')).toBe(120 * 85);
    expect(referencePriceFor({ id: 'p1', name: 'x' }, prices, 'USD')).toBe(110);
    expect(referencePriceFor({ id: 'p1', name: 'x' }, prices, 'INR')).toBe(9350);
    expect(referencePriceFor({ id: 'p1', name: 'x' }, prices, 'GBP')).toBeCloseTo(9350 / 105, 6);
    expect(referencePriceFor({ id: 'zz', name: 'x' }, prices, 'USD')).toBe(0);
  });

  it('prices product lines from the engine and sorts them by name, numbers in order', async () => {
    enginePrices.p1 = { unit_price_usd: 123.456, unit_price_inr: 10000, unit_cost_usd: 100, exchange_rate: 81 };
    const lines = await priceProductLines([
      { id: 'p10', name: 'Chair 10', quantity: 3 },
      { id: 'p1', name: 'Chair 2', quantity: 5 },
      { id: 'p3', name: 'chair 1', quantity: null, target_price_usd: 50 },
    ], 'USD');
    expect(lines.map(l => l.name)).toEqual(['chair 1', 'Chair 2', 'Chair 10']);
    expect(lines.map(l => l.unit_price_override)).toEqual([50, 123.46, 0]);
    expect(lines.map(l => l.quantity)).toEqual([0, 5, 3]);
  });

  it('prices a kit as the sum of component costs plus the kit markup', async () => {
    enginePrices.p1 = { unit_price_usd: 0, unit_price_inr: 0, unit_cost_usd: 10, exchange_rate: 80 };
    enginePrices.p2 = { unit_price_usd: 0, unit_price_inr: 0, unit_cost_usd: 2, exchange_rate: 80 };
    const [kit] = await priceAssemblyLines([{ id: 'a1', name: 'Bar Set', quantity: 5, markup_percent: 0.25,
      components: [{ product_id: 'p1', quantity_per_assembly: 1 }, { product_id: 'p2', quantity_per_assembly: 4 }] }], 'USD');
    // Cost (10 + 4 × 2) USD = 1,440 INR; × 1.25 = 1,800 INR; ÷ 80 = 22.50 USD.
    expect(kit).toMatchObject({ id: 'a1', assembly_id: 'a1', quantity: 5, unit_price_override: 22.5 });
  });
});
