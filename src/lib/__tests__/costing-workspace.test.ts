// Costing Workspace invariants: its buckets must add up to the engine's unit cost, and
// its bulk actions must land exactly where they say (bucket totals, price on target,
// cheapest quote) — all measured through the same engine the costing sheet uses.
import { describe, expect, it } from 'vitest';
import {
  DOMESTIC_FREIGHT, buildRows, chooseCheapestQuotes, computeResults, markupToTarget, setBucketTotal, setDifficulty, setPackagingType,
  setProductType, setQuote, setShippingType, setSourceLocation, totals, type Bundle,
} from '@/lib/costing-workspace';

const PT = { id: 'pt1', name: 'Wood Side/End Table', pkg_ic_add_per_side_in: 0.5, finishing_mh_per_100ri: 0.5, finishing_color_per_100ri: 0.02 };

function product(id: string, extra: Record<string, any> = {}) {
  return {
    id, name: `Product ${id}`, sku: id.toUpperCase(), quantity: 50, width_inch: 18, depth_inch: 12, height_inch: 20, weight_kg: 4,
    product_type_id: 'pt1', finishing_difficulty: 'Medium', percent_wood: 1, markup_percent: 0.25, packaging_type: 'ic_mc',
    target_price_usd: null, ...extra,
  };
}

const cogs = (product_id: string, cogs_type: string, unit: number, extra: Record<string, any> = {}) => ({
  id: `${product_id}-${cogs_type}-${unit}-${Math.random()}`, product_id, cogs_type, component_name: cogs_type, include: 'Yes',
  components_per_product: 1, unit_cost_inr: unit, waste_factor: 0, is_auto_calculated: false, sort_order: 0, ...extra,
});

function bundle(): Bundle {
  return {
    inq: { id: 'inq1', rfq_number: 'CRFQ-TEST', markup_percent_override: null },
    customer: null,
    products: [product('a', { target_price_usd: 20 }), product('b', { target_price_usd: 60, cost_of_capital_enabled: true, cost_of_capital_monthly_rate: 1.5, cost_of_capital_months: 3 }), product('c')],
    cogs: [
      cogs('a', 'Raw Piece', 900, { waste_factor: 0.1, vendor_name: 'Rao' }),
      cogs('a', 'Raw Piece', 700, { include: 'No', sort_order: 1, vendor_name: 'XCraft' }),
      cogs('a', 'Handles + Knobs', 45, { components_per_product: 2 }),
      cogs('a', 'Packaging', 0, { component_name: 'IC Box', is_auto_calculated: true }),
      cogs('a', 'Packaging', 0, { component_name: 'MC Box', is_auto_calculated: true }),
      cogs('b', 'Raw Piece', 2400),
      cogs('b', 'Subcontracting', 300, { waste_factor: 0.05 }),
      cogs('c', 'Raw Piece', 150),
      cogs('c', 'Finishing Materials', 0, { component_name: 'Color', is_auto_calculated: true }),
    ],
    nu: [{ id: 'nu1', product_id: 'a', name: 'Auto Transport', include: 'Yes', total_quantity: 0, cost_each_inr: 0, manual_override: false }],
    oh: [
      { id: 'oh1', product_id: 'a', labor_type: 'Manufacturing', include: 'Yes', man_hours_per_unit: 0.5, is_auto_estimated: false },
      { id: 'oh2', product_id: 'b', labor_type: 'Finishing', include: 'Yes', man_hours_per_unit: 0.3, is_auto_estimated: true },
    ],
    shipItems: [{ product_id: 'a', shipping_type_id: 's1' }, { product_id: 'b', shipping_type_id: 's1' }],
    cbm: [],
    shipTypes: [{ id: 's1', name: 'FOB Jodhpur', per_unit: 'CBM', cost_inr: 500 }],
    employees: [
      { hourly_rate_inr: 80, designations: ['Manufacturing'] },
      { hourly_rate_inr: 100, designations: ['Finishing'] },
    ],
    gs: { exchange_rate: 95, indirect_overhead_per_mh: 40 },
    productTypes: [PT],
    chemicalPrices: [{ id: 'ch1', name: 'Color', category: 'Color', price_per_unit_inr: 300, unit_type: 'L' }],
    boxData: [{ box_type: '7 ply', cost_per_sq_in: 0.05 }],
    difficulties: [{ name: 'Medium', adjustment_factor: 1 }],
    locations: [],
    rawMaterialCosts: [],
    hardwarePrices: [],
  };
}

