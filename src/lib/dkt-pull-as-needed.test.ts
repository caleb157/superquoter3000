import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type CostItem, type CreditDraw, type CreditLine, type ForecastInput } from './dkt-cashflow';
import { pullAsNeeded, pullQueue } from './dkt-pull-as-needed';

const sooie: CreditLine = { id: 's', name: 'Sooie', limit_usd: 20000, drawn_usd: 0, rate_pct: 5, balloon: true };
const amex: CreditLine = { id: 'a', name: 'Amex', limit_usd: 15000, drawn_usd: 0, rate_pct: 6.6, term_months: 6, monthly_fee_pct: 0.55 };
const hq: CreditLine = { id: 'h', name: 'HQ First', limit_usd: 15000, drawn_usd: 0, rate_pct: 5 };

const cost = (id: string, kind: CostItem['kind'], amount: number, month: string): CostItem =>
  ({ id, name: id, kind, amount_usd: amount, frequency: 'once', start_month: month, end_month: null });

const input = (o: Partial<ForecastInput> = {}): ForecastInput => ({
  settings: { ...DEFAULT_SETTINGS, cash_usd: 5000, min_cash_usd: 1000, horizon_months: 6, allegro_launch_on: false },
  thisMonth: '2026-11', orders: [], loans: [], loanPayments: [], amazonSkus: [],
  creditLines: [sooie, amex, hq], creditDraws: [], costs: [], ...o,
});
const order = { s: 1, a: 2, h: 3 };
const closings = (p: ReturnType<typeof pullAsNeeded>) => p.forecast.months.map(m => Math.round(m.closing));

describe('pull as needed', () => {
  it('orders the lines by pull order and leaves out lines without one', () => {
    expect(pullQueue([sooie, amex, hq], { a: 1, s: 2 }).map(l => l.name)).toEqual(['Amex', 'Sooie']);
  });

  it('does nothing when no line has a pull order', () => {
    const p = pullAsNeeded(input({ costs: [cost('bill', 'expense', 10000, '2026-12')] }), {});
    expect(p.moves).toEqual([]);
    expect(p.short.length).toBeGreaterThan(0);
  });

  it('pulls only what keeps every month at the minimum, from the first line', () => {
    const p = pullAsNeeded(input({ costs: [cost('bill', 'expense', 10000, '2026-12')] }), order);
    expect(p.moves.filter(m => m.amount > 0).map(m => [m.month, m.name])).toEqual([['2026-12', 'Sooie']]);
    expect(closings(p).every(c => c >= 999)).toBe(true);
    expect(p.lines.find(l => l.id === 's')!.pulled).toBe(6000);
    expect(p.short).toEqual([]);
  });

  it('moves to the next line when the first is full', () => {
    const p = pullAsNeeded(input({ costs: [cost('bill', 'expense', 30000, '2026-12')] }), order);
    const dec = p.moves.filter(m => m.month === '2026-12' && m.amount > 0);
    expect(dec.map(m => m.name)).toEqual(['Sooie', 'Amex']);
    expect(dec[0].amount).toBe(20000);
    // Amex is repaid in installments, so later months pull more to cover them.
    expect(closings(p).every(c => c >= 999)).toBe(true);
  });

  it('pays revolving pulls back once the cash ahead allows, last line first', () => {
    const p = pullAsNeeded(input({ costs: [cost('bill', 'expense', 10000, '2026-12'), cost('in', 'income', 12000, '2027-02')] }), order);
    const back = p.moves.filter(m => m.amount < 0);
    expect(back.map(m => [m.month, m.name])).toEqual([['2027-02', 'Sooie']]);
    expect(p.lines.find(l => l.id === 's')!.endOwed).toBeLessThan(1);
    expect(closings(p).every(c => c >= 999)).toBe(true);
  });

  it('never pays back money it would have to pull again later', () => {
    const p = pullAsNeeded(input({ costs: [
      cost('bill', 'expense', 10000, '2026-12'), cost('in', 'income', 8000, '2027-01'), cost('bill2', 'expense', 8000, '2027-03'),
    ] }), order);
    expect(p.moves.filter(m => m.amount < 0)).toEqual([]);
    expect(p.moves.filter(m => m.amount > 0).length).toBe(1);
  });

  it('pulls and pays back in $500 steps', () => {
    const p = pullAsNeeded(input({ costs: [cost('bill', 'expense', 7234, '2026-12'), cost('in', 'income', 4100, '2027-02')] }), order);
    const pulls = p.moves.filter(m => m.amount > 0);
    expect(pulls.map(m => m.amount)).toEqual([3500]);
    expect(p.moves.filter(m => m.amount < 0).every(m => -m.amount % 500 === 0 || Math.abs(m.amount) === 3500)).toBe(true);
    expect(closings(p).every(c => c >= 999)).toBe(true);
  });

  it('lists months still short once every line is full', () => {
    const p = pullAsNeeded(input({ costs: [cost('bill', 'expense', 60000, '2026-12')] }), order);
    expect(p.short[0].month).toBe('2026-12');
    // $6,000 short plus a month's interest on what's pulled.
    expect(p.short[0].amount).toBeGreaterThan(6000);
    expect(p.short[0].amount).toBeLessThan(6100);
  });

  it('sets planned draws aside but keeps real ones', () => {
    const draws: CreditDraw[] = [
      { id: 'planned', line_id: 'h', month: '2026-12', amount_usd: 9000, actual: false },
      { id: 'real', line_id: 's', month: '2026-10', amount_usd: 10000, actual: true, draw_date: '2026-10-01', rate_pct: 5, balloon: true, maturity_month: '2027-03' },
    ];
    const p = pullAsNeeded(input({ creditDraws: draws }), order);
    expect(p.setAside).toBe(1);
    expect(p.input.creditDraws.some(d => d.id === 'planned')).toBe(false);
    expect(p.input.creditDraws.some(d => d.id === 'real')).toBe(true);
  });
});
