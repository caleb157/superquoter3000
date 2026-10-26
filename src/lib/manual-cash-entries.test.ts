import { describe, expect, it } from 'vitest';
import { entryMonths, spreadEntry, type ManualEntry } from './manual-cash-entries';
import { manualCashItems, cashflowTable } from './master-analytics';
import { manualFlows } from './dkt-cashflow';

const e = (p: Partial<ManualEntry>): ManualEntry => ({
  id: 'x', scope: 'pv', name: 'Test', kind: 'expense', amount: 1200, currency: 'USD', start_date: '2026-11-15', end_date: null, ...p,
});
const months = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02'];

describe('manual cash entries', () => {
  it('puts a single-date entry all in its month', () => {
    expect(spreadEntry(e({}), months)).toEqual([{ month: '2026-11', amount: -1200 }]);
  });
  it('spreads evenly from the start month to the end month, inclusive', () => {
    const r = spreadEntry(e({ kind: 'income', start_date: '2026-11-20', end_date: '2027-02-03' }), months);
    expect(r.map(x => x.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    r.forEach(x => expect(x.amount).toBe(300));
  });
  it('drops months outside the forecast but keeps the per-month share', () => {
    const r = spreadEntry(e({ start_date: '2026-08-01', end_date: '2026-11-30' }), months);
    expect(r).toEqual([{ month: '2026-10', amount: -300 }, { month: '2026-11', amount: -300 }]);
  });
  it('treats an end date in the same month (or earlier) as a single month', () => {
    expect(entryMonths({ start_date: '2026-11-01', end_date: '2026-11-28' })).toEqual(['2026-11']);
    expect(entryMonths({ start_date: '2026-11-01', end_date: '2026-09-01' })).toEqual(['2026-11']);
  });
  it('lands in the PV cash flow table with the right sign and currency', () => {
    const items = manualCashItems([e({}), e({ id: 'y', kind: 'income', amount: 9000, currency: 'INR', start_date: '2026-12-01' })], months, 90);
    const t = cashflowTable(items, months, 'USD', 0, 0);
    expect(t.net['2026-11']).toBe(-1200);
    expect(t.net['2026-12']).toBe(100);
    expect(t.cells.manual_out['2026-11']).toBe(1200);
  });
  it('becomes DKT forecast flows', () => {
    const f = manualFlows(e({ start_date: '2026-11-01', end_date: '2026-12-31' }), months);
    expect(f).toEqual([
      { month: '2026-11', kind: 'manual_out', amount: -600, label: 'Test', ref: 'x' },
      { month: '2026-12', kind: 'manual_out', amount: -600, label: 'Test', ref: 'x' },
    ]);
  });
});
