// Pure math for the Sales Order Profitability page. All Odoo costs arrive in INR;
// revenue arrives in the SO currency (usually USD).

export type SoMaterial = {
  mo_id: number; mo_name: string | null; sku: string | null; name: string | null; type: string | null;
  planned_qty: number; actual_qty: number; uom: string | null; unit_price_inr: number; total_inr: number;
};
export type SoLabor = {
  mo_id: number; mo_name?: string | null; activity: string | null; category: string;
  hours: number; direct_inr: number; overhead_inr: number; burdened_inr: number;
};
export type SoShipping = { date: string; name: string; product: string | null; net_inr: number };
export type SoMo = { id: number; name: string; state: string; qty: number; product_id: number; sku: string | null; product_name: string | null };
export type SoOrder = {
  id: number; name: string; date_order: string; customer: string | null;
  project_id: number | null; project_name: string | null; currency: string;
  amount_untaxed: number; amount_total: number; state: string; status: 'Completed' | 'In Progress';
  mos: SoMo[]; materials: SoMaterial[]; labor: SoLabor[]; shipping: SoShipping[];
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
