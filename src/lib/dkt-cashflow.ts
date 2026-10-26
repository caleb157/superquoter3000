// DKT Cash Flow (/tools/dkt-cash-flow): DKT is the US entity that sells some HQ orders, keeps a
// margin and pays Parable Ventures (PV) the rest, advancing PV most of it at PO so PV stays cash
// positive. This file is the whole forecast: pure functions over typed-in DKT figures plus the HQ
// inquiries whose selling entity is DKT. Everything is USD and monthly ('YYYY-MM').
//
// Order flows (per inquiry, every open order counted at 100%):
//   customer deposit  = FOB × customer deposit %        in the PO month
//   PV advance        = FOB × (1 − DKT margin) × advance % in the PO month (DKT → PV)
//   customer balance  = FOB × (1 − customer deposit %)   in the shipping month
//   PV balance        = FOB × (1 − DKT margin) × (1 − advance %) in the shipping month
// A flow marked done is left out (it is already in current cash); one still open but dated in
// the past lands in the current month.
import { amazonSkuFlows, simulateSku, type AmazonSku } from './dkt-amazon';
import { spreadEntry, type ManualEntry } from './manual-cash-entries';

export type Month = string; // 'YYYY-MM'

export type DktSettings = {
  cash_usd: number;
  cash_as_of: string | null;
  min_cash_usd: number;
  monthly_overhead_usd: number; // one figure, charged every month
  horizon_months: number;
  default_margin_pct: number; // 0..1
  allegro_balance_usd: number;
  allegro_as_of: string | null;
  allegro_monthly_usd: number;
  allegro_launch_usd: number; // Amazon launch Allegro saves up for; it moves into DKT and is spent the month it's reached
  allegro_launch_on: boolean;
};

export const DEFAULT_SETTINGS: DktSettings = {
  cash_usd: 0, cash_as_of: null, min_cash_usd: 5000, monthly_overhead_usd: 0, horizon_months: 12,
  default_margin_pct: 0.05,
  allegro_balance_usd: 3200, allegro_as_of: null, allegro_monthly_usd: 500, allegro_launch_usd: 5000, allegro_launch_on: true,
};

export type DktOrder = {
  inquiry_id: string;
  rfq_number: string;
  title: string | null;
  customer: string | null;
  status: string;
  fob_usd: number;
  fob_source: 'projection' | 'live';
  margin_pct: number; // DKT keeps this share of FOB
  cust_deposit_pct: number; // 0..1
  advance_pct: number; // 0..1 of PV's amount, paid at PO
  po_month: Month; // customer deposit + PV advance
  ship_month: Month; // customer balance + PV balance
  done: { cust_deposit: boolean; advance: boolean; cust_balance: boolean; pv_balance: boolean };
  excluded: boolean;
};

/** A confirmed PV → DKT sales order from Odoo, with DKT's own terms for its customer side. */
export type OdooOrder = {
  name: string; // SO number
  ref: string;
  po_month: Month; // SO date: when the customer deposit is due
  ship_month: Month; // customer balance + PV's not-yet-invoiced amount
  pv_total_usd: number; // what PV bills DKT for the order
  to_invoice_usd: number; // part PV hasn't invoiced yet
  advance_usd?: number; // DKT's advance PV's Odoo applies to this order (from the not-yet-invoiced part)
  pv_paid_usd?: number; // what DKT has already paid PV on this order in total (typed in, for what Odoo doesn't show)
  margin_pct: number;
  cust_deposit_pct: number;
  cust_paid_usd?: number | null; // what the customer has paid DKT on this order so far (typed in)
  done: { cust_deposit: boolean; cust_balance: boolean }; // older ticks, used only while cust_paid_usd is blank
  excluded: boolean;
};
export type OdooInvoice = { name: string; origin: string; due_month: Month; residual_usd: number };

export type CostFrequency = 'monthly' | 'quarterly' | 'yearly' | 'once';
export type CostItem = {
  id: string;
  name: string;
  kind: 'overhead' | 'expense' | 'income';
  amount_usd: number;
  frequency: CostFrequency;
  start_month: Month | null;
  end_month: Month | null;
};

