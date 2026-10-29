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
  cust_paid_in_cash_usd?: number | null; // how much of that is already in "Current cash" (set when current cash is saved)
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
  balloon?: boolean | null; // revolving: interest builds up and is paid with the principal in the "due in full" month (Sooie)
};
export type CreditDraw = {
  id: string; line_id: string; month: Month; amount_usd: number; // + draw, − repay
  actual?: boolean; // a real draw already taken (drives what's drawn today); otherwise a planned what-if
  draw_date?: string | null; // real draws: the day it was drawn (YYYY-MM-DD)
  // The draw's own terms, seeded from its line; blank uses the line's.
  term_months?: number | null; monthly_fee_pct?: number | null; rate_pct?: number | null; maturity_month?: Month | null;
  balloon?: boolean | null;
  notes?: string | null;
};

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
 * Customer money received since "Current cash" was last typed: it isn't in the bank figure yet, so the
 * forecast adds it this month. Older tick-based payments are taken as already in cash.
 */
export function odooCustReceived(o: OdooOrder): number {
  if (o.cust_paid_usd == null) return 0;
  return Math.max(0, odooCustPaid(o) - Math.max(0, o.cust_paid_in_cash_usd ?? 0));
}

/**
 * PV's side comes straight from Odoo: each unpaid invoice is paid by its due date, and whatever PV
 * hasn't invoiced yet is paid in the ship month, less anything DKT has already paid PV (odooOwed),
 * earliest payments first. The customer pays the deposit now and the rest in the ship month; money the
 * customer has paid since current cash was typed comes in this month.
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
    // Received but not yet in current cash: the deposit part first, any more against the balance.
    const got = odooCustReceived(o);
    if (got > 0.5) {
      const before = paid - got;
      const toDep = Math.max(0, Math.min(paid, dep) - Math.min(before, dep));
      const rcv = `${label} · received`;
      if (toDep > 0.5) out.push({ month: thisMonth, kind: 'cust_deposit', amount: toDep, label: rcv, ref: o.name });
      if (got - toDep > 0.5) out.push({ month: thisMonth, kind: 'cust_balance', amount: got - toDep, label: rcv, ref: o.name });
    }
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
// Every draw is its own tranche with its own terms: a draw's own term_months / monthly_fee_pct /
// rate_pct / maturity_month win, and anything left blank falls back to its line's. A tranche with
// term_months is repaid in that many equal payments from the month after it was drawn, plus the
// monthly fee on the draw; without one it accrues rate ÷ 12 each month until its "due in full"
// month or a repayment (or, as a balloon, builds up and is paid with the principal in that month);
// a "due in full" month also ends an installment draw early. Real draws
// (actual) are what's owed today; planned ones are what-ifs.
const isInstallment = (l: { term_months?: number | null }) => (Number(l.term_months) || 0) > 0;

export type DrawTerms = { term_months: number | null; monthly_fee_pct: number | null; rate_pct: number; maturity_month: Month | null; balloon: boolean };
/** A draw's terms. A real draw keeps its own (seeded from the line when it was recorded; blank means
 *  none); a planned draw uses its line's wherever it has none of its own. */
export function drawTerms(line: CreditLine, d?: Partial<CreditDraw>): DrawTerms {
  if (d?.actual) {
    return { term_months: d.term_months ?? null, monthly_fee_pct: d.monthly_fee_pct ?? null, rate_pct: Number(d.rate_pct ?? line.rate_pct) || 0, maturity_month: d.maturity_month ?? null, balloon: !!d.balloon };
  }
  const pick = <T,>(own: T | null | undefined, fallback: T | null | undefined) => (own != null ? own : fallback ?? null);
  return {
    term_months: pick(d?.term_months, line.term_months),
    monthly_fee_pct: pick(d?.monthly_fee_pct, line.monthly_fee_pct),
    rate_pct: Number(pick(d?.rate_pct, line.rate_pct)) || 0,
    maturity_month: pick(d?.maturity_month, line.maturity_month),
    balloon: !!pick(d?.balloon, line.balloon),
  };
}

/** Short description of a draw's terms, e.g. "6 payments + 0.55%/mo" or "5%/yr, due Mar 2027". */
export function termsLabel(t: DrawTerms): string {
  if (isInstallment(t)) return `${Math.round(Number(t.term_months))} monthly payments${Number(t.monthly_fee_pct) ? ` + ${t.monthly_fee_pct}%/mo fee` : ''}`;
  if (t.balloon) return `${t.rate_pct}%/yr, principal + interest${t.maturity_month ? ` due ${monthLabel(t.maturity_month)}` : ' at the end'} (balloon)`;
  return [`${t.rate_pct}%/yr`, t.maturity_month ? `due ${monthLabel(t.maturity_month)}` : null].filter(Boolean).join(', ');
}

