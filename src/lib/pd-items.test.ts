import { describe, expect, it } from 'vitest';
import { PD_ITEMS, PD_REPEAT_ORDER_KEY, pdRepeatOrderUpserts } from './pd-items';

const product = { id: 'p1', packaging_type: 'ic_mc', percent_wood: 0.5 };
const cogs = { p1: new Set(['Handles + Knobs']) };
const NOW = '2026-10-12T00:00:00.000Z';

describe('pdRepeatOrderUpserts', () => {
  it('ticks the flag and every applicable unchecked item', () => {
    const rows = pdRepeatOrderUpserts(product, true, { 'p1:qc_sheet': true }, cogs, 'u1', NOW);
    const keys = rows.map(r => r.item_key);
    expect(keys[0]).toBe(PD_REPEAT_ORDER_KEY);
    expect(keys).toContain('handles_knobs');
    expect(keys).toContain('finishing_panel_wood');
    expect(keys).not.toContain('qc_sheet'); // already checked keeps its original date
    expect(keys).not.toContain('feet_buffers'); // no COGS rows, not applicable
    expect(rows.every(r => r.is_checked && r.checked_at === NOW && r.checked_by === 'u1')).toBe(true);
  });

  it('skips items that do not apply to the product', () => {
    const rows = pdRepeatOrderUpserts({ id: 'p1', packaging_type: 'ic', percent_wood: 1 }, true, {}, {}, null, NOW);
    const keys = rows.map(r => r.item_key);
    expect(keys).not.toContain('mc_size');
    expect(keys).not.toContain('finishing_panel_metal');
    expect(keys.length).toBe(1 + PD_ITEMS.filter(i => !i.cogsCategory && !i.requiresIcMc && !i.requiresMetal).length);
  });

  it('unticking only clears the flag', () => {
    const rows = pdRepeatOrderUpserts(product, false, {}, cogs, 'u1', NOW);
    expect(rows).toEqual([{ product_id: 'p1', item_key: PD_REPEAT_ORDER_KEY, is_checked: false, checked_at: null, checked_by: null }]);
  });
});
