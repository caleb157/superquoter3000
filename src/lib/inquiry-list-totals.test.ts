import { describe, expect, it } from 'vitest';
import { dktSharePct, pickEntities, sumListTotals } from './inquiry-list-totals';

const ent = pickEntities([
  { id: 'pv', name: 'Parable Ventures', entity_type: 'India' },
  { id: 'dkt', name: 'Desert Kingdom Traders', entity_type: 'US' },
]);

const t = (rev: number, profit: number) => ({
  revenueUsd: rev, costUsd: rev - profit, profitUsd: profit, revenueInr: null, profitInr: null,
  margin: rev ? profit / rev : 0, cbm: 0, manHours: 0, productCount: 0,
});

describe('dktSharePct', () => {
  it('picks the entities', () => expect(ent).toEqual({ pvId: 'pv', dktId: 'dkt' }));
  it('is null when PV sells or no selling entity', () => {
    expect(dktSharePct({ selling_entity_id: 'pv', selling_retention_pct: 0.05 }, ent, 0.05)).toBeNull();
    expect(dktSharePct({}, ent, 0.05)).toBeNull();
    expect(dktSharePct(null, ent, 0.05)).toBeNull();
  });
  it('uses the inquiry retention %, else the default', () => {
    expect(dktSharePct({ selling_entity_id: 'dkt', selling_retention_pct: 0.08 }, ent, 0.05)).toEqual({ pct: 0.08, isDefault: false });
    expect(dktSharePct({ selling_entity_id: 'dkt', selling_retention_pct: 8 }, ent, 0.05)).toEqual({ pct: 0.08, isDefault: false });
    expect(dktSharePct({ selling_entity_id: 'dkt', selling_retention_pct: null }, ent, 0.05)).toEqual({ pct: 0.05, isDefault: true });
  });
});

describe('sumListTotals', () => {
  it('sums shown rows in USD with DKT share', () => {
    const r = sumListTotals([
      { products: 2, manHours: 10, cbm: 1.5, totals: t(1000, 200), dktPct: 0.05 },
      { products: 3, manHours: null, cbm: 2, totals: t(3000, 300), dktPct: null },
      { products: 1, totals: null },
    ]);
    expect(r).toMatchObject({ rows: 3, products: 6, manHours: 10, cbm: 3.5, revenueUsd: 4000, profitUsd: 500, dktUsd: 50 });
    expect(r.margin).toBeCloseTo(0.125);
  });
  it('has no margin without revenue', () => expect(sumListTotals([]).margin).toBeNull());
});