export type LoanPayment = { id: string; loan_id: string; due_date: string; principal_usd: number; interest_usd: number; paid: boolean };
export type Loan = {
  id: string;
  name: string;
  kind: 'schedule' | 'lump';
  balance_usd: number;
  rate_pct: number;
  due_month: Month | null; // lump: pay in this month
  pay_with_inquiry_id: string | null; // lump: pay when this order's customer balance arrives
  pay_with_so: string | null; // lump: or with this Odoo sales order's customer balance
  active: boolean;
  proceeds_usd?: number | null; // a loan not received yet: money DKT gets, net of fees
  proceeds_month?: Month | null; // ...and the month it arrives
};

export type CreditLine = {
  id: string; name: string; limit_usd: number; drawn_usd: number; rate_pct: number;
  maturity_month?: Month | null; // whatever is drawn is repaid in full this month
  term_months?: number | null; // installment line (e.g. Amex): each draw is repaid in this many equal monthly payments, from the next month
  monthly_fee_pct?: number | null; // ...plus this % of the draw every month (instead of yearly interest)
};
export type CreditDraw = { id: string; line_id: string; month: Month; amount_usd: number }; // + draw, − repay

export type FlowKind =
  | 'cust_deposit' | 'cust_balance' | 'pv_advance' | 'pv_balance'
  | 'income' | 'overhead' | 'expense'
  | 'loan_proceeds' | 'loan_principal' | 'loan_interest'
  | 'credit_draw' | 'credit_repay' | 'credit_interest'
  | 'amazon_in' | 'amazon_inventory' | 'amazon_freight'
  | 'allegro_in'
  | 'odoo_invoice' | 'odoo_to_invoice'
  | 'manual_in' | 'manual_out';

export type Flow = { month: Month; kind: FlowKind; amount: number; label: string; ref?: string };

export const FLOW_LABEL: Record<FlowKind, string> = {
  cust_deposit: 'Customer deposits', cust_balance: 'Customer balances', amazon_in: 'Amazon payouts', income: 'Other income',
  credit_draw: 'Credit line draws',
  pv_advance: 'Advances to PV', pv_balance: 'Balances to PV', overhead: 'Overhead', expense: 'Expenses',
  loan_proceeds: 'Loans received', loan_principal: 'Loan principal', loan_interest: 'Loan interest',
  credit_repay: 'Credit line repayments', credit_interest: 'Credit line interest',
  amazon_inventory: 'Amazon inventory (PO)', amazon_freight: 'Amazon freight',
  allegro_in: 'From Allegro (Amazon launch)',
  odoo_invoice: 'PV invoices due (Odoo)', odoo_to_invoice: 'PV orders not yet invoiced (Odoo)',
  manual_in: 'Manual income', manual_out: 'Manual expenses',
};
export const IN_KINDS: FlowKind[] = ['cust_deposit', 'cust_balance', 'amazon_in', 'income', 'loan_proceeds', 'allegro_in', 'credit_draw', 'manual_in'];
export const OUT_KINDS: FlowKind[] = [
  'odoo_invoice', 'odoo_to_invoice', 'pv_advance', 'pv_balance', 'overhead', 'expense', 'loan_principal', 'loan_interest',
  'credit_interest', 'credit_repay', 'amazon_inventory', 'amazon_freight', 'manual_out',
];

