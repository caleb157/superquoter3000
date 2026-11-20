// Pull as needed (DKT Cash Flow → Forecast): a what-if worked out on the fly, never saved. Instead of
// typing planned draws by hand, Caleb gives each credit line a pull order on the Credit lines tab
// (1 first, 2 next, blank = never pulled) and this draws from them, in that order, whenever a month
// would end below "Keep at least", then pays them back as soon as the cash ahead allows.
//
// Rules, month by month through the forecast:
//  - Planned draws typed on the Credit lines tab are set aside while this is on (real draws stay).
//  - Short month: draw what's missing, rounded up to a $500 step, from the first line in pull order that
//    has room (limit less what's owed on it that month), then the next, until the month ends at the minimum. A line's own
//    terms apply to each pull: installment lines (Amex) repay on their schedule from the next month,
//    revolving lines charge interest monthly or build it up as a balloon until paid back.
//  - Paying back: only revolving lines, last in pull order first, and only what the lowest cash at any
//    later month end allows, so it never pays back money it would have to pull again within the
//    forecast. Installment pulls keep their normal payments.
//  - If every line with a pull order is full, the month stays short and is listed.
import {
  buildForecast, creditBalances, drawTerms,
  type CreditDraw, type CreditLine, type Forecast, type ForecastInput, type Month,
} from './dkt-cashflow';

export type PullOrder = Record<string, number | null | undefined>;
/** Lenders take draws in round amounts: every pull is a multiple of this ($500, $1,000, $1,500…), and so is
 *  every pay-back unless it clears what was pulled on the line (Caleb, 2026-11-20). */
export const PULL_STEP = 500;
const roundUp = (n: number) => Math.ceil(n / PULL_STEP - 1e-9) * PULL_STEP;
const roundDown = (n: number) => Math.floor(n / PULL_STEP + 1e-9) * PULL_STEP;

export type PullMove = { month: Month; lineId: string; name: string; amount: number }; // + pull, − pay back
export type PullLineSummary = {
  id: string; name: string; order: number;
  installment: boolean;
  pulled: number; paidBack: number;
  peak: number; // most owed on the line in any month of the forecast (real draws + pulls)
  endOwed: number;
  limit: number;
};
export type PullPlan = {
  /** The forecast with real draws only (planned draws set aside), before any pulls. */
  base: Forecast;
  forecast: Forecast;
  input: ForecastInput;
  moves: PullMove[];
  lines: PullLineSummary[];
  /** Planned draws on the Credit lines tab left out while this is on. */
  setAside: number;
  /** Months still under the minimum after every line with a pull order is full. */
  short: { month: Month; amount: number }[];
  pulledTotal: number;
  interestBase: number; interestPull: number;
  profitBase: number; profitPull: number;
};

const interestOf = (f: Forecast) => f.flows
  .filter(x => x.kind === 'loan_interest' || x.kind === 'credit_interest')
  .reduce((s, x) => s - x.amount, 0);

const isInstallment = (line: CreditLine) => (Number(drawTerms(line).term_months) || 0) > 0;

