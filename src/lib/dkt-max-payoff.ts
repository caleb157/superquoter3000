// Max payoff (DKT Cash Flow → Forecast): a what-if computed on the fly, never saved. Month by
// month it sweeps every dollar above a cash buffer into paying debt early, on top of the normal plan.
//
// Rules:
//  - The extra paid in a month is the lowest cash at any month end from then to the end of the forecast,
//    minus the buffer. Paying early only lowers later months by what's paid (less any interest saved),
//    so no later month, including its known bills, drops under the buffer because of it.
//  - Dearest debt first (yearly rate on what's still owed; an installment line's monthly fee is charged
//    on the original draw, so its real rate is higher), then the smallest balance.
//  - Every scheduled payment, fee and due date still applies; extra money only comes off what's left.
//    A payment schedule shrinks from its last payment backwards, and its interest falls with what's owed.
//    A lump loan already due this month or earlier is paid by the plan anyway, so it isn't prepaid.
//  - Planned credit draws stay as planned. Months that are already under the buffer get nothing extra.
import {
  buildForecast, creditBalances, creditDebtAt, creditDrawnToday, lumpLoanMonth, monthLabel,
  type CreditDraw, type Flow, type Forecast, type ForecastInput, type Loan, type LoanPayment, type Month,
} from './dkt-cashflow';

export const DEFAULT_PAYOFF_BUFFER = 2000;

type Prepay = { month: Month; amount: number };
export type PayoffDebt = {
  key: string; name: string; kind: 'credit' | 'loan';
  apr: number;
  today: number; // owed at the start of the forecast
  baseEnd: number; maxEnd: number; // owed at the end of the forecast
  basePaidOff: Month | null; maxPaidOff: Month | null; // month it reaches zero (null = not within the forecast)
  extra: number; // extra paid on it in total
};
export type PayoffMonth = {
  month: Month; baseClosing: number; maxClosing: number; extra: number;
  debtBase: number; debtMax: number;
  /** The plan alone already leaves cash under the buffer this month. */
  belowBuffer: boolean;
};
export type MaxPayoff = {
  buffer: number;
  base: Forecast;
  forecast: Forecast; // the forecast with the extra payments in it
  months: PayoffMonth[];
  debts: PayoffDebt[];
  payments: { month: Month; key: string; name: string; amount: number }[];
  extraTotal: number;
  interestBase: number; interestMax: number; interestSaved: number;
  profitBase: number; profitMax: number;
  debtFreeBase: Month | null; debtFreeMax: Month | null;
  belowBufferMonths: Month[];
};

const interestOf = (f: Forecast) => f.flows
  .filter(x => x.kind === 'loan_interest' || x.kind === 'credit_interest')
  .reduce((s, x) => s - x.amount, 0);

/** A schedule's unpaid payments with extra principal paid in given months: later payments shrink from
 *  the end, and each payment's interest scales with what's still owed before it. */
export function adjustSchedule(payments: LoanPayment[], prepays: Prepay[], thisMonth: Month): LoanPayment[] {
  const unpaid = payments.filter(p => !p.paid).sort((a, b) => a.due_date.localeCompare(b.due_date));
  if (!prepays.length) return unpaid;
  const at = (p: LoanPayment) => { const m = p.due_date.slice(0, 7); return m < thisMonth ? thisMonth : m; };
  const total = unpaid.reduce((s, p) => s + p.principal_usd, 0);
  const left = [...prepays].sort((a, b) => a.month.localeCompare(b.month));
  let owedBase = total, owed = total;
  const out: LoanPayment[] = [];
  for (const p of unpaid) {
    // Extra money paid in months before this payment comes off what's owed first.
    while (left.length && left[0].month < at(p)) { owed -= left.shift()!.amount; }
    owed = Math.max(0, owed);
    const ratio = owedBase > 0.005 ? owed / owedBase : 0;
    const principal = Math.min(p.principal_usd, owed);
    out.push({ ...p, principal_usd: principal, interest_usd: p.interest_usd * ratio });
    owedBase -= p.principal_usd; owed -= principal;
  }
  return out;
}

type State = { credit: CreditDraw[]; loans: Record<string, Prepay[]> };

