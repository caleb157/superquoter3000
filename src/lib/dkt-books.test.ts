import { describe, expect, it } from 'vitest';
import { buildBooks, type BooksRaw } from './dkt-books';
import { buildForecast, DEFAULT_SETTINGS, lumpLoanMonth, type Loan } from './dkt-cashflow';

// DKT's open business as its Odoo showed it on 19 Nov 2026.
const po = (name: string, total: number, status = 'no', planned: string | null = null) =>
  ({ name, ref: '', state: 'purchase', date: '2026-10-01', planned, total_usd: total, invoice_status: status });
const raw: BooksRaw = {
  pv_partner: 'Parable Ventures Pvt Ltd',
  orders: [
    { name: 'S00057', partner_id: 32, partner: 'Answers in Genesis', ref: '', date: '2026-09-22', ship_date: null, total_usd: 6600, invoiced_usd: 0, to_invoice_usd: 6600, pos: [po('P00037', 5223.5)] },
    { name: 'S00062', partner_id: 90, partner: 'Adam Fogleman', ref: 'urban tribes cafe', date: '2026-10-16', ship_date: '2026-12-10', total_usd: 19100, invoiced_usd: 0, to_invoice_usd: 19100, pos: [po('P00038', 17190)] },
    { name: 'S00058', partner_id: 89, partner: 'Blend Indoor Outdoor', ref: '', date: '2026-11-05', ship_date: '2027-01-01', total_usd: 7743.25, invoiced_usd: 0, to_invoice_usd: 7743.25, pos: [po('P00041', 6969.75)] },
  ],
  invoices: [{ name: 'INV/2026/00017', partner_id: 83, partner: 'Carolina Chair and Table', origin: 'S00047', due: '2026-11-05', total_usd: 29571.05, residual_usd: 20511.5 }],
  bills: [],
  customer_credit: [{ partner_id: 90, partner: 'Adam Fogleman', credit_usd: 7000 }, { partner_id: 89, partner: 'Blend Indoor Outdoor', credit_usd: 2300 }, { partner_id: 7, partner: 'JOFFA', credit_usd: 6.5 }],
  pv_prepaid_usd: 17600,
  banks: [{ journal: 'Mercury Checking', balance_usd: 19271.83, as_of: '2026-11-12' }, { journal: 'Stripe', balance_usd: 0, as_of: '2025-06-01' }],
  fetched_at: '2026-11-20T00:00:00Z',
};
const pvShip = [{ ref: 'P00037 Ark Encounter', ship_month: '2026-12' }];

describe('DKT books', () => {
  const b = buildBooks(raw, [], '2026-11', pvShip);
  const by = (n: string) => b.orders.find(o => o.name === n)!;

  it('takes the real customer price and PV cost, so the margin is worked out', () => {
    expect(by('S00062').custTotal).toBe(19100);
    expect(by('S00062').pvTotal).toBe(17190);
    expect(by('S00062').marginPct).toBeCloseTo(0.1, 5);
  });

  it("applies customer deposits to that customer's order", () => {
    expect(by('S00062').depositApplied).toBe(7000);
    expect(by('S00062').custUninvoiced).toBe(12100);
    expect(by('S00058').custUninvoiced).toBeCloseTo(5443.25, 2);
    expect(b.unappliedDeposits).toEqual([{ partner: 'JOFFA', usd: 6.5 }]);
  });

  it("applies DKT's advance to PV to the oldest orders first", () => {
    expect(by('S00057').pvUnbilled).toBe(0);
    expect(by('S00062').advanceApplied).toBeCloseTo(12376.5, 2);
    expect(by('S00062').pvUnbilled).toBeCloseTo(4813.5, 2);
    expect(by('S00058').pvUnbilled).toBeCloseTo(6969.75, 2);
    expect(b.unappliedAdvance).toBe(0);
  });

  it("dates orders by delivery date, else PV's ship date, else a guess", () => {
    expect(by('S00062').shipMonth).toBe('2026-12');
    expect(by('S00062').shipSource).toBe('order');
    expect(by('S00057').shipMonth).toBe('2026-12');
    expect(by('S00057').shipSource).toBe('pv');
  });

  it("keeps an overdue customer invoice whose order is already invoiced (CCT), due now", () => {
    const cct = by('INV/2026/00017');
    expect(cct.kind).toBe('invoice');
    expect(cct.flows).toEqual([{ month: '2026-11', kind: 'cust_balance', amount: 20511.5, label: expect.stringContaining('Carolina'), ref: 'INV/2026/00017' }]);
  });

  it('adds the bank balances with the latest date', () => {
    expect(b.cash).toMatchObject({ balance: 19271.83, asOf: '2026-11-12' });
  });

  it('a left-out order keeps its deposit and advance for the others', () => {
    const b2 = buildBooks(raw, [{ so_name: 'S00057', excluded: true, ship_month: null }], '2026-11', pvShip);
    expect(b2.orders.find(o => o.name === 'S00062')!.advanceApplied).toBe(17190);
  });

  it('feeds the forecast and profit, and repays a loan when its order is paid', () => {
    const fc = buildForecast({
      settings: { ...DEFAULT_SETTINGS, cash_usd: 0, min_cash_usd: 0, horizon_months: 6, allegro_launch_on: false },
      thisMonth: '2026-11', orders: [], costs: [], loans: [], loanPayments: [], creditLines: [], creditDraws: [], amazonSkus: [], booked: b.orders,
    });
    expect(Math.round(fc.months[0].byKind.cust_balance ?? 0)).toBe(20512); // CCT now
    expect(Math.round(fc.months[1].byKind.cust_balance ?? 0)).toBe(12100 + 6600); // Dec: Urban Tribes + Ark
    const hq = fc.profit.revenue.find(l => l.key === 'hq')!;
    expect(hq.amount).toBeCloseTo(19100 + 6600 + 7743.25, 2);
    const loan = { id: 'l', name: 'Caleb', kind: 'lump', balance_usd: 8000, rate_pct: 0, due_month: null, pay_with_inquiry_id: null, pay_with_so: 'dkt:INV/2026/00017', active: true } as Loan;
    expect(lumpLoanMonth(loan, [], [], b.orders)).toBe('2026-11');
  });
});
