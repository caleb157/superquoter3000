// Amazon SKU cash model for DKT Cash Flow. Two kinds of SKU:
//  - simple: an existing line, cash in = units/month × price × net margin from the start month
//    (restocking is assumed to come out of the margin already).
//  - inventory: a new or modelled SKU. DKT pays 100% of the product cost at PO, pays freight when
//    it ships (make_months later) and sells ship_months after that. It reorders order_qty as late as
//    it can without running out: when stock on hand plus on the way no longer covers the make + ship
//    time at units/month, so the new order lands before the shelf is empty.
//    A launch can be modelled too: a smaller first order, a lower margin on that first batch, and
//    sales that start lower and ramp up to units/month over a number of months.
// Amazon pays out price − fees. Net margin is what is left after fees AND landed cost, so the
// payout per unit is price × net margin + product cost + freight per unit.
import type { Flow, Month } from './dkt-cashflow';

export type AmazonSku = {
  id: string;
  scenario_id: string | null;
  name: string;
  mode: 'simple' | 'inventory';
  price_usd: number;
  net_margin_pct: number; // 0..1
  units_per_month: number;
  start_month: Month | null; // first month of sales
  unit_cost_usd: number;
  freight_per_unit_usd: number;
  order_qty: number;
  make_months: number;
  ship_months: number;
  // Launch (new SKUs only; blank = same as the rest)
  first_order_qty?: number | null;
  launch_margin_pct?: number | null; // net margin on the first batch
  launch_units_per_month?: number | null; // sales in the first month, ramping up to units_per_month
  ramp_months?: number | null; // months to reach units_per_month
};

