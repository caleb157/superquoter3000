// Costing Workspace invariants: its buckets must add up to the engine's unit cost, and
// its bulk actions must land exactly where they say (bucket totals, price on target,
// cheapest quote) — all measured through the same engine the costing sheet uses.
import { describe, expect, it } from 'vitest';
import {
  DOMESTIC_FREIGHT, buildRows, chooseCheapestQuotes, computeResults, markupToTarget, setBucketTotal, setDifficulty, setPackagingType,
  setProductType, setQuote, setShippingType, setSourceLocation, targetLineEach, totals, type Bundle,
  patchCogsLine,
} from '@/lib/costing-workspace';

import { bundle } from './workspace-fixture';

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

  it('"target this line" lands the price on the target, with and without cost of capital', () => {
    for (const id of ['a', 'b']) {
      const b0 = bundle();
      const row = byId(b0, id);
      const raw = b0.cogs.find(c => c.product_id === id && c.cogs_type === 'Raw Piece' && c.include === 'Yes')!;
      const each = targetLineEach(row, raw)!;
      expect(each).toBeGreaterThan(0);
      const after = byId(patchCogsLine(b0, raw.id, { unit_cost_inr: each }).next, id);
      expect(after.priceUsd).toBeCloseTo(row.targetUsd!, 6);
    }
  });
});