function scenarioInput(inp: ForecastInput, st: State): ForecastInput {
  const sched: LoanPayment[] = [];
  const loans: Loan[] = [];
  const extraFlows: Flow[] = [...(inp.extraFlows ?? [])];
  for (const l of inp.loans) {
    const pre = st.loans[l.id] ?? [];
    if (l.kind === 'schedule') {
      sched.push(...adjustSchedule(inp.loanPayments.filter(p => p.loan_id === l.id), pre, inp.thisMonth));
      pre.forEach((x, i) => sched.push({ id: `maxpay-${l.id}-${i}`, loan_id: l.id, due_date: `${x.month}-28`, principal_usd: x.amount, interest_usd: 0, paid: false, note: 'extra (max payoff)' }));
      loans.push(l);
    } else {
      const paid = pre.reduce((s, x) => s + x.amount, 0);
      loans.push({ ...l, balance_usd: Math.max(0, l.balance_usd - paid) });
      for (const x of pre) extraFlows.push({ month: x.month, kind: 'loan_principal', amount: -x.amount, label: `${l.name} · extra (max payoff)`, ref: l.id });
    }
  }
  const otherPayments = inp.loanPayments.filter(p => !inp.loans.some(l => l.id === p.loan_id && l.kind === 'schedule'));
  return { ...inp, loans, loanPayments: [...otherPayments, ...sched], creditDraws: [...inp.creditDraws, ...st.credit], extraFlows };
}

type Open = { key: string; kind: 'credit' | 'loan'; id: string; name: string; balance: number; apr: number; costPerDollar: number };

/** Debts that can take extra money in months[i], with what's still owed after this month's own payments. */
function openDebts(inp: ForecastInput, months: Month[], i: number): Open[] {
  const m = months[i];
  const out: Open[] = [];
  const credit = creditDebtAt(inp.creditLines, inp.creditDraws, months, i, inp.settings.cash_as_of);
  for (const line of inp.creditLines) {
    const c = credit[line.id];
    if (!c || c.balance <= 0.5) continue;
    out.push({ key: `c:${line.id}`, kind: 'credit', id: line.id, name: line.name, balance: c.balance, apr: c.apr, costPerDollar: 1 + c.accrued / c.balance });
  }
  for (const l of inp.loans) {
    if (!l.active) continue;
    if (l.proceeds_usd && l.proceeds_month && l.proceeds_month > m) continue; // money not received yet
    let balance = 0;
    if (l.kind === 'schedule') {
      balance = inp.loanPayments.filter(p => p.loan_id === l.id && !p.paid)
        .filter(p => { const pm = p.due_date.slice(0, 7); return (pm < inp.thisMonth ? inp.thisMonth : pm) > m; })
        .reduce((s, p) => s + p.principal_usd, 0);
    } else {
      const due = lumpLoanMonth(l, inp.orders, inp.odooOrders ?? []);
      if (due && (due < inp.thisMonth ? inp.thisMonth : due) <= m) continue; // the plan pays it anyway
      balance = l.balance_usd;
    }
    if (balance > 0.5) out.push({ key: `l:${l.id}`, kind: 'loan', id: l.id, name: l.name, balance, apr: Number(l.rate_pct) || 0, costPerDollar: 1 });
  }
  return out.sort((a, b) => b.apr - a.apr || a.balance - b.balance);
}

/** What's owed on each debt at the end of each forecast month. */
function debtBalances(inp: ForecastInput, months: Month[]): Record<string, { name: string; kind: 'credit' | 'loan'; values: number[]; today: number }> {
  const res: Record<string, { name: string; kind: 'credit' | 'loan'; values: number[]; today: number }> = {};
  const cb = creditBalances(inp.creditLines, inp.creditDraws, months);
  const today = creditDrawnToday(inp.creditLines, inp.creditDraws, months[0]);
  for (const line of inp.creditLines) {
    res[`c:${line.id}`] = { name: line.name, kind: 'credit', values: cb[line.id] ?? [], today: today[line.id] ?? 0 };
  }
  for (const l of inp.loans) {
    if (!l.active) continue;
    let values: number[];
    if (l.kind === 'schedule') {
      const pays = inp.loanPayments.filter(p => p.loan_id === l.id && !p.paid);
      values = months.map(m => pays.filter(p => { const pm = p.due_date.slice(0, 7); return (pm < inp.thisMonth ? inp.thisMonth : pm) > m; })
        .reduce((s, p) => s + p.principal_usd, 0));
      const received = !(l.proceeds_usd && l.proceeds_month && l.proceeds_month > months[0]);
      res[`l:${l.id}`] = { name: l.name, kind: 'loan', values, today: received ? pays.reduce((s, p) => s + p.principal_usd, 0) : 0 };
    } else {
      const due = lumpLoanMonth(l, inp.orders, inp.odooOrders ?? []);
      const at = due ? (due < inp.thisMonth ? inp.thisMonth : due) : null;
      const extra = (inp.extraFlows ?? []).filter(f => f.ref === l.id && f.kind === 'loan_principal');
      values = months.map(m => (at && at <= m ? 0 : l.balance_usd + extra.filter(f => f.month > m).reduce((s, f) => s - f.amount, 0)));
      res[`l:${l.id}`] = { name: l.name, kind: 'loan', values, today: l.balance_usd + extra.reduce((s, f) => s - f.amount, 0) };
    }
  }
  return res;
}

