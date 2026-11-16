import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, monthRange, type CreditDraw, type CreditLine, type Flow, type ForecastInput, type Loan, type LoanPayment } from './dkt-cashflow';
import { adjustSchedule, maxPayoff } from './dkt-max-payoff';

const months = monthRange('2026-11', 6);
const loan = (l: Partial<Loan>): Loan => ({
  id: 'l1', name: 'Loan', kind: 'lump', balance_usd: 0, rate_pct: 0, due_month: null, pay_with_inquiry_id: null, pay_with_so: null, active: true, ...l,
});
const input = (p: Partial<ForecastInput> & { ops?: number[] }): ForecastInput => ({
  settings: { ...DEFAULT_SETTINGS, cash_usd: 10000, min_cash_usd: 0, horizon_months: 6, allegro_launch_on: false },
  thisMonth: '2026-11', orders: [], costs: [], loans: [], loanPayments: [], creditLines: [], creditDraws: [], amazonSkus: [],
  extraFlows: (p.ops ?? []).map((a, i): Flow => ({ month: months[i], kind: a >= 0 ? 'income' : 'expense', amount: a, label: 'ops' })),
  ...p,
});

describe('max payoff', () => {
  it('sweeps cash above the buffer into debt and never dips under it', () => {
    const inp = input({ loans: [loan({ id: 'a', name: 'A', balance_usd: 20000, rate_pct: 8, due_month: '2027-12' })], ops: [0, -3000, 0, 2000, 0, 0] });
    const r = maxPayoff(inp, 2000);
    // Lowest future cash is 7,000 in Dec, so 5,000 goes in Nov; Feb adds 2,000 more.
    expect(r.payments[0]).toMatchObject({ month: '2026-11', amount: 5000 });
    expect(r.extraTotal).toBeCloseTo(7000);
    expect(Math.min(...r.months.map(m => m.maxClosing))).toBeGreaterThanOrEqual(2000 - 0.01);
    expect(r.debts.find(d => d.key === 'l:a')?.maxEnd).toBeCloseTo(13000);
  });

  it('pays the dearest debt first and leaves loans the plan already pays this month alone', () => {
    const inp = input({
      settings: { ...DEFAULT_SETTINGS, cash_usd: 7000, min_cash_usd: 0, horizon_months: 6, allegro_launch_on: false },
      loans: [
        loan({ id: 'cheap', name: 'Cheap', balance_usd: 3000, rate_pct: 2, due_month: '2028-01' }),
        loan({ id: 'dear', name: 'Dear', balance_usd: 3000, rate_pct: 12, due_month: '2028-01' }),
        loan({ id: 'now', name: 'Due now', balance_usd: 1000, rate_pct: 20, due_month: '2026-11' }),
      ],
    });
    const r = maxPayoff(inp, 2000);
    expect(r.payments.map(p => p.name)).toEqual(['Dear', 'Cheap']);
    expect(r.payments[0].amount).toBeCloseTo(3000);
    expect(r.payments[1].amount).toBeCloseTo(4000 - 3000);
  });

  it('pays an installment draw early, so its fee stops sooner, and reports the interest saved', () => {
    const line: CreditLine = { id: 'amex', name: 'Amex', limit_usd: 15000, drawn_usd: 0, rate_pct: 0, term_months: 6, monthly_fee_pct: 1 };
    const draws: CreditDraw[] = [{ id: 'd', line_id: 'amex', month: '2026-10', amount_usd: 6000, actual: true, draw_date: '2026-10-05', term_months: 6, monthly_fee_pct: 1 }];
    const r = maxPayoff(input({ settings: { ...DEFAULT_SETTINGS, cash_usd: 20000, min_cash_usd: 0, horizon_months: 6, allegro_launch_on: false }, creditLines: [line], creditDraws: draws }), 2000);
    const amex = r.debts.find(d => d.key === 'c:amex')!;
    expect(amex.basePaidOff).toBe('2027-04');
    expect(amex.maxPaidOff).toBe('2026-11');
    expect(r.interestSaved).toBeCloseTo(60 * 5); // Dec–Apr fees no longer charged
    expect(r.profitMax - r.profitBase).toBeCloseTo(r.interestSaved);
  });

  it('flags months the plan alone already leaves under the buffer and pays nothing before them', () => {
    const r = maxPayoff(input({ loans: [loan({ balance_usd: 5000, rate_pct: 5 })], ops: [0, 0, -9500, 0, 0, 0] }), 2000);
    expect(r.belowBufferMonths).toEqual(['2027-01', '2027-02', '2027-03', '2027-04']);
    expect(r.extraTotal).toBe(0);
  });

  it('shrinks a payment schedule from the end and lowers its interest', () => {
    const pays: LoanPayment[] = [
      { id: 'a', loan_id: 'o', due_date: '2027-05-01', principal_usd: 0, interest_usd: 750, paid: false },
      { id: 'b', loan_id: 'o', due_date: '2027-11-01', principal_usd: 10000, interest_usd: 750, paid: false },
      { id: 'c', loan_id: 'o', due_date: '2028-05-01', principal_usd: 10000, interest_usd: 375, paid: false },
    ];
    const out = adjustSchedule(pays, [{ month: '2026-12', amount: 5000 }], '2026-11');
    expect(out.map(p => p.principal_usd)).toEqual([0, 10000, 5000]);
    expect(out[0].interest_usd).toBeCloseTo(562.5);
    expect(out[2].interest_usd).toBeCloseTo(187.5);
  });
});