const rowsOf = (b: Bundle) => buildRows(b, computeResults(b));
const byId = (b: Bundle, id: string) => rowsOf(b).find(r => r.p.id === id)!;

describe('costing workspace', () => {
  it('buckets plus cost of capital add up to the engine unit cost', () => {
    for (const r of rowsOf(bundle())) {
      const sum = Object.values(r.buckets).reduce((a, v) => a + v, 0) + r.r.capitalPerUnitInr;
      expect(sum).toBeCloseTo(r.costInr, 6);
    }
  });

  it('contribution adds back exactly the indirect overhead (with its cost of capital)', () => {
    const rows = rowsOf(bundle());
    const c = rows.find(r => r.p.id === 'c')!; // no man-hours, like a bought-in item
    expect(c.indirectInr).toBe(0);
    expect(c.contribution).toBeCloseTo(c.margin, 12);
    for (const id of ['a', 'b']) {
      const r = rows.find(x => x.p.id === id)!;
      expect(r.r.indirectOhPerUnit).toBeGreaterThan(0);
      expect(r.indirectInr).toBeCloseTo(r.r.indirectOhPerUnit * (1 + r.r.capitalFactor), 9);
      expect((r.contribution - r.margin) * r.priceInr).toBeCloseTo(r.indirectInr, 6);
    }
    const t = totals(rows);
    const fob = rows.reduce((a, r) => a + r.priceUsd * r.qty, 0);
    const profit = rows.reduce((a, r) => a + (r.priceUsd - r.costUsd) * r.qty, 0);
    const indirect = rows.reduce((a, r) => a + r.indirectUsd * r.qty, 0);
    expect(t.contribution).toBeCloseTo((profit + indirect) / fob, 12);
    expect(t.contribution).toBeGreaterThan(t.margin);
  });

  it('counts waste the way the engine does (qty ÷ (1 − waste))', () => {
    const a = byId(bundle(), 'a');
    expect(a.editBuckets.raw_piece).toBeCloseTo(900 / 0.9, 6);
    expect(a.editBuckets.hw_handles_knobs).toBeCloseTo(90, 6);
  });

  it('setting a bucket total lands exactly on that total', () => {
    const b0 = bundle();
    const m = setBucketTotal(b0, ['a', 'b', 'c'], 'raw_piece', 1234);
    for (const r of rowsOf(m.next)) expect(r.editBuckets.raw_piece).toBeCloseTo(1234, 1);
    const m2 = setBucketTotal(b0, ['c'], 'subcontract', 200);
    expect(byId(m2.next, 'c').editBuckets.subcontract).toBeCloseTo(200, 6);
  });

  it('price to target puts each targeted SKU on its target and leaves the rest alone', () => {
    const b0 = bundle();
    const m = markupToTarget(b0, rowsOf(b0), ['a', 'b', 'c']);
    expect(byId(m.next, 'a').priceUsd).toBeCloseTo(20, 2);
    expect(byId(m.next, 'b').priceUsd).toBeCloseTo(60, 2);
    expect(byId(m.next, 'c').p.markup_percent).toBe(0.25);
  });

  it('quotes: one winner per SKU, cheapest wins on request', () => {
    const b0 = bundle();
    const a0 = byId(b0, 'a');
    expect(a0.quotes.map(q => q.winner)).toEqual([true, false]);
    const m = chooseCheapestQuotes(b0, ['a']);
    const a1 = byId(m.next, 'a');
    expect(a1.quotes.map(q => q.winner)).toEqual([false, true]);
    expect(a1.rawVendor).toBe('XCraft');
    expect(a1.costInr).toBeLessThan(a0.costInr);
    // A new quote on a SKU that already has a winner does not displace it.
    const m2 = setQuote(m.next, 'a', 2, { vendor_name: 'SK', unit_cost_inr: 10 });
    expect(byId(m2.next, 'a').quotes.filter(q => q.winner)).toHaveLength(1);
  });
});