/** Lines with a pull order, first to pull first (ties by name). */
export function pullQueue(lines: CreditLine[], order: PullOrder): (CreditLine & { order: number })[] {
  return lines
    .map(l => ({ ...l, order: Number(order[l.id]) || 0 }))
    .filter(l => l.order > 0)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function pullAsNeeded(inp: ForecastInput, order: PullOrder): PullPlan {
  const realDraws = inp.creditDraws.filter(d => d.actual);
  const setAside = inp.creditDraws.filter(d => !d.actual && d.amount_usd > 0).length;
  const baseInp: ForecastInput = { ...inp, creditDraws: realDraws };
  const base = buildForecast(baseInp);
  const months = base.months.map(r => r.month);
  const min = Number(inp.settings.min_cash_usd) || 0;
  const queue = pullQueue(inp.creditLines, order);

  const pulls: CreditDraw[] = [];
  const moves: PullMove[] = [];
  const short: PullPlan['short'] = [];
  // What's been pulled and not yet paid back on each revolving line (paying back never goes past it).
  const outstanding: Record<string, number> = {};
  let curInp = baseInp;
  let cur = base;
  const rerun = () => { curInp = { ...inp, creditDraws: [...realDraws, ...pulls] }; cur = buildForecast(curInp); };

  for (let i = 0; i < months.length && queue.length; i++) {
    const m = months[i];
    for (let pass = 0; pass < 8; pass++) {
      const closing = cur.months[i].closing;
      if (closing < min - 0.5) {
        let need = min - closing;
        const owed = creditBalances(inp.creditLines, curInp.creditDraws, months);
        let drew = false;
        for (const line of queue) {
          const room = line.limit_usd - (owed[line.id]?.[i] ?? 0);
          // Only whole steps fit: a line with less than $500 of room left is skipped.
          const roomSteps = roundDown(room);
          if (roomSteps < PULL_STEP) continue;
          // A revolving line charges this month's interest on the pull too, so ask for a touch more.
          const gross = isInstallment(line) || drawTerms(line).balloon ? need : need / Math.max(0.5, 1 - (Number(line.rate_pct) || 0) / 1200);
          const amt = Math.min(roomSteps, roundUp(gross));
          pulls.push({ id: `pull-${line.id}-${m}-${pass}`, line_id: line.id, month: m, amount_usd: amt, actual: false });
          moves.push({ month: m, lineId: line.id, name: line.name, amount: amt });
          if (!isInstallment(line)) outstanding[line.id] = (outstanding[line.id] ?? 0) + amt;
          need -= amt; drew = true;
          if (need < 1) break;
        }
        if (!drew) break; // every line is full
        rerun();
        continue;
      }
      // Pay back revolving pulls, last in the queue first, with what the cash ahead can spare.
      const spare = Math.min(...cur.months.slice(i).map(r => r.closing)) - min;
      if (spare < 1) break;
      let left = spare;
      let paid = false;
      for (const line of [...queue].reverse()) {
        const out = outstanding[line.id] ?? 0;
        if (out < 1 || isInstallment(line)) continue;
        // A balloon line also pays the interest built up on what's paid back; leave room for it.
        const rate = (Number(line.rate_pct) || 0) / 100;
        // Whole steps only, unless what's left fits and clears the line.
        const can = left / (1 + rate);
        const pay = out <= can + 0.5 ? Math.round(out) : roundDown(Math.min(out, can));
        if (pay < 1) continue;
        pulls.push({ id: `payback-${line.id}-${m}-${pass}`, line_id: line.id, month: m, amount_usd: -pay, actual: false });
        moves.push({ month: m, lineId: line.id, name: line.name, amount: -pay });
        outstanding[line.id] = out - pay;
        left -= pay * (1 + rate); paid = true;
        if (left < 1) break;
      }
      if (!paid) break;
      rerun();
      break; // one pay-back per month; a dip it causes is caught next month
    }
  }
  cur.months.forEach(r => { if (r.closing < min - 0.5) short.push({ month: r.month, amount: min - r.closing }); });

  // One move per line per month and direction.
  const merged = new Map<string, PullMove>();
  for (const mv of moves) {
    const k = `${mv.month}|${mv.lineId}|${mv.amount > 0 ? '+' : '-'}`;
    const was = merged.get(k);
    merged.set(k, was ? { ...was, amount: was.amount + mv.amount } : { ...mv });
  }
  const bal = creditBalances(inp.creditLines, curInp.creditDraws, months);
  const lines: PullLineSummary[] = queue.map(l => ({
    id: l.id, name: l.name, order: l.order, installment: isInstallment(l), limit: l.limit_usd,
    pulled: moves.filter(x => x.lineId === l.id && x.amount > 0).reduce((s, x) => s + x.amount, 0),
    paidBack: -moves.filter(x => x.lineId === l.id && x.amount < 0).reduce((s, x) => s + x.amount, 0),
    peak: Math.max(0, ...(bal[l.id] ?? [])),
    endOwed: bal[l.id]?.[months.length - 1] ?? 0,
  }));
  return {
    base, forecast: cur, input: curInp, moves: [...merged.values()].sort((a, b) => a.month.localeCompare(b.month)),
    lines, setAside, short,
    pulledTotal: moves.filter(x => x.amount > 0).reduce((s, x) => s + x.amount, 0),
    interestBase: interestOf(base), interestPull: interestOf(cur),
    profitBase: base.profit.netProfit, profitPull: cur.profit.netProfit,
  };
}