function add(m: Month, n: number): Month {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export const landedPerUnit = (s: Pick<AmazonSku, 'unit_cost_usd' | 'freight_per_unit_usd'>) =>
  (Number(s.unit_cost_usd) || 0) + (Number(s.freight_per_unit_usd) || 0);
export const payoutPerUnit = (s: AmazonSku) =>
  (Number(s.price_usd) || 0) * (Number(s.net_margin_pct) || 0) + (s.mode === 'inventory' ? landedPerUnit(s) : 0);
export const leadMonths = (s: Pick<AmazonSku, 'make_months' | 'ship_months'>) =>
  Math.max(0, Math.round(Number(s.make_months) || 0)) + Math.max(0, Math.round(Number(s.ship_months) || 0));
export const firstPoMonth = (s: AmazonSku): Month | null => (s.start_month ? add(s.start_month, -leadMonths(s)) : null);

const hasLaunch = (s: AmazonSku) => s.mode === 'inventory';
/** Units the SKU would sell in month m if stock allows, ramping from the launch rate to units/month. */
export function demandFor(s: AmazonSku, m: Month): number {
  if (!s.start_month || m < s.start_month) return 0;
  const v = Math.max(0, Number(s.units_per_month) || 0);
  const ramp = Math.max(0, Math.round(Number(s.ramp_months) || 0));
  if (!hasLaunch(s) || !ramp || s.launch_units_per_month == null) return v;
  const [y1, m1] = s.start_month.split('-').map(Number), [y2, m2] = m.split('-').map(Number);
  const k = (y2 - y1) * 12 + (m2 - m1);
  const v0 = Math.max(0, Number(s.launch_units_per_month) || 0);
  return k >= ramp ? v : v0 + ((v - v0) * k) / ramp;
}

export type SkuMonth = {
  month: Month;
  poUnits: number; // units ordered this month
  arrived: number;
  sold: number;
  stockEnd: number;
  stockout: boolean; // wanted to sell but ran out
  earned: number; // net margin on what sold (first batch at the launch margin)
  cashIn: number;
  cashOut: number;
};

/** Month-by-month simulation from the first PO (or start) through `last`. */
export function simulateSku(s: AmazonSku, last: Month): SkuMonth[] {
  if (!s.start_month) return [];
  const price = Number(s.price_usd) || 0;
  const margin = Number(s.net_margin_pct) || 0;
  const out: SkuMonth[] = [];
  if (s.mode === 'simple') {
    const v = Math.max(0, Number(s.units_per_month) || 0);
    for (let m = s.start_month; m <= last; m = add(m, 1)) {
      out.push({ month: m, poUnits: 0, arrived: 0, sold: v, stockEnd: 0, stockout: false, earned: v * price * margin, cashIn: v * payoutPerUnit(s), cashOut: 0 });
    }
    return out;
  }
  const qty = Math.max(0, Math.round(Number(s.order_qty) || 0));
  const firstQty = s.first_order_qty == null ? qty : Math.max(0, Math.round(Number(s.first_order_qty) || 0));
  const launchMargin = s.launch_margin_pct == null ? margin : Number(s.launch_margin_pct) || 0;
  const make = Math.max(0, Math.round(Number(s.make_months) || 0));
  const lead = leadMonths(s);
  const cost = Number(s.unit_cost_usd) || 0;
  const freight = Number(s.freight_per_unit_usd) || 0;
  const landed = landedPerUnit(s);
  const first = firstPoMonth(s)!;
  const pos: { month: Month; units: number }[] = [];
  let stock = 0;
  let firstLeft = firstQty; // first-batch units not sold yet (sold first)
  for (let m = first; m <= last; m = add(m, 1)) {
    let poUnits = 0;
    let cashOut = 0;
    const arrived = pos.filter(p => add(p.month, lead) === m).reduce((t, p) => t + p.units, 0);
    stock += arrived;
    let sold = 0;
    let stockout = false;
    const want = demandFor(s, m);
    if (m >= s.start_month) {
      sold = Math.min(want, stock);
      stockout = want > 0 && sold < want - 1e-9;
      stock -= sold;
    }
    const fromFirst = Math.min(sold, firstLeft);
    firstLeft -= fromFirst;
    const earned = fromFirst * price * launchMargin + (sold - fromFirst) * price * margin;
    const inbound = pos.filter(p => add(p.month, lead) > m).reduce((t, p) => t + p.units, 0);
    const firstOrder = m === first;
    // Waiting another month means this stock must last until an order placed next month arrives,
    // i.e. cover the next `lead` months of (ramping) sales.
    let need = 0;
    for (let k = 1; k <= lead; k++) need += demandFor(s, add(m, k));
    const reorderQty = firstOrder ? firstQty : qty;
    if (reorderQty > 0 && (firstOrder || (m >= s.start_month && stock + inbound < need - 1e-9))) {
      pos.push({ month: m, units: reorderQty });
      poUnits = reorderQty;
    }
    cashOut += poUnits * cost;
    // Freight is paid when an order ships, make_months after its PO.
    cashOut += pos.filter(p => add(p.month, make) === m).reduce((t, p) => t + p.units, 0) * freight;
    out.push({ month: m, poUnits, arrived, sold, stockEnd: stock, stockout, earned, cashIn: earned + sold * landed, cashOut });
  }
  return out;
}

/** Cash flows for the forecast window [from, last]; anything earlier is assumed already paid. */
export function amazonSkuFlows(s: AmazonSku, from: Month, last: Month): Flow[] {
  const out: Flow[] = [];
  for (const r of simulateSku(s, last)) {
    if (r.month < from) continue;
    if (r.cashIn) out.push({ month: r.month, kind: 'amazon_in', amount: r.cashIn, label: s.name, ref: s.id });
    const inv = r.poUnits * (Number(s.unit_cost_usd) || 0);
    if (inv) out.push({ month: r.month, kind: 'amazon_inventory', amount: -inv, label: s.name, ref: s.id });
    const fr = r.cashOut - inv;
    if (fr > 0.005) out.push({ month: r.month, kind: 'amazon_freight', amount: -fr, label: s.name, ref: s.id });
  }
  return out;
}

export type ScenarioSummary = {
  months: { month: Month; cashIn: number; cashOut: number; net: number; cumulative: number }[];
  invested: number; // total paid out for stock and freight
  peakNeed: number; // most cash tied up at once (lowest cumulative, as a positive number)
  peakMonth: Month | null;
  paybackMonth: Month | null; // first month cumulative is back to ≥ 0 after going negative
  profit: number; // cumulative cash at the end
  stockValue: number; // unsold stock at landed cost at the end
  stockoutMonths: number;
};

/** Combined cash picture of a set of SKUs from the first PO to `last`. */
export function scenarioSummary(skus: AmazonSku[], last: Month): ScenarioSummary {
  const sims = skus.map(s => ({ s, rows: simulateSku(s, last) }));
  const all = sims.flatMap(x => x.rows.map(r => r.month));
  const empty: ScenarioSummary = { months: [], invested: 0, peakNeed: 0, peakMonth: null, paybackMonth: null, profit: 0, stockValue: 0, stockoutMonths: 0 };
  if (!all.length) return empty;
  const start = all.reduce((a, b) => (a < b ? a : b));
  const months: ScenarioSummary['months'] = [];
  let cum = 0, peakNeed = 0, invested = 0;
  let peakMonth: Month | null = null, paybackMonth: Month | null = null;
  for (let m = start; m <= last; m = add(m, 1)) {
    let cashIn = 0, cashOut = 0;
    for (const { rows } of sims) {
      const r = rows.find(x => x.month === m);
      if (r) { cashIn += r.cashIn; cashOut += r.cashOut; }
    }
    const net = cashIn - cashOut;
    invested += cashOut;
    cum += net;
    if (-cum > peakNeed) { peakNeed = -cum; peakMonth = m; paybackMonth = null; }
    if (peakNeed > 0 && cum >= 0 && !paybackMonth) paybackMonth = m;
    months.push({ month: m, cashIn, cashOut, net, cumulative: cum });
  }
  const stockValue = sims.reduce((t, { s, rows }) => t + (rows[rows.length - 1]?.stockEnd ?? 0) * landedPerUnit(s), 0);
  const stockoutMonths = sims.reduce((t, { rows }) => t + rows.filter(r => r.stockout).length, 0);
  return { months, invested, peakNeed, peakMonth, paybackMonth, profit: cum, stockValue, stockoutMonths };
}