describe('product setup side effects (shared by the workspace and the product costing sheet)', () => {
  const lines = (b: Bundle, pid: string) => b.cogs.filter(c => c.product_id === pid);

  it('packaging type switches packaging lines, adds wrap lines once, and drops packaging labor for none', () => {
    let b = bundle();
    b = { ...b, oh: [...b.oh, { id: 'ohp', product_id: 'a', labor_type: 'Packaging', include: 'Yes', man_hours_per_unit: 0.2, is_auto_estimated: true }] };
    const wrap = setPackagingType(b, ['a'], 'corrugate_bubble').next;
    expect(wrap.products.find(p => p.id === 'a')!.packaging_type).toBe('corrugate_bubble');
    expect(lines(wrap, 'a').filter(l => ['Corrugate Wrap', 'Bubble Wrap'].includes(l.component_name)).map(l => l.include)).toEqual(['Yes', 'Yes']);
    expect(lines(wrap, 'a').find(l => l.component_name === 'IC Box')!.include).toBe('No');
    const again = setPackagingType(wrap, ['a'], 'corrugate_bubble').next;
    expect(lines(again, 'a').filter(l => l.component_name === 'Bubble Wrap')).toHaveLength(1);
    const none = setPackagingType(wrap, ['a'], 'no_packaging').next;
    expect(lines(none, 'a').filter(l => l.cogs_type === 'Packaging').every(l => l.include === 'No')).toBe(true);
    expect(none.oh.find(o => o.id === 'ohp')).toMatchObject({ include: 'No', man_hours_per_unit: 0 });
    expect(none.cbm.find(c => c.product_id === 'a')!.include_mc).toBe(false);
  });

  it('switching to an Outsourced type keeps one purchased-cost line and turns the rest off', () => {
    let b = bundle();
    b = { ...b, productTypes: [...b.productTypes, { id: 'out', name: 'Outsourced' }] };
    const m = setProductType(b, ['a'], 'out').next;
    const mine = lines(m, 'a');
    const row = mine.find(l => l.component_name === 'Outsourced Product')!;
    expect(row).toMatchObject({ include: 'Yes', components_per_product: 1 });
    expect(mine.filter(l => l !== row).every(l => l.include === 'No')).toBe(true);
    expect(m.nu.filter(n => n.product_id === 'a').every(n => n.include === 'No')).toBe(true);
    expect(m.oh.filter(o => o.product_id === 'a').every(o => o.include === 'No')).toBe(true);
    // Choosing it again doesn't add a second line.
    expect(lines(setProductType(m, ['a'], 'out').next, 'a').filter(l => l.component_name === 'Outsourced Product')).toHaveLength(1);
  });

  it('Wax finish swaps the chemical lines and back', () => {
    let b = bundle();
    b = { ...b, chemicalPrices: [...b.chemicalPrices, { id: 'wx', name: 'Bees Wax', category: 'Wax', price_per_unit_inr: 1.2, unit_type: 'g' }] };
    const wax = setDifficulty(b, ['c'], 'Wax').next;
    expect(lines(wax, 'c').find(l => l.component_name === 'Color')!.include).toBe('No');
    expect(lines(wax, 'c').find(l => l.chemical_price_id === 'wx')).toMatchObject({ include: 'Yes', is_auto_calculated: true });
    const back = setDifficulty(wax, ['c'], 'Medium').next;
    expect(lines(back, 'c').find(l => l.component_name === 'Color')!.include).toBe('Yes');
    expect(lines(back, 'c').find(l => l.chemical_price_id === 'wx')!.include).toBe('No');
    // Finishing labor goes back to the estimate.
    expect(setDifficulty(bundle(), ['b'], 'Hard').next.oh.find(o => o.id === 'oh2')!.is_auto_estimated).toBe(true);
  });

  it('an outside source adds domestic freight that the engine prices; in-house removes it', () => {
    let b = bundle();
    b = { ...b, locations: [{ id: 'loc', name: 'Saharanpur', cost_per_cbm_inr: 900 }] };
    const out = setSourceLocation(b, ['c'], 'loc').next;
    const freight = lines(out, 'c').filter(l => l.component_name === DOMESTIC_FREIGHT);
    expect(freight).toHaveLength(1);
    const line = (computeResults(out).get('c')!.resolvedCogsRows as any[]).find(l => l.component_name === DOMESTIC_FREIGHT);
    expect(line.unit_cost_inr).toBe(900);
    expect(line.components_per_product).toBeGreaterThan(0);
    expect(lines(setSourceLocation(out, ['c'], null).next, 'c').some(l => l.component_name === DOMESTIC_FREIGHT)).toBe(false);
  });

  it('shipping type updates or creates the product shipping row', () => {
    const b = { ...bundle(), shipTypes: [...bundle().shipTypes, { id: 's2', name: 'Air', per_unit: 'KG', cost_inr: 200 }] };
    const m = setShippingType(b, ['a', 'c'], 's2').next;
    expect(m.shipItems.filter(s => ['a', 'c'].includes(s.product_id)).map(s => s.shipping_type_id)).toEqual(['s2', 's2']);
    expect(byId(m, 'c').shippingName).toBe('Air');
  });
});
