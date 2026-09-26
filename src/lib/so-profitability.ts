// Pure math for the Sales Order Profitability page. All Odoo costs arrive in INR;
// revenue arrives in the SO currency (usually USD).

export type SoMaterial = {
  mo_id: number; mo_name: string | null; sku: string | null; name: string | null; type: string | null;
  planned_qty: number; actual_qty: number; uom: string | null; unit_price_inr: number; total_inr: number; valued?: boolean;
};
export type SoLine = {
  product_id: number; sku: string | null; name: string | null; qty: number; price_unit: number; subtotal: number;
  volume: number; standard_price_inr: number; type: string | null;
};
export type SoLabor = {
  mo_id: number; mo_name?: string | null; activity: string | null; category: string;
  hours: number; direct_inr: number; overhead_inr: number; burdened_inr: number;
};
export type SoShipping = { date: string; name: string; product: string | null; net_inr: number };
export type SoMo = { id: number; name: string; state: string; qty: number; qty_produced?: number; product_id: number; sku: string | null; product_name: string | null };
export type SoOrder = {
  id: number; name: string; date_order: string; customer: string | null;
  project_id: number | null; project_name: string | null; currency: string;
  amount_untaxed: number; amount_total: number; state: string; status: 'Completed' | 'In Progress';
  lines?: SoLine[]; mos: SoMo[]; materials: SoMaterial[]; labor: SoLabor[]; shipping: SoShipping[];
};

export type DisplayCurrency = 'USD' | 'INR';

/** Convert an amount from its source currency (USD or INR) to the display currency. */
export function toDisplay(amount: number, from: string, to: DisplayCurrency, inrPerUsd: number): number {
  const f = from === 'INR' ? 'INR' : 'USD';
  if (f === to) return amount;
  if (!(inrPerUsd > 0)) return 0;
  return f === 'USD' ? amount * inrPerUsd : amount / inrPerUsd;
}

export function marginTone(pct: number): 'complete' | 'progress' | 'issue' {
  if (pct > 35) return 'complete';
  if (pct >= 20) return 'progress';
  return 'issue';
}

export type SoSummary = {
  revenue: number; materials: number; direct: number; overhead: number; burdened: number; shipping: number;
  totalCost: number; margin: number; marginPct: number;
  materialCount: number; zeroCostCount: number; hours: number; shippingCount: number;
};

/** Total cost = materials + fully burdened labour (direct + overhead) + shipping. */
export function summarize(o: SoOrder, cur: DisplayCurrency, fx: number, moFilter?: Set<number>): SoSummary {
  const inMo = (id: number) => !moFilter || moFilter.has(id);
  const mats = o.materials.filter(m => inMo(m.mo_id));
  const lab = o.labor.filter(l => inMo(l.mo_id));
  const c = (inr: number) => toDisplay(inr, 'INR', cur, fx);
  const materials = c(mats.reduce((s, m) => s + m.total_inr, 0));
  const direct = c(lab.reduce((s, l) => s + l.direct_inr, 0));
  const overhead = c(lab.reduce((s, l) => s + l.overhead_inr, 0));
  const burdenedRaw = lab.reduce((s, l) => s + l.burdened_inr, 0);
  const burdened = burdenedRaw > 0 ? c(burdenedRaw) : direct + overhead;
  const shipping = moFilter ? 0 : c(o.shipping.reduce((s, x) => s + x.net_inr, 0));
  const revenue = toDisplay(o.amount_untaxed, o.currency, cur, fx);
  const totalCost = materials + direct + overhead + shipping;
  const margin = revenue - totalCost;
  return {
    revenue, materials, direct, overhead, burdened, shipping, totalCost, margin,
    marginPct: revenue > 0 ? (margin / revenue) * 100 : 0,
    materialCount: mats.length,
    zeroCostCount: mats.filter(m => !(m.unit_price_inr > 0)).length,
    hours: lab.reduce((s, l) => s + l.hours, 0),
    shippingCount: moFilter ? 0 : o.shipping.length,
  };
}

export function groupLabor(rows: SoLabor[]) {
  const map = new Map<string, { category: string; hours: number; direct: number; overhead: number; burdened: number; count: number }>();
  for (const r of rows) {
    const g = map.get(r.category) ?? { category: r.category, hours: 0, direct: 0, overhead: 0, burdened: 0, count: 0 };
    g.hours += r.hours; g.direct += r.direct_inr; g.overhead += r.overhead_inr; g.burdened += r.burdened_inr; g.count++;
    map.set(r.category, g);
  }
  return [...map.values()].sort((a, b) => b.burdened - a.burdened);
}

export type LaborMoGroup = {
  mo_id: number; mo_name: string;
  hours: number; direct: number; overhead: number; burdened: number; count: number;
  categories: ReturnType<typeof groupLabor>;
};

