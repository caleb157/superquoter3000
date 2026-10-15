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
import { amazonSkuFlows, type AmazonSku } from './dkt-amazon';

export type Month = string; // 'YYYY-MM'

export type DktSettings = {
  cash_usd: number;
  cash_as_of: string | null;
  min_cash_usd: number;
  horizon_months: number;
  default_margin_pct: number; // 0..1
  allegro_balance_usd: number;
  allegro_as_of: string | null;
  allegro_monthly_usd: number;
};

export const DEFAULT_SETTINGS: DktSettings = {
  cash_usd: 0, cash_as_of: null, min_cash_usd: 5000, horizon_months: 12,
  default_margin_pct: 0.05,
  allegro_balance_usd: 3200, allegro_as_of: null, allegro_monthly_usd: 500,
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
  active: boolean;
};

export type CreditLine = { id: string; name: string; limit_usd: number; drawn_usd: number; rate_pct: number };
export type CreditDraw = { id: string; line_id: string; month: Month; amount_usd: number }; // + draw, − repay

export type FlowKind =
  | 'cust_deposit' | 'cust_balance' | 'pv_advance' | 'pv_balance'
  | 'income' | 'overhead' | 'expense'
  | 'loan_principal' | 'loan_interest'
  | 'credit_draw' | 'credit_repay' | 'credit_interest'
  | 'amazon_in' | 'amazon_inventory' | 'amazon_freight';

export type Flow = { month: Month; kind: FlowKind; amount: number; label: string; ref?: string };

export const FLOW_LABEL: Record<FlowKind, string> = {
  cust_deposit: 'Customer deposits', cust_balance: 'Customer balances', amazon_in: 'Amazon payouts', income: 'Other income',
  credit_draw: 'Credit line draws',
  pv_advance: 'Advances to PV', pv_balance: 'Balances to PV', overhead: 'Overhead', expense: 'Expenses',
  loan_principal: 'Loan principal', loan_interest: 'Loan interest',
  credit_repay: 'Credit line repayments', credit_interest: 'Credit line interest',
  amazon_inventory: 'Amazon inventory (PO)', amazon_freight: 'Amazon freight',
};
export const IN_KINDS: FlowKind[] = ['cust_deposit', 'cust_balance', 'amazon_in', 'income', 'credit_draw'];
export const OUT_KINDS: FlowKind[] = [
  'pv_advance', 'pv_balance', 'overhead', 'expense', 'loan_principal', 'loan_interest',
  'credit_interest', 'credit_repay', 'amazon_inventory', 'amazon_freight',
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

// ---------- Loans ----------
export function loanFlows(loan: Loan, payments: LoanPayment[], orders: DktOrder[], thisMonth: Month): Flow[] {
  if (!loan.active) return [];
  const at = (m: Month) => (m < thisMonth ? thisMonth : m);
  if (loan.kind === 'schedule') {
    const out: Flow[] = [];
    for (const p of payments) {
      if (p.loan_id !== loan.id || p.paid) continue;
      const m = at(p.due_date.slice(0, 7));
      if (p.principal_usd) out.push({ month: m, kind: 'loan_principal', amount: -p.principal_usd, label: loan.name, ref: loan.id });
      if (p.interest_usd) out.push({ month: m, kind: 'loan_interest', amount: -p.interest_usd, label: loan.name, ref: loan.id });
    }
    return out;
  }
  const month = lumpLoanMonth(loan, orders);
  if (!month || !(loan.balance_usd > 0)) return [];
  return [{ month: at(month), kind: 'loan_principal', amount: -loan.balance_usd, label: loan.name, ref: loan.id }];
}

/** When a lump loan is planned to be repaid: with its linked order's customer balance, else its due month. */
export function lumpLoanMonth(loan: Loan, orders: DktOrder[]): Month | null {
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
export function creditFlows(lines: CreditLine[], draws: CreditDraw[], months: Month[]): Flow[] {
  const out: Flow[] = [];
  if (!months.length) return out;
  for (const line of lines) {
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
    res[line.id] = months.map(m => {
      for (const d of draws.filter(x => x.line_id === line.id && x.month === m)) bal = Math.max(0, bal + d.amount_usd);
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
  amazonSkus: AmazonSku[]; // only SKUs in forecast, funded by DKT
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
};

export function buildForecast(inp: ForecastInput): Forecast {
  const n = Math.max(1, Math.min(36, Math.round(inp.settings.horizon_months || 12)));
  const months = monthRange(inp.thisMonth, n);
  const last = months[months.length - 1];
  const flows: Flow[] = [
    ...inp.orders.flatMap(o => orderFlows(o, inp.thisMonth)),
    ...inp.costs.flatMap(c => costFlows(c, months)),
    ...inp.loans.flatMap(l => loanFlows(l, inp.loanPayments, inp.orders, inp.thisMonth)),
    ...creditFlows(inp.creditLines, inp.creditDraws, months),
    ...inp.amazonSkus.flatMap(s => amazonSkuFlows(s, inp.thisMonth, last)),
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
  };
}

// ---------- Allegro (emergency fund, outside DKT cash) ----------
export type AllegroMonth = { month: Month; balance: number; added: number; skuNet: number };
/**
 * Allegro grows by its monthly top-up (money from outside DKT). SKUs funded by Allegro take their
 * PO and freight out of it and put their Amazon payouts back in.
 */
export function allegroProjection(settings: DktSettings, thisMonth: Month, n: number, skus: AmazonSku[]): AllegroMonth[] {
  const months = monthRange(thisMonth, n);
  const last = months[months.length - 1];
  const flows = skus.flatMap(s => amazonSkuFlows(s, thisMonth, last));
  // The balance is as of allegro_as_of; months already passed since then have had their top-up.
  let bal = Number(settings.allegro_balance_usd) || 0;
  const add = Number(settings.allegro_monthly_usd) || 0;
  const asOf = toMonth(settings.allegro_as_of) ?? thisMonth;
  const gap = Math.max(0, monthDiff(asOf, thisMonth));
  bal += gap * add;
  return months.map((m, i) => {
    const added = i === 0 ? 0 : add;
    const skuNet = flows.filter(f => f.month === m).reduce((s, f) => s + f.amount, 0);
    bal += added + skuNet;
    return { month: m, balance: bal, added, skuNet };
  });
}
