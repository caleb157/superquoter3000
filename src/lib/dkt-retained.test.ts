import { describe, expect, it } from 'vitest';
import { buildForecast, DEFAULT_SETTINGS, orderFlows } from './dkt-cashflow';
import { RETAINED_SEED, retainedToOrder, seedRows } from './dkt-retained';

const base = {
  settings: { ...DEFAULT_SETTINGS, cash_usd: 10000, min_cash_usd: 0, horizon_months: 18 },
  thisMonth: '2026-11', costs: [], loans: [], loanPayments: [], creditLines: [], creditDraws: [], amazonSkus: [],
};

describe('retained orders', () => {
  it('start unticked, so the forecast is unchanged', () => {
    const rows = seedRows();
    expect(rows.every(r => !r.counted)).toBe(true);
    const without = buildForecast({ ...base, orders: [] });
    const withRows = buildForecast({ ...base, orders: rows.map(retainedToOrder) });
    expect(withRows.months.map(m => m.closing)).toEqual(without.months.map(m => m.closing));
  });

  it('a CCT container: no deposit, half to PV at PO and at shipment, paid the month after shipping', () => {
    const row = { ...seedRows()[0], counted: true };
    expect(row.customer).toBe('Carolina Chair and Table');
    const f = orderFlows(retainedToOrder(row), '2026-11');
    const at = (k: string) => f.filter(x => x.kind === k).map(x => [x.month, Math.round(x.amount)]);
    expect(at('cust_deposit')).toEqual([]);
    expect(at('pv_advance')).toEqual([['2027-03', -15032]]);
    expect(at('pv_balance')).toEqual([['2027-06', -15032]]);
    expect(at('cust_balance')).toEqual([['2027-07', 33404]]);
  });

  it('counts a ticked row in the forecast and as retained revenue in the profit card', () => {
    const row = { ...seedRows()[0], counted: true };
    const fc = buildForecast({ ...base, orders: [retainedToOrder(row)] });
    const ret = fc.profit.revenue.find(l => l.key === 'retained')!;
    expect(ret.amount).toBe(33404);
    expect(ret.items[0].label).toContain('(retained)');
    expect(fc.profit.revenue.find(l => l.key === 'hq')!.amount).toBe(0);
    expect(Math.round(fc.profit.costOfSales.find(l => l.key === 'pv_retained')!.amount)).toBe(-30064);
    expect(Math.round(fc.profit.grossProfit)).toBe(3340);
  });

  it('the repeat customers add up to last year (about $57,900)', () => {
    const total = RETAINED_SEED.filter(s => !s.name.startsWith('CCT')).reduce((s, r) => s + r.fob_usd, 0);
    expect(total).toBeGreaterThan(57800);
    expect(total).toBeLessThan(58000);
  });
});