export const dayLabel = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};
/** How a real draw is named in the forecast: "Amex draw 29 Oct". */
export const drawName = (line: CreditLine, d: CreditDraw) => `${line.name} draw ${d.draw_date ? dayLabel(d.draw_date) : monthLabel(d.month)}`;

type Tranche = {
  draw?: CreditDraw; start: Month; amount: number; left: number; open: number; t: DrawTerms; label: string; planned: boolean;
  accrued: number; // balloon: interest built up and not yet paid
};
type LineSim = { flows: Flow[]; opening: number; balances: number[]; tranches: Tranche[] };

/**
 * Runs one line over the forecast window. Real draws dated before or this month are already owed
 * at the start (their earlier installments already paid); a real draw counts as cash in only when
 * it's dated after "cash in the bank" was last saved (cashAsOf), since before that it's in the
 * balance typed there. drawn_usd is a balance typed by hand before draws were recorded.
 */
function simulateLine(line: CreditLine, draws: CreditDraw[], months: Month[], cashAsOf?: string | null): LineSim {
  const flows: Flow[] = [];
  const tranches: Tranche[] = [];
  const m0 = months[0];
  const mine = draws.filter(d => d.line_id === line.id && d.amount_usd).sort((a, b) => (a.draw_date || a.month).localeCompare(b.draw_date || b.month));
  const lineTerms = drawTerms(line);
  const revolving = () => tranches.filter(x => !isInstallment(x.t) && x.left > 0.005);
  /** Pays `amt` off revolving tranches, oldest first; returns what was actually owed. */
  const repay = (amt: number) => {
    let rest = amt;
    for (const x of revolving()) { const p = Math.min(rest, x.left); x.left -= p; rest -= p; if (rest <= 0.005) break; }
    return amt - rest;
  };
  const inCash = (d: CreditDraw) => !cashAsOf || (d.draw_date || `${d.month}-01`) <= cashAsOf;

  if (line.drawn_usd > 0) tranches.push({ start: m0, amount: line.drawn_usd, left: line.drawn_usd, open: line.drawn_usd, t: { ...lineTerms, term_months: null }, label: line.name, planned: false, accrued: 0 });

  // Real draws up to this month: what's still owed at the start of the window.
  for (const d of mine.filter(x => x.actual && x.month <= m0)) {
    const t = drawTerms(line, d);
    if (d.amount_usd < 0) {
      repay(-d.amount_usd);
      if (d.month === m0 && !inCash(d)) flows.push({ month: m0, kind: 'credit_repay', amount: d.amount_usd, label: `${line.name} repayment`, ref: line.id });
      continue;
    }
    let left = d.amount_usd;
    if (isInstallment(t)) {
      const n = Math.round(Number(t.term_months));
      for (let k = 1; k <= n; k++) if (addMonths(d.month, k) < m0) left -= d.amount_usd / n;
    }
    if (t.maturity_month && t.maturity_month < m0) left = 0;
    if (left <= 0.005) continue;
    // A balloon draw's interest from the month it was drawn up to this month is still owed.
    const accrued = t.balloon && !isInstallment(t) ? left * t.rate_pct / 100 / 12 * Math.max(0, monthDiff(d.month, m0)) : 0;
    tranches.push({ draw: d, start: d.month, amount: d.amount_usd, left, open: left, t, label: drawName(line, d), planned: false, accrued });
    if (d.month === m0 && !inCash(d)) flows.push({ month: m0, kind: 'credit_draw', amount: d.amount_usd, label: `${drawName(line, d)} (${termsLabel(t)})`, ref: line.id });
  }
  const opening = tranches.reduce((s, x) => s + x.left, 0);

  const balances = months.map(m => {
    // Planned draws (and any real ones dated later) this month.
    for (const d of mine.filter(x => x.month === m && (!x.actual || x.month > m0))) {
      const t = drawTerms(line, d);
      if (d.amount_usd < 0) {
        const paid = repay(-d.amount_usd);
        if (paid > 0.005) flows.push({ month: m, kind: 'credit_repay', amount: -paid, label: line.name, ref: line.id });
        continue;
      }
      const label = d.actual ? drawName(line, d) : line.name;
      tranches.push({ draw: d, start: m, amount: d.amount_usd, left: d.amount_usd, open: 0, t, label, planned: !d.actual, accrued: 0 });
      flows.push({ month: m, kind: 'credit_draw', amount: d.amount_usd, label: d.actual ? `${label} (${termsLabel(t)})` : label, ref: line.id });
    }
    for (const x of tranches) {
      if (x.left <= 0.005) continue;
      if (isInstallment(x.t)) {
        if (x.t.maturity_month && x.t.maturity_month === m) {
          // Whatever installments are left are due in full this month.
          flows.push({ month: m, kind: 'credit_repay', amount: -x.left, label: `${x.label} (due in full)`, ref: line.id });
          const fee = monthDiff(x.start, m) >= 1 ? x.amount * (Number(x.t.monthly_fee_pct) || 0) / 100 : 0;
          if (fee > 0) flows.push({ month: m, kind: 'credit_interest', amount: -fee, label: `${x.label} fee`, ref: line.id });
          x.left = 0;
          continue;
        }
        const n = Math.round(Number(x.t.term_months));
        const k = monthDiff(x.start, m);
        if (k < 1 || k > n) continue;
        const pay = Math.min(x.left, x.amount / n);
        x.left -= pay;
        flows.push({ month: m, kind: 'credit_repay', amount: -pay, label: x.label, ref: line.id });
        const fee = x.amount * (Number(x.t.monthly_fee_pct) || 0) / 100;
        if (fee > 0) flows.push({ month: m, kind: 'credit_interest', amount: -fee, label: `${x.label} fee`, ref: line.id });
      }
    }
    // Revolving: due in full, then interest on what's left (one interest row per line, as before).
    let interest = 0;
    for (const x of revolving()) {
      if (x.t.maturity_month && x.t.maturity_month === m) {
        flows.push({ month: m, kind: 'credit_repay', amount: -x.left, label: `${x.label} (due in full)`, ref: line.id });
        if (x.accrued > 0.005) flows.push({ month: m, kind: 'credit_interest', amount: -x.accrued, label: `${x.label} interest (balloon)`, ref: line.id });
        x.left = 0; x.accrued = 0;
        continue;
      }
      if (x.t.balloon) x.accrued += x.left * x.t.rate_pct / 100 / 12;
      else interest += x.left * x.t.rate_pct / 100 / 12;
    }
    if (interest > 0.005) flows.push({ month: m, kind: 'credit_interest', amount: -interest, label: line.name, ref: line.id });
    return tranches.reduce((s, x) => s + Math.max(0, x.left), 0);
  });
  return { flows, opening, balances, tranches };
}

