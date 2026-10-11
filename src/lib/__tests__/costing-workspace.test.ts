// Costing Workspace invariants: its buckets must add up to the engine's unit cost, and
// its bulk actions must land exactly where they say (bucket totals, price on target,
// cheapest quote) — all measured through the same engine the costing sheet uses.
import { describe, expect, it } from 'vitest';
import {
  buildRows, chooseCheapestQuotes, computeResults, markupToTarget, setBucketTotal, setQuote, type Bundle,
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