// ---------- Months ----------
export const toMonth = (d: string | null | undefined): Month | null => (d ? d.slice(0, 7) : null);
export function addMonths(m: Month, n: number): Month {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export const monthDiff = (a: Month, b: Month) => {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};
export const monthRange = (start: Month, n: number): Month[] => Array.from({ length: n }, (_, i) => addMonths(start, i));
export function monthLabel(m: Month, withYear = true): string {
  const d = new Date(`${m}-01T00:00:00Z`);
  return d.toLocaleString('en-US', { month: 'short', ...(withYear ? { year: '2-digit' } : {}), timeZone: 'UTC' });
}

// ---------- Orders ----------
export function orderAmounts(o: Pick<DktOrder, 'fob_usd' | 'margin_pct' | 'cust_deposit_pct' | 'advance_pct'>) {
  const pvTotal = o.fob_usd * (1 - o.margin_pct);
  return {
    custDeposit: o.fob_usd * o.cust_deposit_pct,
    custBalance: o.fob_usd * (1 - o.cust_deposit_pct),
    pvAdvance: pvTotal * o.advance_pct,
    pvBalance: pvTotal * (1 - o.advance_pct),
    pvTotal,
    margin: o.fob_usd * o.margin_pct,
    // What DKT has to fund between PO and shipping (advance minus what the customer paid up front).
    gap: Math.max(0, pvTotal * o.advance_pct - o.fob_usd * o.cust_deposit_pct),
  };
}

export function orderFlows(o: DktOrder, thisMonth: Month): Flow[] {
  if (o.excluded || !(o.fob_usd > 0)) return [];
  const a = orderAmounts(o);
  const at = (m: Month) => (m < thisMonth ? thisMonth : m);
  const ref = o.inquiry_id;
  const label = `${o.rfq_number}${o.customer ? ` · ${o.customer}` : ''}`;
  const out: Flow[] = [];
  if (!o.done.cust_deposit && a.custDeposit) out.push({ month: at(o.po_month), kind: 'cust_deposit', amount: a.custDeposit, label, ref });
  if (!o.done.advance && a.pvAdvance) out.push({ month: at(o.po_month), kind: 'pv_advance', amount: -a.pvAdvance, label, ref });
  if (!o.done.cust_balance && a.custBalance) out.push({ month: at(o.ship_month), kind: 'cust_balance', amount: a.custBalance, label, ref });
  if (!o.done.pv_balance && a.pvBalance) out.push({ month: at(o.ship_month), kind: 'pv_balance', amount: -a.pvBalance, label, ref });
  return out;
}

// ---------- Odoo orders (PV → DKT, already confirmed) ----------
/** FOB the end customer pays DKT: PV's bill grossed up by DKT's margin. */
export const odooFob = (o: Pick<OdooOrder, 'pv_total_usd' | 'margin_pct'>) => (o.margin_pct < 1 ? o.pv_total_usd / (1 - o.margin_pct) : o.pv_total_usd);

const origins = (inv: OdooInvoice) => inv.origin.split(',').map(s => s.trim()).filter(Boolean);

/**
 * What DKT still owes PV on an order: Odoo's open amount (unpaid invoices + not yet invoiced, less the
 * DKT advance PV's Odoo applies to the order, earliest order first as in PV's cash flow), capped by the
 * order total minus anything DKT says it has paid that Odoo doesn't show.
 */
export function odooOwed(o: OdooOrder, invoices: OdooInvoice[]): number {
  const open = invoices.reduce((s, i) => s + Math.max(0, i.residual_usd), 0) + Math.max(0, o.to_invoice_usd - Math.max(0, o.advance_usd ?? 0));
  const paid = Math.max(0, o.pv_paid_usd ?? 0);
  return paid > 0 ? Math.max(0, Math.min(open, o.pv_total_usd - paid)) : open;
}

/** Everything DKT has paid PV on the order: the order total less what's still owed. */
export const odooPaid = (o: OdooOrder, invoices: OdooInvoice[]) => Math.max(0, o.pv_total_usd - odooOwed(o, invoices));

/** What the customer has paid DKT: the typed amount, else what the older deposit/balance ticks imply. */
export function odooCustPaid(o: OdooOrder): number {
  if (o.cust_paid_usd != null) return Math.max(0, o.cust_paid_usd);
  const fob = odooFob(o);
  return o.done.cust_balance ? fob : o.done.cust_deposit ? fob * o.cust_deposit_pct : 0;
}

/**
 * PV's side comes straight from Odoo: each unpaid invoice is paid by its due date, and whatever PV
 * hasn't invoiced yet is paid in the ship month, less anything DKT has already paid PV (odooOwed),
 * earliest payments first. The customer pays the deposit now and the rest in the ship month.
 */
export function odooFlows(orders: OdooOrder[], invoices: OdooInvoice[], thisMonth: Month): Flow[] {
  const at = (m: Month) => (m < thisMonth ? thisMonth : m);
  const out: Flow[] = [];
  const names = new Set(orders.map(o => o.name));
  const invLabel = (inv: OdooInvoice) => `${inv.name}${inv.origin ? ` · ${inv.origin}` : ''}`;
  // Invoices with no open order are paid as they stand.
  for (const inv of invoices) {
    if (!(inv.residual_usd > 0) || origins(inv).some(s => names.has(s))) continue;
    out.push({ month: at(inv.due_month), kind: 'odoo_invoice', amount: -inv.residual_usd, label: invLabel(inv), ref: inv.name });
  }
  for (const o of orders) {
    if (o.excluded) continue;
    const label = `${o.name}${o.ref ? ` · ${o.ref}` : ''}`;
    const mine = invoices.filter(i => i.residual_usd > 0 && origins(i).find(s => names.has(s)) === o.name)
      .sort((a, b) => a.due_month.localeCompare(b.due_month));
    let left = odooOwed(o, mine);
    for (const inv of mine) {
      const pay = Math.min(inv.residual_usd, left);
      left -= pay;
      if (pay > 0) out.push({ month: at(inv.due_month), kind: 'odoo_invoice', amount: -pay, label: invLabel(inv), ref: inv.name });
    }
    const rest = Math.min(Math.max(0, o.to_invoice_usd - Math.max(0, o.advance_usd ?? 0)), left);
    if (rest > 0) out.push({ month: at(o.ship_month), kind: 'odoo_to_invoice', amount: -rest, label, ref: o.name });
    // The customer's deposit is due now (the order is confirmed), the rest in the ship month; what
    // they've already paid counts against the deposit first.
    const fob = odooFob(o), paid = odooCustPaid(o), dep = fob * o.cust_deposit_pct;
    if (dep - paid > 0.5) out.push({ month: at(o.po_month), kind: 'cust_deposit', amount: dep - paid, label, ref: o.name });
    const bal = fob - Math.max(paid, dep);
    if (bal > 0.5) out.push({ month: at(o.ship_month), kind: 'cust_balance', amount: bal, label, ref: o.name });
  }
  return out;
}

// ---------- Overhead, expenses, other income ----------
const STEP: Record<CostFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12, once: 0 };
export function costFlows(c: CostItem, months: Month[]): Flow[] {
  if (!(c.amount_usd > 0) || !months.length) return [];
  const start = c.start_month ?? months[0];
  const sign = c.kind === 'income' ? 1 : -1;
  const out: Flow[] = [];
  for (const m of months) {
    if (m < start || (c.end_month && m > c.end_month)) continue;
    const step = STEP[c.frequency];
    const hit = step === 0 ? m === start : monthDiff(start, m) % step === 0;
    if (hit) out.push({ month: m, kind: c.kind, amount: sign * c.amount_usd, label: c.name, ref: c.id });
  }
  return out;
}

