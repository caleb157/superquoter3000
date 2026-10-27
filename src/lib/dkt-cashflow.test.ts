import { describe, expect, it } from 'vitest';
import {
  addMonths, allegroLaunchMonth, allegroProjection, buildForecast, costFlows, creditFlows, DEFAULT_SETTINGS, loanFlows, odooFlows, odooCustReceived, odooOwed, orderAmounts, orderFlows,
  type DktOrder, type Loan,
} from './dkt-cashflow';
import { demandFor, scenarioSummary, simulateSku, type AmazonSku } from './dkt-amazon';

const order = (o: Partial<DktOrder> = {}): DktOrder => ({
  inquiry_id: 'i1', rfq_number: 'DKT-1', title: null, customer: 'Acme', status: 'po',
  fob_usd: 100000, fob_source: 'projection', margin_pct: 0.05, cust_deposit_pct: 0.3, advance_pct: 0.95,
  po_month: '2026-11', ship_month: '2027-02',
  done: { cust_deposit: false, advance: false, cust_balance: false, pv_balance: false }, excluded: false, ...o,
});

const sku = (s: Partial<AmazonSku> = {}): AmazonSku => ({
  id: 's1', scenario_id: null, name: 'Stool', mode: 'inventory', price_usd: 50, net_margin_pct: 0.2, units_per_month: 100,
  start_month: '2027-03', unit_cost_usd: 10, freight_per_unit_usd: 2, order_qty: 400, make_months: 2, ship_months: 2, ...s,
});

describe('months', () => {
  it('adds across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
  });
});

describe('orders', () => {
  it('splits a DKT order into customer and PV payments', () => {
    const a = orderAmounts(order());
    expect(a.custDeposit).toBe(30000);
    expect(a.pvAdvance).toBeCloseTo(90250);
    expect(a.pvBalance).toBeCloseTo(4750);
    expect(a.custBalance).toBe(70000);
    expect(a.gap).toBeCloseTo(60250);
  });
  it('skips done flows and pulls overdue ones into this month', () => {
    const f = orderFlows(order({ po_month: '2026-08', done: { cust_deposit: true, advance: false, cust_balance: false, pv_balance: false } }), '2026-10');
    expect(f.find(x => x.kind === 'cust_deposit')).toBeUndefined();
    expect(f.find(x => x.kind === 'pv_advance')?.month).toBe('2026-10');
  });
});

describe('costs', () => {
  it('repeats quarterly from the start month until the end month', () => {
    const months = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'];
    const f = costFlows({ id: 'c', name: 'Tax', kind: 'expense', amount_usd: 300, frequency: 'quarterly', start_month: '2026-11', end_month: '2027-03' }, months);
    expect(f.map(x => x.month)).toEqual(['2026-11', '2027-02']);
    expect(f[0].amount).toBe(-300);
  });
});

describe('overhead', () => {
  it('charges the monthly figure in every month and ignores old overhead lines', () => {
    const fc = buildForecast({
      settings: { ...DEFAULT_SETTINGS, cash_usd: 10000, monthly_overhead_usd: 1500, horizon_months: 3 },
      thisMonth: '2026-10', orders: [], loanPayments: [], loans: [], creditLines: [], creditDraws: [], amazonSkus: [],
      costs: [{ id: 'o', name: 'Old', kind: 'overhead', amount_usd: 999, frequency: 'monthly', start_month: null, end_month: null }],
    });
    expect(fc.months.map(m => m.byKind.overhead)).toEqual([-1500, -1500, -1500]);
    expect(fc.months[2].closing).toBe(5500);
  });
});