/** Labour grouped by manufacturing order, then by work-order category inside each MO. */
export function groupLaborByMo(rows: SoLabor[], moNames?: Map<number, string>): LaborMoGroup[] {
  const byMo = new Map<number, SoLabor[]>();
  for (const r of rows) {
    const list = byMo.get(r.mo_id) ?? [];
    list.push(r);
    byMo.set(r.mo_id, list);
  }
  return [...byMo.entries()].map(([mo_id, list]) => ({
    mo_id,
    mo_name: list[0]?.mo_name || moNames?.get(mo_id) || `MO ${mo_id}`,
    hours: list.reduce((s, l) => s + l.hours, 0),
    direct: list.reduce((s, l) => s + l.direct_inr, 0),
    overhead: list.reduce((s, l) => s + l.overhead_inr, 0),
    burdened: list.reduce((s, l) => s + l.burdened_inr, 0),
    count: list.length,
    categories: groupLabor(list),
  })).sort((a, b) => b.burdened - a.burdened);
}

// ---------- MO / SO tab math (all costs in INR, converted at the end) ----------

export const moProduced = (m: SoMo) => (m.qty_produced && m.qty_produced > 0 ? m.qty_produced : m.qty);

export type MoStats = { mo: SoMo; produced: number; materials: number; direct: number; overhead: number; hours: number; total: number };

/** Material, direct labour and overhead burden (INR) for one MO. Overhead = burdened − direct. */
export function moStats(o: SoOrder, mo: SoMo): MoStats {
  const materials = o.materials.filter(m => m.mo_id === mo.id).reduce((s, m) => s + m.total_inr, 0);
  const lab = o.labor.filter(l => l.mo_id === mo.id);
  const direct = lab.reduce((s, l) => s + l.direct_inr, 0);
  const burdened = lab.reduce((s, l) => s + l.burdened_inr, 0);
  const overhead = burdened > 0 ? Math.max(0, burdened - direct) : lab.reduce((s, l) => s + l.overhead_inr, 0);
  const hours = lab.reduce((s, l) => s + l.hours, 0);
  return { mo, produced: moProduced(mo), materials, direct, overhead, hours, total: materials + direct + overhead };
}

export type LineAnalysis = {
  line: SoLine; fromMo: boolean;
  unitMaterial: number; unitDirect: number; unitOverhead: number; unitMo: number; unitShipping: number; unitTotal: number;
  unitPrice: number; unitGross: number; unitNet: number; revenue: number; gross: number; net: number; cost: number;
};

/**
 * Per SO line, in display currency. Unit costs come from the MO(s) of that product
 * (total MO cost ÷ units produced) so over-production never inflates the SO cost.
 * Products without an MO use their standard cost (no labour / overhead).
 * Shipping is allocated by product volume × quantity sold.
 */
export function analyzeLines(o: SoOrder, cur: DisplayCurrency, fx: number): LineAnalysis[] {
  const lines = o.lines ?? [];
  const c = (inr: number) => toDisplay(inr, 'INR', cur, fx);
  const stats = o.mos.map(m => moStats(o, m));
  const shipInr = o.shipping.reduce((s, x) => s + x.net_inr, 0);
  const totalVol = lines.reduce((s, l) => s + l.volume * l.qty, 0);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  return lines.map(line => {
    const mine = stats.filter(s => s.mo.product_id === line.product_id);
    const produced = mine.reduce((s, x) => s + x.produced, 0);
    const fromMo = mine.length > 0 && produced > 0;
    const per = (k: 'materials' | 'direct' | 'overhead') => (fromMo ? mine.reduce((s, x) => s + x[k], 0) / produced : 0);
    const unitMaterial = c(fromMo ? per('materials') : line.standard_price_inr);
    const unitDirect = c(per('direct'));
    const unitOverhead = c(per('overhead'));
    const unitMo = unitMaterial + unitDirect + unitOverhead;
    const shipUnitInr = totalVol > 0 ? (shipInr * line.volume) / totalVol : totalQty > 0 ? shipInr / totalQty : 0;
    const unitShipping = c(shipUnitInr);
    const unitTotal = unitMo + unitShipping;
    const revenue = toDisplay(line.subtotal || line.price_unit * line.qty, o.currency, cur, fx);
    const unitPrice = line.qty > 0 ? revenue / line.qty : toDisplay(line.price_unit, o.currency, cur, fx);
    const unitGross = unitPrice - unitMaterial;
    const unitNet = unitPrice - unitTotal;
    return {
      line, fromMo, unitMaterial, unitDirect, unitOverhead, unitMo, unitShipping, unitTotal,
      unitPrice, unitGross, unitNet, revenue, gross: unitGross * line.qty, net: unitNet * line.qty, cost: unitTotal * line.qty,
    };
  });
}

export type OrderPnl = { revenue: number; cost: number; gross: number; net: number; gpm: number; npm: number };

/** Order-level totals built from the SO-tab lines (falls back to SO untaxed amount if no lines). */
export function orderPnl(o: SoOrder, cur: DisplayCurrency, fx: number): OrderPnl {
  const rows = analyzeLines(o, cur, fx);
  const revenue = rows.length ? rows.reduce((s, r) => s + r.revenue, 0) : toDisplay(o.amount_untaxed, o.currency, cur, fx);
  const cost = rows.reduce((s, r) => s + r.cost, 0);
  const gross = rows.length ? rows.reduce((s, r) => s + r.gross, 0) : revenue;
  const net = revenue - cost;
  return { revenue, cost, gross, net, gpm: revenue > 0 ? (gross / revenue) * 100 : 0, npm: revenue > 0 ? (net / revenue) * 100 : 0 };
}
