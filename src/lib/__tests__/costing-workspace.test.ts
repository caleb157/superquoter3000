// Costing Workspace invariants: its buckets must add up to the engine's unit cost, and
// its bulk actions must land exactly where they say (bucket totals, price on target,
// cheapest quote) — all measured through the same engine the costing sheet uses.
import { describe, expect, it } from 'vitest';
import {
  DOMESTIC_FREIGHT, buildRows, chooseCheapestQuotes, computeResults, markupToTarget, setBucketTotal, setDifficulty, setPackagingType,
  setProductType, setQuote, setShippingType, setSourceLocation, targetLineEach, totals, type Bundle,
  chain, copyCosting, pasteCogsLines, patchCogsLine, patchProductsSame, restoreRows, stepTotals, targetFromPrice, lineValue, addPriceListLines, priceListItems,
} from '@/lib/costing-workspace';
import { readTarget, targetPatch } from '@/lib/quote-currency';

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

  it('the four steps (COGS, labour, shipping, capital) add up to the unit cost', () => {
    for (const r of rowsOf(bundle())) {
      const s = stepTotals(r);
      expect(s.cogs + s.labour + s.shipping + s.capital).toBeCloseTo(r.costInr, 6);
      expect(s.labour).toBe(r.buckets.labor);
      expect(s.shipping).toBe(r.buckets.shipping);
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
    const fob = rows.reduce((a, r) => a + r.price * r.qty, 0);
    const profit = rows.reduce((a, r) => a + (r.price - r.cost) * r.qty, 0);
    const indirect = rows.reduce((a, r) => a + r.indirect * r.qty, 0);
    expect(t.contribution).toBeCloseTo((profit + indirect) / fob, 12);
    expect(t.contribution).toBeGreaterThan(t.margin);
  });

  it('editable buckets show the price as typed; the cost buckets add waste (qty ÷ (1 − waste))', () => {
    const a = byId(bundle(), 'a');
    expect(a.editBuckets.raw_piece).toBeCloseTo(900, 6);
    expect(a.buckets.raw_piece).toBeCloseTo(900 / 0.9, 6);
    expect(a.editBuckets.hw_handles_knobs).toBeCloseTo(90, 6);
  });

  it('a typed raw price is stored as typed and waste is added once in costing', () => {
    const m = setBucketTotal(bundle(), ['a'], 'raw_piece', 2300);
    const line = m.next.cogs.find(c => c.product_id === 'a' && c.cogs_type === 'Raw Piece' && c.include === 'Yes');
    expect(line.unit_cost_inr).toBe(2300);
    const a = byId(m.next, 'a');
    expect(a.quotes[0].price).toBe(2300);
    expect(a.editBuckets.raw_piece).toBeCloseTo(2300, 6);
    expect(a.buckets.raw_piece).toBeCloseTo(2300 / 0.9, 6);
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
    expect(byId(m.next, 'a').price).toBeCloseTo(20, 2);
    expect(byId(m.next, 'b').price).toBeCloseTo(60, 2);
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

  it('packaging type switches packaging lines and drops packaging labor for none', () => {
    let b = bundle();
    b = { ...b, oh: [...b.oh, { id: 'ohp', product_id: 'a', labor_type: 'Packaging', include: 'Yes', man_hours_per_unit: 0.2, is_auto_estimated: true }] };
    const icOnly = setPackagingType(b, ['a'], 'ic_only').next;
    expect(icOnly.products.find(p => p.id === 'a')!.packaging_type).toBe('ic_only');
    expect(lines(icOnly, 'a').find(l => l.component_name === 'IC Box')!.include).not.toBe('No');
    expect(lines(icOnly, 'a').find(l => l.component_name === 'MC Box')!.include).toBe('No');
    expect(lines(icOnly, 'a')).toHaveLength(lines(b, 'a').length); // switching adds no lines
    const none = setPackagingType(icOnly, ['a'], 'no_packaging').next;
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

  it('domestic freight counts under Shipping, not Subcontract', () => {
    let b = bundle();
    b = { ...b, locations: [{ id: 'loc', name: 'Saharanpur', cost_per_cbm_inr: 900 }] };
    const out = setSourceLocation(b, ['c'], 'loc').next;
    const results = computeResults(out);
    const before = buildRows(b, computeResults(b)).find(r => r.p.id === 'c')!;
    const row = buildRows(out, results).find(r => r.p.id === 'c')!;
    const freight = lineValue((results.get('c')!.resolvedCogsRows as any[]).find(l => l.component_name === DOMESTIC_FREIGHT));
    expect(freight).toBeGreaterThan(0);
    expect(row.buckets.subcontract).toBeCloseTo(before.buckets.subcontract, 6);
    expect(row.editBuckets.subcontract).toBeCloseTo(before.editBuckets.subcontract, 6);
    expect(row.buckets.outsourced).toBeCloseTo(before.buckets.outsourced, 6);
    expect(row.buckets.shipping).toBeCloseTo(results.get('c')!.shippingPerUnit + freight, 6);
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
      expect(after.price).toBeCloseTo(row.target!, 6);
    }
  });

  describe('rupee customers (Quoting currency INR)', () => {
    const inrBundle = (products?: any[]): Bundle => {
      const b = bundle();
      return { ...b, inq: { ...b.inq, quoting_currency: 'INR' }, products: products ?? b.products };
    };

    it('prices, costs and totals are the engine rupees, with no exchange rate', () => {
      const rows = rowsOf(inrBundle());
      for (const r of rows) {
        expect(r.cur).toBe('INR');
        expect(r.price).toBe(r.priceInr);
        expect(r.cost).toBe(r.costInr);
        expect(r.indirect).toBe(r.indirectInr);
      }
      const t = totals(rows, 'INR');
      expect(t.cur).toBe('INR');
      expect(t.fob).toBeCloseTo(rows.reduce((a, r) => a + r.priceInr * r.qty, 0), 6);
      // Margins don't depend on the currency.
      const usd = totals(rowsOf(bundle()));
      expect(t.margin).toBeCloseTo(usd.margin, 9);
      expect(t.contribution).toBeCloseTo(usd.contribution, 9);
    });

    it('a rupee target is read as-is and price-to-target lands on it exactly', () => {
      const b0 = inrBundle(bundle().products.map(p => (p.id === 'a' ? { ...p, target_price_usd: 0.01, target_price_inr: 1500 } : p)));
      const a = byId(b0, 'a');
      expect(a.target).toBe(1500);
      expect(a.gap).toBeCloseTo(a.priceInr - 1500, 6);
      const m = markupToTarget(b0, rowsOf(b0), ['a']);
      // Markup is stored to 4 decimals, which is a few paise either way on a ₹1,500 price.
      expect(Math.abs(byId(m.next, 'a').price - 1500)).toBeLessThan(0.1);
      // "Target this line" works in rupees too.
      const raw = b0.cogs.find(c => c.product_id === 'a' && c.cogs_type === 'Raw Piece' && c.include === 'Yes')!;
      const after = byId(patchCogsLine(b0, raw.id, { unit_cost_inr: targetLineEach(a, raw)! }).next, 'a');
      expect(after.price).toBeCloseTo(1500, 6);
    });

    it('an older USD-only target is shown in rupees at the engine rate', () => {
      const a = byId(inrBundle(), 'a'); // target_price_usd: 20
      expect(a.target).toBeCloseTo(20 * a.r.exchangeRate, 6);
    });

    it('target from price stores rupees (and USD at today’s rate alongside)', () => {
      const b0 = inrBundle();
      const m = targetFromPrice(b0, rowsOf(b0), ['c']);
      const c = m.next.products.find(p => p.id === 'c')!;
      const row = byId(b0, 'c');
      expect(c.target_price_inr).toBeCloseTo(row.priceInr, 2);
      expect(c.target_price_usd).toBeCloseTo(row.priceInr / row.r.exchangeRate, 3);
    });
  });
});

describe('quote currency targets', () => {
  it('reads each currency, falling back to the other at the given rate', () => {
    expect(readTarget({ target_price_usd: 10 }, 'USD', 90)).toBe(10);
    expect(readTarget({ target_price_usd: 10 }, 'INR', 90)).toBe(900);
    expect(readTarget({ target_price_inr: 900, target_price_usd: 9.5 }, 'INR', 90)).toBe(900);
    expect(readTarget({ target_price_inr: 900 }, 'USD', 90)).toBe(10);
    expect(readTarget({}, 'INR', 90)).toBeNull();
  });

  it('only writes target_price_inr once the column exists', () => {
    expect(targetPatch({ target_price_usd: 1 }, 'USD', 5, 90)).toEqual({ target_price_usd: 5 });
    expect(targetPatch({ target_price_inr: 450 }, 'USD', 5, 90)).toEqual({ target_price_usd: 5, target_price_inr: null });
    expect(targetPatch({}, 'INR', 900, 90)).toEqual({ target_price_inr: 900, target_price_usd: 10 });
    expect(targetPatch({ target_price_inr: 1 }, 'INR', null, 90)).toEqual({ target_price_usd: null, target_price_inr: null });
  });

  it('price list offers active rupee items in allowed categories, plus unmoved old hardware', () => {
    const b = bundle();
    b.rawMaterialCosts = [
      { id: 'm1', category: 'Handles + Knobs', name: 'Brass knob', cost: 60, unit_type: 'pc', currency: 'INR', active: true },
      { id: 'm2', category: 'Handles + Knobs', name: 'Old knob', cost: 10, unit_type: 'pc', currency: 'INR', active: false },
      { id: 'm3', category: 'Accessories', name: 'Glass top', cost: 5, unit_type: 'pc', currency: 'USD', active: true },
      { id: 'm4', category: 'Raw Piece', name: 'Teak blank', cost: 900, unit_type: 'pc', currency: 'INR', active: true },
    ];
    b.hardwarePrices = [{ id: 'h1', name: 'Hinge', unit_cost_inr: 12, units: 'pc', source: 'legacy' }, { id: 'm1', name: 'Brass knob', unit_cost_inr: 60, units: 'pc', source: 'materials' }];
    const items = priceListItems(b, ['Handles + Knobs', 'Accessories', 'Other Hardware']);
    expect(items.map(i => [i.name, i.category, i.unitCostInr])).toEqual([['Brass knob', 'Handles + Knobs', 60], ['Hinge', 'Other Hardware', 12]]);
  });

  it('adding a price-list item puts it on every ticked SKU at its qty, and re-adding updates instead of doubling', () => {
    const knob = { key: 'm:1', category: 'Handles + Knobs', name: 'Handles + Knobs', unitCostInr: 50, units: 'pc' };
    const feet = { key: 'm:2', category: 'Feet/Buffers', name: 'Felt pad', unitCostInr: 2, units: 'pc' };
    const before = bundle();
    const m = addPriceListLines(before, ['a', 'b'], [{ item: knob, qty: 4 }, { item: feet, qty: 8 }]);
    expect(new Set(m.touched)).toEqual(new Set(['a', 'b']));
    // a already had a manual "Handles + Knobs" line: updated in place, not duplicated
    const aKnobs = m.next.cogs.filter(c => c.product_id === 'a' && c.cogs_type === 'Handles + Knobs');
    expect(aKnobs).toHaveLength(1);
    expect(aKnobs[0]).toMatchObject({ components_per_product: 4, unit_cost_inr: 50, include: 'Yes' });
    const bLines = m.next.cogs.filter(c => c.product_id === 'b' && ['Handles + Knobs', 'Feet/Buffers'].includes(c.cogs_type));
    expect(bLines.map(c => [c.component_name, c.components_per_product, c.unit_cost_inr])).toEqual([['Handles + Knobs', 4, 50], ['Felt pad', 8, 2]]);
    expect(byId(m.next, 'b').editBuckets.hw_handles_knobs).toBeCloseTo(200, 6);
    expect(byId(m.next, 'b').editBuckets.hw_feet).toBeCloseTo(16, 6);
    expect(byId(m.next, 'c').editBuckets.hw_feet).toBe(0);
    const again = addPriceListLines(m.next, ['b'], [{ item: feet, qty: 6 }]);
    expect(again.next.cogs.filter(c => c.product_id === 'b' && c.cogs_type === 'Feet/Buffers').map(c => c.components_per_product)).toEqual([6]);
  });

  it('undo puts back exactly what an edit changed, and redo re-applies it', () => {
    const before = bundle();
    const costs = (b: Bundle) => rowsOf(b).map(r => r.costInr);
    // A multi-table edit: packaging type rewrites cogs lines and the product.
    const after = chain(before, [
      cur => setPackagingType(cur, ['a', 'b'], 'bulk_pack'),
      cur => setBucketTotal(cur, ['a'], 'raw_piece', 1234),
      cur => patchProductsSame(cur, ['c'], { quantity: 999 }),
    ]).next;
    expect(costs(after)).not.toEqual(costs(before));
    const undone = restoreRows(after, before, after)!;
    expect(costs(undone.next)).toEqual(costs(before));
    expect(undone.next.products.find(p => p.id === 'c')!.quantity).toBe(50);
    expect(new Set(undone.touched)).toEqual(new Set(['a', 'b', 'c']));
    const redone = restoreRows(undone.next, after, before)!;
    expect(costs(redone.next)).toEqual(costs(after));
  });

  it('undo keeps later edits to other fields, and removes lines the edit added', () => {
    const before = bundle();
    const knob = { key: 'm:9', category: 'Accessories', name: 'Rope handle', unitCostInr: 30, units: 'pc' };
    const after = addPriceListLines(before, ['b'], [{ item: knob, qty: 3 }]).next;
    const later = patchProductsSame(after, ['b'], { markup_percent: 0.4 }).next;
    const undone = restoreRows(later, before, after)!.next;
    expect(undone.cogs.length).toBe(before.cogs.length);
    expect(undone.products.find(p => p.id === 'b')!.markup_percent).toBe(0.4);
    expect(restoreRows(before, before, before)).toBeNull();
  });

  it('copying costing makes the targets cost like the source, step by step', () => {
    const before = bundle();
    const src = byId(before, 'b');
    const m = copyCosting(before, 'b', ['a', 'c', 'b'], { cogs: true });
    expect(new Set(m.touched)).toEqual(new Set(['a', 'c']));
    for (const id of ['a', 'c']) {
      const r = byId(m.next, id);
      expect(r.editBuckets.raw_piece).toBeCloseTo(src.editBuckets.raw_piece, 6);
      expect(r.editBuckets.subcontract).toBeCloseTo(src.editBuckets.subcontract, 6);
      expect(r.editBuckets.hw_handles_knobs).toBeCloseTo(src.editBuckets.hw_handles_knobs, 6);
    }
    // Labour and shipping untouched when not asked for.
    expect(m.next.oh).toEqual(before.oh);
    const lab = copyCosting(before, 'a', ['c'], { labour: true }).next;
    expect(byId(lab, 'c').r.manHoursPerUnit).toBeCloseTo(byId(before, 'a').r.manHoursPerUnit, 6);
    // Undo puts the targets back.
    const undone = restoreRows(m.next, before, m.next)!.next;
    rowsOf(undone).forEach((r, i) => expect(r.costInr).toBeCloseTo(rowsOf(before)[i].costInr, 6));
  });

  it('pasted lines are added (never doubling the chosen raw piece)', () => {
    const before = bundle();
    const lines = before.cogs.filter(c => c.product_id === 'a' && !c.is_auto_calculated);
    const m = pasteCogsLines(before, ['c'], lines);
    const added = m.next.cogs.filter(c => c.product_id === 'c').length - before.cogs.filter(c => c.product_id === 'c').length;
    expect(added).toBe(lines.length);
    const winners = m.next.cogs.filter(c => c.product_id === 'c' && c.cogs_type === 'Raw Piece' && c.include === 'Yes');
    expect(winners).toHaveLength(1);
  });
});