describe('loans', () => {
  const lump: Loan = { id: 'l', name: 'Presswood', kind: 'lump', balance_usd: 5000, rate_pct: 0, due_month: null, pay_with_inquiry_id: 'i1', pay_with_so: null, active: true };
  it('repays a lump loan with the linked order balance', () => {
    const f = loanFlows(lump, [], [order()], '2026-10');
    expect(f).toEqual([expect.objectContaining({ month: '2027-02', amount: -5000 })]);
  });
  it('brings in the money of a loan not received yet, then its payments', () => {
    const sba: Loan = { ...lump, id: 'sba', kind: 'schedule', pay_with_inquiry_id: null, proceeds_usd: 81637, proceeds_month: '2026-11' };
    const f = loanFlows(sba, [{ id: 'p1', loan_id: 'sba', due_date: '2026-12-15', principal_usd: 433.30, interest_usd: 710.94, paid: false }], [], '2026-10');
    expect(f[0]).toMatchObject({ month: '2026-11', kind: 'loan_proceeds', amount: 81637 });
    expect(f.filter(x => x.month === '2026-12').reduce((t, x) => t + x.amount, 0)).toBeCloseTo(-1144.24);
    expect(loanFlows({ ...sba, active: false }, [], [], '2026-10')).toEqual([]);
    expect(loanFlows(sba, [], [], '2026-12').some(x => x.kind === 'loan_proceeds')).toBe(false);
  });
  it('leaves a lump loan with no date out of the forecast', () => {
    expect(loanFlows({ ...lump, pay_with_inquiry_id: null }, [], [], '2026-10')).toEqual([]);
  });
});

describe('credit lines', () => {
  it('charges monthly interest on the running balance', () => {
    const f = creditFlows([{ id: 'x', name: 'LOC', limit_usd: 50000, drawn_usd: 0, rate_pct: 12 }], [{ id: 'd', line_id: 'x', month: '2026-11', amount_usd: 10000 }], ['2026-10', '2026-11', '2026-12']);
    expect(f.filter(x => x.kind === 'credit_interest').map(x => Math.round(-x.amount))).toEqual([100, 100]);
    expect(f.find(x => x.kind === 'credit_draw')?.amount).toBe(10000);
  });
});

describe('odoo orders', () => {
  it('pays unpaid PV invoices by due date, the uninvoiced rest at shipping, and grosses up the customer side', () => {
    const f = odooFlows(
      [{ name: 'S00120', ref: '', po_month: '2026-09', ship_month: '2026-12', pv_total_usd: 95000, to_invoice_usd: 20000, margin_pct: 0.05, cust_deposit_pct: 0.3, done: { cust_deposit: true, cust_balance: false }, excluded: false }],
      [{ name: 'INV/1', origin: 'S00120', due_month: '2026-09', residual_usd: 75000 }],
      '2026-10',
    );
    expect(f.find(x => x.kind === 'odoo_invoice')).toMatchObject({ month: '2026-10', amount: -75000 });
    expect(f.find(x => x.kind === 'odoo_to_invoice')).toMatchObject({ month: '2026-12', amount: -20000 });
    expect(f.find(x => x.kind === 'cust_balance')?.amount).toBeCloseTo(70000);
    expect(f.find(x => x.kind === 'cust_deposit')).toBeUndefined();
  });
});

describe('odoo orders already paid to PV', () => {
  const so = { name: 'S00105', ref: '', po_month: '2026-07', ship_month: '2026-12', pv_total_usd: 28602, to_invoice_usd: 28602, margin_pct: 0.05, cust_deposit_pct: 0.3, done: { cust_deposit: true, cust_balance: false }, excluded: false };
  it('drops the PV payment when DKT has paid in full but PV has not invoiced', () => {
    const f = odooFlows([{ ...so, pv_paid_usd: 28602 }], [], '2026-10');
    expect(f.filter(x => x.amount < 0)).toEqual([]);
    expect(f.find(x => x.kind === 'cust_balance')).toBeDefined();
  });
  it('takes the advance PV\'s Odoo applies to the order off the not-yet-invoiced part', () => {
    const f = odooFlows([{ ...so, advance_usd: 20000 }], [], '2026-10');
    expect(f.find(x => x.kind === 'odoo_to_invoice')?.amount).toBeCloseTo(-8602);
    expect(odooFlows([{ ...so, advance_usd: 28602 }], [], '2026-10').filter(x => x.amount < 0)).toEqual([]);
  });
  it('pays only the rest after a partial prepayment, before and after Odoo matches it', () => {
    expect(odooFlows([{ ...so, pv_paid_usd: 20000 }], [], '2026-10').find(x => x.kind === 'odoo_to_invoice')?.amount).toBeCloseTo(-8602);
    // PV invoiced 10,000 and matched it to the prepayment: Odoo shows 18,602 open, DKT still owes 8,602.
    expect(odooOwed({ ...so, to_invoice_usd: 18602, pv_paid_usd: 20000 }, [])).toBeCloseTo(8602);
    // PV invoiced everything and matched 20,000: Odoo shows 8,602 unpaid on the invoice.
    const f = odooFlows([{ ...so, to_invoice_usd: 0, pv_paid_usd: 20000 }], [{ name: 'INV/9', origin: 'S00105', due_month: '2026-11', residual_usd: 8602 }], '2026-10');
    expect(f.filter(x => x.amount < 0).map(x => x.amount)).toEqual([-8602]);
  });
});