/** A manual entry: all in its month, or split evenly from its date to its end date. */
export function manualFlows(e: ManualEntry, months: Month[]): Flow[] {
  return spreadEntry(e, months).map(({ month, amount }) =>
    ({ month, kind: amount >= 0 ? 'manual_in' as const : 'manual_out' as const, amount, label: e.name || 'Manual entry', ref: e.id }));
}

/** Overhead is one monthly figure, charged in every month of the forecast. */
export function overheadFlows(perMonth: number, months: Month[]): Flow[] {
  if (!(perMonth > 0)) return [];
  return months.map(m => ({ month: m, kind: 'overhead' as const, amount: -perMonth, label: 'Monthly overhead' }));
}

// ---------- Loans ----------
export function loanFlows(loan: Loan, payments: LoanPayment[], orders: DktOrder[], thisMonth: Month, odooOrders: OdooOrder[] = []): Flow[] {
  if (!loan.active) return [];
  const at = (m: Month) => (m < thisMonth ? thisMonth : m);
  // A loan still to come: its money arrives in the proceeds month. Once that month has passed it's in current cash.
  const proceeds = loan.proceeds_usd && loan.proceeds_usd > 0 && loan.proceeds_month && loan.proceeds_month >= thisMonth
    ? [{ month: loan.proceeds_month, kind: 'loan_proceeds' as const, amount: loan.proceeds_usd, label: loan.name, ref: loan.id }] : [];
  if (loan.kind === 'schedule') {
    const out: Flow[] = [...proceeds];
    for (const p of payments) {
      if (p.loan_id !== loan.id || p.paid) continue;
      const m = at(p.due_date.slice(0, 7));
      if (p.principal_usd) out.push({ month: m, kind: 'loan_principal', amount: -p.principal_usd, label: loan.name, ref: loan.id });
      if (p.interest_usd) out.push({ month: m, kind: 'loan_interest', amount: -p.interest_usd, label: loan.name, ref: loan.id });
    }
    return out;
  }
  const month = lumpLoanMonth(loan, orders, odooOrders);
  if (!month || !(loan.balance_usd > 0)) return proceeds;
  return [...proceeds, { month: at(month), kind: 'loan_principal', amount: -loan.balance_usd, label: loan.name, ref: loan.id }];
}

