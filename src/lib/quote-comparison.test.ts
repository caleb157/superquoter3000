import { describe, it, expect } from 'vitest';
import { compareQuoteToCurrent } from './quote-comparison';

describe('compareQuoteToCurrent', () => {
  const lines = [
    { product_id: 'b', name: 'Teak Stand', quantity: 100, unit_price_usd: 10 },
    { product_id: 'a', name: 'Ashtray', quantity: 50, unit_price_usd: 8 },
    { product_id: 'gone', name: 'Old Tray', quantity: 10, unit_price_usd: 5 },
    { product_id: 'k', name: 'Kit', quantity: 2, unit_price_usd: 99, is_assembly: true },
  ];
  const current = [
    { id: 'a', name: 'Ashtray', current_price: 9 },
    { id: 'b', name: 'Teak Stand', current_price: 9 },
    { id: 'n', name: 'Brand New', quantity: 5, current_price: 4 },
  ];

  it('sorts by name and classifies rows', () => {
    const { rows } = compareQuoteToCurrent(lines, current);
    expect(rows.map(r => [r.name, r.status])).toEqual([
      ['Ashtray', 'matched'], ['Brand New', 'new'], ['Kit', 'kit'], ['Old Tray', 'removed'], ['Teak Stand', 'matched'],
    ]);
  });

  it('computes per-line deltas', () => {
    const { rows } = compareQuoteToCurrent(lines, current);
    const ash = rows.find(r => r.name === 'Ashtray')!;
    expect(ash.delta).toBe(1);
    expect(ash.deltaPct).toBeCloseTo(0.125);
    expect(rows.find(r => r.name === 'Teak Stand')!.delta).toBe(-1);
  });

  it('totals only matched lines at the quoted quantities', () => {
    const { totals } = compareQuoteToCurrent(lines, current);
    expect(totals.quoted).toBe(100 * 10 + 50 * 8); // 1400
    expect(totals.current).toBe(100 * 9 + 50 * 9); // 1350
    expect(totals.delta).toBe(-50);
    expect(totals.lines).toBe(2);
  });
});