describe('odoo orders, customer side', () => {
  const so = { name: 'S1', ref: '', po_month: '2026-07', ship_month: '2026-12', pv_total_usd: 9500, to_invoice_usd: 9500, margin_pct: 0.05, cust_deposit_pct: 0.3, done: { cust_deposit: false, cust_balance: false }, excluded: false };
  it('brings in what the customer still owes in the ship month', () => {
    const f = odooFlows([{ ...so, cust_paid_usd: 4000, cust_paid_in_cash_usd: 4000 }], [], '2026-10');
    expect(f.filter(x => x.amount > 0)).toEqual([expect.objectContaining({ month: '2026-12', kind: 'cust_balance', amount: 6000 })]);
    expect(odooFlows([{ ...so, cust_paid_usd: 10000, cust_paid_in_cash_usd: 10000 }], [], '2026-10').filter(x => x.amount > 0)).toEqual([]);
  });
  it('asks for the unpaid deposit now and the rest at shipping', () => {
    const f = odooFlows([{ ...so, cust_paid_usd: 1000, cust_paid_in_cash_usd: 1000 }], [], '2026-10').filter(x => x.amount > 0);
    expect(f).toEqual([
      expect.objectContaining({ month: '2026-10', kind: 'cust_deposit', amount: 2000 }),
      expect.objectContaining({ month: '2026-12', kind: 'cust_balance', amount: 7000 }),
    ]);
  });
});

describe('odoo orders, customer money received since current cash', () => {
  // FOB 10,000, deposit 30% = 3,000.
  const so = { name: 'S1', ref: '', po_month: '2026-07', ship_month: '2026-12', pv_total_usd: 9500, to_invoice_usd: 9500, margin_pct: 0.05, cust_deposit_pct: 0.3, done: { cust_deposit: false, cust_balance: false }, excluded: false };
  const ins = (o: object) => odooFlows([{ ...so, ...o }], [], '2026-10').filter(x => x.amount > 0);
  const total = (o: object) => ins(o).reduce((s, x) => s + x.amount, 0);
  it('adds a new payment this month instead of dropping it, and still expects the rest', () => {
    const f = ins({ cust_paid_usd: 7000 });
    expect(f).toEqual([
      expect.objectContaining({ month: '2026-12', kind: 'cust_balance', amount: 3000 }),
      expect.objectContaining({ month: '2026-10', kind: 'cust_deposit', amount: 3000 }),
      expect.objectContaining({ month: '2026-10', kind: 'cust_balance', amount: 4000 }),
    ]);
    expect(total({ cust_paid_usd: 7000 })).toBeCloseTo(10000);
  });
  it('counts only the part not yet in current cash, never twice', () => {
    expect(ins({ cust_paid_usd: 7000, cust_paid_in_cash_usd: 2000 }).filter(x => x.month === '2026-10')).toEqual([
      expect.objectContaining({ kind: 'cust_deposit', amount: 1000 }),
      expect.objectContaining({ kind: 'cust_balance', amount: 4000 }),
    ]);
    expect(total({ cust_paid_usd: 7000, cust_paid_in_cash_usd: 2000 })).toBeCloseTo(8000);
    expect(total({ cust_paid_usd: 7000, cust_paid_in_cash_usd: 7000 })).toBeCloseTo(3000);
    expect(odooCustReceived({ ...so, cust_paid_usd: 7000, cust_paid_in_cash_usd: 7000 })).toBe(0);
  });
});