/** When a lump loan is planned to be repaid: with its linked order's customer balance, else its due month. */
export function lumpLoanMonth(loan: Loan, orders: DktOrder[], odooOrders: OdooOrder[] = []): Month | null {
  if (loan.pay_with_so) {
    const o = odooOrders.find(x => x.name === loan.pay_with_so);
    if (o) return o.ship_month;
  }
  if (loan.pay_with_inquiry_id) {
    const o = orders.find(x => x.inquiry_id === loan.pay_with_inquiry_id);
    if (o) return o.ship_month;
  }
  return loan.due_month;
}

/** Unpaid principal still owed on a loan (scheduled loans: sum of unpaid principal). */
export function loanOutstanding(loan: Loan, payments: LoanPayment[]): number {
  if (loan.kind === 'lump') return loan.balance_usd;
  const unpaid = payments.filter(p => p.loan_id === loan.id && !p.paid).reduce((s, p) => s + p.principal_usd, 0);
  return unpaid || loan.balance_usd;
}

// ---------- Credit lines ----------
/** Planned draws/repayments plus monthly interest on each line's running balance (rate ÷ 12). */
const isInstallment = (l: CreditLine) => (Number(l.term_months) || 0) > 0;

/** An installment line's draws, each repaid in term_months equal parts from the month after, plus a flat monthly fee on the draw. */
function installmentFlows(line: CreditLine, draws: CreditDraw[], months: Month[]): Flow[] {
  const out: Flow[] = [];
  const n = Math.round(Number(line.term_months));
  const fee = (Number(line.monthly_fee_pct) || 0) / 100;
  const last = months[months.length - 1];
  for (const d of draws.filter(x => x.line_id === line.id && x.amount_usd > 0 && months.includes(x.month))) {
    out.push({ month: d.month, kind: 'credit_draw', amount: d.amount_usd, label: line.name, ref: line.id });
    for (let k = 1; k <= n; k++) {
      const m = addMonths(d.month, k);
      if (m > last) break;
      out.push({ month: m, kind: 'credit_repay', amount: -d.amount_usd / n, label: line.name, ref: line.id });
      if (fee > 0) out.push({ month: m, kind: 'credit_interest', amount: -d.amount_usd * fee, label: `${line.name} fee`, ref: line.id });
    }
  }
  return out;
}