const paidOffMonth = (values: number[], months: Month[], today: number): Month | null => {
  if (today <= 0.5 && values.every(v => v <= 0.5)) return null;
  if ((values[values.length - 1] ?? 0) > 0.5) return null;
  for (let i = values.length - 1; i >= 0; i--) if (values[i] > 0.5) return months[i + 1] ?? null;
  return months[0];
};

export function maxPayoff(inp: ForecastInput, bufferIn: number): MaxPayoff {
  const buffer = Math.max(0, Number(bufferIn) || 0);
  const base = buildForecast(inp);
  const months = base.months.map(r => r.month);
  const st: State = { credit: [], loans: {} };
  const payments: MaxPayoff['payments'] = [];
  let cur = base;
  let curInp = inp;
  for (let i = 0; i < months.length; i++) {
    for (let pass = 0; pass < 6; pass++) {
      const head = Math.min(...cur.months.slice(i).map(r => r.closing)) - buffer;
      if (head < 1) break;
      const debts = openDebts(curInp, months, i);
      if (!debts.length) break;
      let left = head;
      for (const d of debts) {
        const pay = Math.min(d.balance, left / d.costPerDollar);
        if (pay < 1) continue;
        if (d.kind === 'credit') st.credit.push({ id: `maxpay-${d.id}-${months[i]}-${pass}`, line_id: d.id, month: months[i], amount_usd: -pay, prepay: true });
        else (st.loans[d.id] ??= []).push({ month: months[i], amount: pay });
        payments.push({ month: months[i], key: d.key, name: d.name, amount: pay });
        left -= pay * d.costPerDollar;
        if (left < 1) break;
      }
      if (left >= head - 0.5) break; // nothing could take it
      curInp = scenarioInput(inp, st);
      cur = buildForecast(curInp);
    }
  }

  const bBase = debtBalances(inp, months);
  const bMax = debtBalances(curInp, months);
  const debts: PayoffDebt[] = Object.entries(bBase).map(([key, b]) => {
    const mx = bMax[key] ?? b;
    const extra = payments.filter(p => p.key === key).reduce((s, p) => s + p.amount, 0);
    const kindId = key.slice(2);
    const apr = key.startsWith('c:')
      ? creditDebtAt(inp.creditLines, inp.creditDraws, months, 0, inp.settings.cash_as_of)[kindId]?.apr ?? 0
      : Number(inp.loans.find(l => l.id === kindId)?.rate_pct) || 0;
    return {
      key, name: b.name, kind: b.kind, apr, today: b.today,
      baseEnd: b.values[b.values.length - 1] ?? 0, maxEnd: mx.values[mx.values.length - 1] ?? 0,
      basePaidOff: paidOffMonth(b.values, months, b.today), maxPaidOff: paidOffMonth(mx.values, months, mx.today),
      extra,
    };
  }).filter(d => d.today > 0.5 || d.extra > 0.5 || bBase[d.key].values.some(v => v > 0.5));

  const sumAt = (bs: typeof bBase, i: number) => Object.values(bs).reduce((s, x) => s + (x.values[i] ?? 0), 0);
  const rows: PayoffMonth[] = months.map((m, i) => ({
    month: m, baseClosing: base.months[i].closing, maxClosing: cur.months[i].closing,
    extra: payments.filter(p => p.month === m).reduce((s, p) => s + p.amount, 0),
    debtBase: sumAt(bBase, i), debtMax: sumAt(bMax, i),
    belowBuffer: base.months[i].closing < buffer - 0.5,
  }));
  const debtFree = (key: 'debtBase' | 'debtMax') => {
    const r = rows.find((x, i) => x[key] <= 0.5 && rows.slice(i).every(y => y[key] <= 0.5));
    return r ? r.month : null;
  };
  // One line per debt per month (a month can take several passes).
  const merged = new Map<string, MaxPayoff['payments'][number]>();
  for (const p of payments) {
    const k = `${p.month}|${p.key}`;
    const was = merged.get(k);
    merged.set(k, was ? { ...was, amount: was.amount + p.amount } : { ...p });
  }
  const interestBase = interestOf(base), interestMax = interestOf(cur);
  return {
    buffer, base, forecast: cur, months: rows, debts, payments: [...merged.values()],
    extraTotal: payments.reduce((s, p) => s + p.amount, 0),
    interestBase, interestMax, interestSaved: interestBase - interestMax,
    profitBase: base.profit.netProfit, profitMax: cur.profit.netProfit,
    debtFreeBase: debtFree('debtBase'), debtFreeMax: debtFree('debtMax'),
    belowBufferMonths: rows.filter(r => r.belowBuffer).map(r => r.month),
  };
}

/** "Mar 27", or "after Oct 27" when it isn't paid off within the forecast. */
export const payoffLabel = (m: Month | null, months: Month[]) =>
  m ? monthLabel(m) : months.length ? `after ${monthLabel(months[months.length - 1])}` : '—';