describe('installment credit line', () => {
  it('repays an Amex draw in 6 equal payments plus 0.55% a month, from the next month', () => {
    const line = { id: 'a', name: 'Amex', limit_usd: 15300, drawn_usd: 0, rate_pct: 6.6, term_months: 6, monthly_fee_pct: 0.55 };
    const months = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05'];
    const f = creditFlows([line], [{ id: 'd', line_id: 'a', month: '2026-10', amount_usd: 15300 }], months);
    expect(f.filter(x => x.kind === 'credit_draw')).toEqual([expect.objectContaining({ month: '2026-10', amount: 15300 })]);
    const repay = f.filter(x => x.kind === 'credit_repay');
    expect(repay.map(x => x.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
    expect(repay.every(x => Math.abs(x.amount + 2550) < 1e-9)).toBe(true);
    const fees = f.filter(x => x.kind === 'credit_interest');
    expect(fees).toHaveLength(6);
    expect(Math.round(fees.reduce((s, x) => s + x.amount, 0) * 100) / 100).toBe(-504.9);
  });
});

describe('credit line maturity', () => {
  it('repays the whole balance in the maturity month and stops interest', () => {
    const f = creditFlows([{ id: 's', name: 'Sooie', limit_usd: 20000, drawn_usd: 10000, rate_pct: 5, maturity_month: '2026-11' }], [], ['2026-10', '2026-11', '2026-12']);
    expect(f.find(x => x.kind === 'credit_repay')).toMatchObject({ month: '2026-11', amount: -10000 });
    expect(f.filter(x => x.kind === 'credit_interest').map(x => x.month)).toEqual(['2026-10']);
  });
});

describe('forecast', () => {
  it('says when cash runs short and by how much at the worst point', () => {
    const fc = buildForecast({
      settings: { ...DEFAULT_SETTINGS, cash_usd: 20000, min_cash_usd: 5000, horizon_months: 6, allegro_launch_on: false },
      thisMonth: '2026-10', orders: [order()], costs: [], loans: [], loanPayments: [], creditLines: [], creditDraws: [], amazonSkus: [],
    });
    // Nov: 20,000 + 30,000 − 90,250 = −40,250 → short 45,250 against a 5,000 minimum.
    expect(fc.need?.firstMonth).toBe('2026-11');
    expect(Math.round(fc.need!.amount)).toBe(45250);
    expect(Math.round(fc.months[fc.months.length - 1].closing)).toBe(25000); // 20,000 + 5% of 100,000
  });
  it('projects net profit from orders shipping in the window, overhead and interest, not cash moves', () => {
    const fc = buildForecast({
      settings: { ...DEFAULT_SETTINGS, monthly_overhead_usd: 1000, horizon_months: 6, allegro_launch_on: false },
      thisMonth: '2026-10', orders: [order(), order({ inquiry_id: 'i2', ship_month: '2027-06' })],
      costs: [], loans: [], loanPayments: [],
      creditLines: [{ id: 'a', name: 'Amex', limit_usd: 15300, drawn_usd: 0, rate_pct: 0, term_months: 6, monthly_fee_pct: 0.55 }],
      creditDraws: [{ id: 'd', line_id: 'a', month: '2026-10', amount_usd: 15300 }],
      amazonSkus: [],
    });
    const p = fc.profit;
    expect(p.totalRevenue).toBe(100000); // the June order ships after the window
    expect(Math.round(p.grossProfit)).toBe(5000);
    expect(p.operatingProfit).toBeCloseTo(-1000);
    // Amex fee 0.55% of 15,300 for Nov–Mar; the draw and repayments aren't profit.
    expect(p.netProfit).toBeCloseTo(-1000 - 5 * 84.15);
  });
});

describe('amazon', () => {
  it('pays stock at PO, freight at ship and reorders in time to avoid running out', () => {
    const rows = simulateSku(sku(), '2027-12');
    expect(rows[0]).toMatchObject({ month: '2026-11', poUnits: 400, cashOut: 4000 });
    expect(rows[0]).toMatchObject({ onOrder: 400, stockEnd: 0 });
    expect(rows.find(r => r.month === '2027-03')).toMatchObject({ stockEnd: 300 });
    expect(rows.find(r => r.month === '2027-01')?.cashOut).toBe(800);
    expect(rows.filter(r => r.stockout)).toEqual([]);
    expect(rows.find(r => r.month === '2027-03')).toMatchObject({ sold: 100, cashIn: 100 * (50 * 0.2 + 12) });
  });
  it('reorders in time for the make + ship time, and flags stockouts when one order is too small', () => {
    const rows = simulateSku(sku({ order_qty: 600 }), '2028-06');
    expect(rows.filter(r => r.stockout)).toEqual([]);
    // 4-month lead at 100/month: reorder once stock + on the way drops under 400.
    const pos = rows.filter(r => r.poUnits).map(r => r.month);
    expect(pos.slice(0, 3)).toEqual(['2026-11', '2027-05', '2027-11']);
    expect(simulateSku(sku({ order_qty: 50 }), '2027-12').some(r => r.stockout)).toBe(true);
  });
  it('models a launch: smaller first order, lower first-batch margin, sales ramping up', () => {
    const s = sku({ first_order_qty: 150, launch_margin_pct: 0.1, launch_units_per_month: 25, ramp_months: 3 });
    expect(['2027-03', '2027-04', '2027-05', '2027-06', '2027-09'].map(m => demandFor(s, m))).toEqual([25, 50, 75, 100, 100]);
    const rows = simulateSku(s, '2027-12');
    expect(rows[0]).toMatchObject({ month: '2026-11', poUnits: 150, cashOut: 1500 });
    // March sells 25 first-batch units at 10%: 25 × 50 × 0.1 = 125 earned, plus 25 × 12 landed back.
    expect(rows.find(r => r.month === '2027-03')).toMatchObject({ sold: 25, earned: 125, cashIn: 425, poUnits: 400 });
    // Full margin once the first batch is gone.
    const late = rows.find(r => r.month === '2027-09')!;
    expect(late.earned).toBeCloseTo(late.sold * 50 * 0.2);
    // Without launch terms nothing changes.
    expect(simulateSku(sku({ first_order_qty: null, launch_units_per_month: null }), '2027-12')).toEqual(simulateSku(sku(), '2027-12'));
  });
  it('summarises peak cash and payback', () => {
    const s = scenarioSummary([sku()], '2028-06');
    expect(s.peakNeed).toBeGreaterThan(4000);
    expect(s.paybackMonth).not.toBeNull();
  });
});

describe('allegro', () => {
  it('grows by the monthly top-up', () => {
    const a = allegroProjection({ ...DEFAULT_SETTINGS, allegro_as_of: '2026-10-01' }, '2026-10', 3);
    expect(a.map(x => x.balance)).toEqual([3200, 3700, 4200]);
  });
  it('moves the $5k Amazon launch fund into DKT cash the month it gets there', () => {
    const s = { ...DEFAULT_SETTINGS, allegro_as_of: '2026-10-01' };
    const a = allegroProjection(s, '2026-10', 6);
    expect(a.map(x => x.balance)).toEqual([3200, 3700, 4200, 4700, 200, 700]);
    expect(allegroLaunchMonth(s, '2026-10', 6)).toBe('2027-02');
    const f = buildForecast({ settings: s, thisMonth: '2026-10', orders: [], costs: [], loans: [], loanPayments: [], creditLines: [], creditDraws: [], amazonSkus: [] });
    const feb = f.months.find(m => m.month === '2027-02')!;
    expect(feb.byKind).toEqual({ allegro_in: 5000 });
    expect(allegroLaunchMonth({ ...s, allegro_launch_on: false }, '2026-10', 6)).toBeNull();
  });
});