export function creditFlows(lines: CreditLine[], draws: CreditDraw[], months: Month[]): Flow[] {
  const out: Flow[] = [];
  if (!months.length) return out;
  for (const line of lines) {
    if (isInstallment(line)) { out.push(...installmentFlows(line, draws, months)); continue; }
    let bal = line.drawn_usd;
    const mine = draws.filter(d => d.line_id === line.id);
    // Draws planned before the window are assumed to be in drawn_usd already.
    for (const m of months) {
      for (const d of mine.filter(x => x.month === m)) {
        const amt = d.amount_usd < 0 ? -Math.min(-d.amount_usd, bal) : d.amount_usd;
        if (!amt) continue;
        bal += amt;
        out.push({ month: m, kind: amt > 0 ? 'credit_draw' : 'credit_repay', amount: amt, label: line.name, ref: line.id });
      }
      if (line.maturity_month && m === line.maturity_month && bal > 0) {
        out.push({ month: m, kind: 'credit_repay', amount: -bal, label: `${line.name} (due in full)`, ref: line.id });
        bal = 0;
      }
      const interest = bal * (line.rate_pct / 100) / 12;
      if (interest > 0.005) out.push({ month: m, kind: 'credit_interest', amount: -interest, label: line.name, ref: line.id });
    }
  }
  return out;
}

export function creditBalances(lines: CreditLine[], draws: CreditDraw[], months: Month[]): Record<string, number[]> {
  const res: Record<string, number[]> = {};
  for (const line of lines) {
    let bal = line.drawn_usd;
    if (isInstallment(line)) {
      const f = installmentFlows(line, draws, months);
      res[line.id] = months.map(m => {
        for (const x of f) if (x.month === m && x.kind !== 'credit_interest') bal = Math.max(0, bal + x.amount);
        return bal;
      });
      continue;
    }
    res[line.id] = months.map(m => {
      for (const d of draws.filter(x => x.line_id === line.id && x.month === m)) bal = Math.max(0, bal + d.amount_usd);
      if (line.maturity_month && m === line.maturity_month) bal = 0;
      return bal;
    });
  }
  return res;
}

