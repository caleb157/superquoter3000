// The grid follows the costing sheet: COGS, then labour, then shipping, then margin, each
// step folding to its subtotal, and every editable field living in exactly one place.
import { describe, expect, it } from 'vitest';
import { ALL_COLS, BANDS, bulkFieldGroups, layout } from './columns';

const ids = (open: Record<string, boolean>) => layout(open).map(c => c.id);

describe('costing grid steps', () => {
  it('runs COGS, labour, shipping, margin in that order', () => {
    expect(BANDS.map(b => b.id)).toEqual(['cogs', 'labour', 'shipping', 'margin']);
    const bands = layout(Object.fromEntries(BANDS.map(b => [b.id, true]))).map(c => c.band).filter(Boolean);
    const firsts = BANDS.map(b => bands.indexOf(b.id));
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
  });

  it('folded, each step shows only its subtotal', () => {
    expect(ids({})).toEqual(['qty', 'cogs_total', 'mh_total', 'labor_inr', 'cbm', 'ship', 'cost', 'npm', 'price', 'gap']);
  });

  it('open, a step shows its detail and its subtotal once', () => {
    const open = ids({ cogs: true, shipping: true, margin: true });
    expect(open).toContain('bucket:raw_piece');
    expect(open.filter(id => id === 'cogs_total')).toHaveLength(1);
    expect(open.filter(id => id === 'cost')).toHaveLength(1);
    // Sub-groups stay folded to their total until opened.
    expect(open).toContain('hw');
    expect(open).not.toContain('bucket:hw_feet');
    expect(open).toContain('per_mc');
    expect(open).not.toContain('ic_w');
    const hw = ids({ cogs: true, hardware: true, shipping: true, cartons: true });
    expect(hw).toContain('bucket:hw_feet');
    expect(hw).toContain('ic_w');
    expect(new Set(hw).size).toBe(hw.length);
    // Raw piece folds to its total and opens to the costs behind it.
    expect(layout({ cogs: true }).find(c => c.id === 'bucket:raw_piece')!.detail).toBeUndefined();
    expect(layout({ cogs: true, raw: true }).find(c => c.id === 'bucket:raw_piece')!.detail).toBeDefined();
  });

  it('every field has one home', () => {
    const all = ALL_COLS.map(c => c.id);
    expect(new Set(all).size).toBe(all.length);
    const fields = bulkFieldGroups().flatMap(g => g.cols.map(c => c.id));
    expect(new Set(fields).size).toBe(fields.length);
    expect(bulkFieldGroups().map(g => g.label)).toEqual(['Order', '1. COGS', '2. Labour', '3. Shipping', '4. Margin']);
  });

  it('shows rupee headers for a rupee customer', () => {
    const labels = layout({ margin: true }, 'INR').map(c => c.label);
    expect(labels).toContain('Price ₹');
    expect(labels).not.toContain('Price $');
  });
});