export function creditFlows(lines: CreditLine[], draws: CreditDraw[], months: Month[], cashAsOf?: string | null): Flow[] {
  if (!months.length) return [];
  return lines.flatMap(line => simulateLine(line, draws, months, cashAsOf).flows);
}

/** What's drawn on each line at the end of each forecast month. */
export function creditBalances(lines: CreditLine[], draws: CreditDraw[], months: Month[]): Record<string, number[]> {
  const res: Record<string, number[]> = {};
  if (!months.length) return res;
  for (const line of lines) res[line.id] = simulateLine(line, draws, months).balances;
  return res;
}

/** What's owed on each line today: real draws not yet repaid, plus any balance typed by hand. */
export function creditDrawnToday(lines: CreditLine[], draws: CreditDraw[], thisMonth: Month): Record<string, number> {
  return Object.fromEntries(lines.map(l => [l.id, simulateLine(l, draws, [thisMonth]).opening]));
}

export type DrawStatus = { draw: CreditDraw; line: CreditLine; terms: DrawTerms; left: number; next: { month: Month; amount: number } | null };
/** Each real draw with its terms, what's still owed on it today and its next payment (repayment + fee). */
export function realDrawStatus(lines: CreditLine[], draws: CreditDraw[], months: Month[]): DrawStatus[] {
  const out: DrawStatus[] = [];
  if (!months.length) return out;
  for (const line of lines) {
    const sim = simulateLine(line, draws, months);
    for (const d of draws.filter(x => x.line_id === line.id && x.actual && x.amount_usd > 0)) {
      const tr = sim.tranches.find(x => x.draw?.id === d.id);
      const pay = tr ? sim.flows.find(f => f.kind === 'credit_repay' && (f.label === tr.label || f.label === `${tr.label} (due in full)`)) : undefined;
      const fee = pay ? sim.flows.filter(f => f.month === pay.month && (f.label === `${tr!.label} fee` || f.label === `${tr!.label} interest (balloon)`)).reduce((s, f) => s - f.amount, 0) : 0;
      out.push({
        draw: d, line, terms: drawTerms(line, d),
        left: !tr ? 0 : d.month <= months[0] ? tr.open : d.amount_usd,
        next: pay ? { month: pay.month, amount: -pay.amount + fee } : null,
      });
    }
  }
  return out.sort((a, b) => (b.draw.draw_date || b.draw.month).localeCompare(a.draw.draw_date || a.draw.month));
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
    ...creditFlows(inp.creditLines, inp.creditDraws, months, inp.settings.cash_as_of),
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