// ---------- Forecast ----------
export type ForecastInput = {
  settings: DktSettings;
  thisMonth: Month;
  orders: DktOrder[];
  costs: CostItem[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  creditLines: CreditLine[];
  creditDraws: CreditDraw[];
  amazonSkus: AmazonSku[]; // only SKUs in scenarios switched into the forecast
  odooOrders?: OdooOrder[];
  odooInvoices?: OdooInvoice[];
  /** Manual entries typed under the forecast chart (USD). */
  manual?: ManualEntry[];
};

export type ForecastMonth = {
  month: Month;
  opening: number;
  byKind: Partial<Record<FlowKind, number>>;
  inflow: number;
  outflow: number;
  net: number;
  closing: number;
  shortBy: number; // how far closing is under the minimum cash
};

export type Forecast = {
  months: ForecastMonth[];
  flows: Flow[];
  /** First month below the minimum, and the cash needed by then to stay at the minimum all year. */
  need: { firstMonth: Month; peakMonth: Month; amount: number } | null;
  lowest: { month: Month; closing: number } | null;
  creditHeadroom: number;
  profit: ProfitProjection;
};

export function buildForecast(inp: ForecastInput): Forecast {
  const n = Math.max(1, Math.min(36, Math.round(inp.settings.horizon_months || 12)));
  const months = monthRange(inp.thisMonth, n);
  const last = months[months.length - 1];
  const flows: Flow[] = [
    ...inp.orders.flatMap(o => orderFlows(o, inp.thisMonth)),
    ...odooFlows(inp.odooOrders ?? [], inp.odooInvoices ?? [], inp.thisMonth),
    ...overheadFlows(Number(inp.settings.monthly_overhead_usd) || 0, months),
    ...inp.costs.filter(c => c.kind !== 'overhead').flatMap(c => costFlows(c, months)),
    ...inp.loans.flatMap(l => loanFlows(l, inp.loanPayments, inp.orders, inp.thisMonth, inp.odooOrders ?? [])),
    ...creditFlows(inp.creditLines, inp.creditDraws, months),
    ...inp.amazonSkus.flatMap(s => amazonSkuFlows(s, inp.thisMonth, last)),
    ...allegroLaunchFlows(inp.settings, inp.thisMonth, n),
    ...(inp.manual ?? []).flatMap(e => manualFlows(e, months)),
  ].filter(f => f.month <= last);

  let cash = Number(inp.settings.cash_usd) || 0;
  const min = Number(inp.settings.min_cash_usd) || 0;
  const rows: ForecastMonth[] = months.map(m => {
    const byKind: Partial<Record<FlowKind, number>> = {};
    let inflow = 0, outflow = 0;
    for (const f of flows) {
      if (f.month !== m) continue;
      byKind[f.kind] = (byKind[f.kind] || 0) + f.amount;
      if (f.amount >= 0) inflow += f.amount; else outflow += -f.amount;
    }
    const opening = cash;
    cash = opening + inflow - outflow;
    return { month: m, opening, byKind, inflow, outflow, net: inflow - outflow, closing: cash, shortBy: Math.max(0, min - cash) };
  });

  const short = rows.filter(r => r.shortBy > 0.5);
  const peak = short.reduce<ForecastMonth | null>((a, r) => (!a || r.shortBy > a.shortBy ? r : a), null);
  const lowest = rows.reduce<ForecastMonth | null>((a, r) => (!a || r.closing < a.closing ? r : a), null);
  const bal = creditBalances(inp.creditLines, inp.creditDraws, months);
  const creditHeadroom = inp.creditLines.reduce((s, l) => s + Math.max(0, l.limit_usd - (bal[l.id]?.[bal[l.id].length - 1] ?? l.drawn_usd)), 0);
  return {
    months: rows,
    flows,
    need: short.length && peak ? { firstMonth: short[0].month, peakMonth: peak.month, amount: peak.shortBy } : null,
    lowest: lowest ? { month: lowest.month, closing: lowest.closing } : null,
    creditHeadroom,
    profit: profitProjection(inp, months, flows),
  };
}

// ---------- Net profit (earned, not cash) ----------
export type ProfitItem = { month: Month; label: string; amount: number };
export type ProfitLine = { key: string; label: string; amount: number; items: ProfitItem[] };
export type ProfitProjection = {
  from: Month;
  to: Month;
  revenue: ProfitLine[];
  costOfSales: ProfitLine[];
  operating: ProfitLine[];
  interest: ProfitLine[];
  totalRevenue: number;
  grossProfit: number;
  operatingProfit: number;
  netProfit: number;
};

const line = (key: string, label: string, items: ProfitItem[]): ProfitLine =>
  ({ key, label, items, amount: items.reduce((t, i) => t + i.amount, 0) });
const fromFlows = (flows: Flow[], kinds: FlowKind[]): ProfitItem[] =>
  flows.filter(f => kinds.includes(f.kind)).map(f => ({ month: f.month, label: f.label, amount: f.amount }));

/**
 * What DKT earns over the forecast months, counted when it's earned rather than when cash moves:
 * an HQ order earns the customer's FOB minus PV's bill in its ship month; Amazon earns price × net
 * margin on each unit sold (stock bought is a cost only once sold); other income, overhead, expenses
 * and interest as they fall. Loans, credit draws and repayments, Allegro and stock purchases are cash
 * only, not profit. Before tax.
 */
export function profitProjection(inp: ForecastInput, months: Month[], allFlows: Flow[]): ProfitProjection {
  const from = months[0], to = months[months.length - 1];
  const inWindow = (m: Month) => m >= from && m <= to;
  const flows = allFlows.filter(f => inWindow(f.month));
  const at = (m: Month) => (m < inp.thisMonth ? inp.thisMonth : m);
  const hqRev: ProfitItem[] = [], hqCost: ProfitItem[] = [];
  for (const o of inp.orders) {
    const m = at(o.ship_month);
    if (o.excluded || !(o.fob_usd > 0) || !inWindow(m)) continue;
    const a = orderAmounts(o);
    const label = `${o.rfq_number}${o.customer ? ` · ${o.customer}` : ''} (pipeline)`;
    hqRev.push({ month: m, label, amount: o.fob_usd });
    hqCost.push({ month: m, label, amount: -a.pvTotal });
  }
  for (const o of inp.odooOrders ?? []) {
    const m = at(o.ship_month);
    if (o.excluded || !(o.pv_total_usd > 0) || !inWindow(m)) continue;
    const label = `${o.name}${o.ref ? ` · ${o.ref}` : ''}`;
    hqRev.push({ month: m, label, amount: odooFob(o) });
    hqCost.push({ month: m, label, amount: -o.pv_total_usd });
  }
  const azRev: ProfitItem[] = [], azCost: ProfitItem[] = [];
  for (const s of inp.amazonSkus) {
    const price = Number(s.price_usd) || 0;
    for (const r of simulateSku(s, to)) {
      if (!inWindow(r.month) || !(r.sold > 0)) continue;
      azRev.push({ month: r.month, label: s.name, amount: r.sold * price });
      azCost.push({ month: r.month, label: s.name, amount: r.earned - r.sold * price });
    }
  }
  const revenue = [
    line('hq', 'HQ orders (customer price)', hqRev),
    line('amazon', 'Amazon sales', azRev),
    line('income', 'Other income', fromFlows(flows, ['income'])),
  ];
  const costOfSales = [
    line('pv', 'Paid to PV for those orders', hqCost),
    line('amazon_cost', 'Amazon fees, stock and freight on units sold', azCost),
  ];
  const operating = [
    line('overhead', 'Overhead', fromFlows(flows, ['overhead'])),
    line('expense', 'Expenses', fromFlows(flows, ['expense'])),
  ];
  const interest = [
    line('loan_interest', 'Loan interest', fromFlows(flows, ['loan_interest'])),
    line('credit_interest', 'Credit line interest and fees', fromFlows(flows, ['credit_interest'])),
  ];
  const sum = (ls: ProfitLine[]) => ls.reduce((t, l) => t + l.amount, 0);
  const totalRevenue = sum(revenue);
  const grossProfit = totalRevenue + sum(costOfSales);
  const operatingProfit = grossProfit + sum(operating);
  return { from, to, revenue, costOfSales, operating, interest, totalRevenue, grossProfit, operatingProfit, netProfit: operatingProfit + sum(interest) };
}

// ---------- Allegro (emergency fund, outside DKT cash) ----------
export type AllegroMonth = { month: Month; balance: number; added: number; launch: number };
/**
 * Allegro grows by its monthly top-up (money from outside DKT). It stays out of DKT's forecast
 * except for the planned Amazon launch: the first month the balance reaches the launch amount,
 * that amount moves into DKT (once). The launch's costs are the Amazon tab's SKUs.
 */
export function allegroProjection(settings: DktSettings, thisMonth: Month, n: number): AllegroMonth[] {
  const months = monthRange(thisMonth, n);
  // The balance is as of allegro_as_of; months already passed since then have had their top-up.
  let bal = Number(settings.allegro_balance_usd) || 0;
  const add = Number(settings.allegro_monthly_usd) || 0;
  const asOf = toMonth(settings.allegro_as_of) ?? thisMonth;
  const gap = Math.max(0, monthDiff(asOf, thisMonth));
  bal += gap * add;
  const target = settings.allegro_launch_on ? Number(settings.allegro_launch_usd) || 0 : 0;
  let launched = target <= 0;
  return months.map((m, i) => {
    const added = i === 0 ? 0 : add;
    bal += added;
    let launch = 0;
    if (!launched && bal >= target - 0.005) { launch = target; bal -= target; launched = true; }
    return { month: m, balance: bal, added, launch };
  });
}

/** The month Allegro can fund the Amazon launch, or null if it doesn't get there in n months. */
export function allegroLaunchMonth(settings: DktSettings, thisMonth: Month, n: number): Month | null {
  return allegroProjection(settings, thisMonth, n).find(r => r.launch > 0)?.month ?? null;
}

export function allegroLaunchFlows(settings: DktSettings, thisMonth: Month, n: number): Flow[] {
  const r = allegroProjection(settings, thisMonth, n).find(x => x.launch > 0);
  if (!r) return [];
  // Only the money in: the launch's costs come from the Amazon tab's SKUs.
  return [{ month: r.month, kind: 'allegro_in', amount: r.launch, label: 'Allegro fund for Amazon launch' }];
}
