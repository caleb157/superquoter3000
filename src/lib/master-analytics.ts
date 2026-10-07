// Pure calculations for the Master Analytics page. Odoo/LaborTrax actuals come
// from the cached snapshot; pipeline comes from HQ inquiries. No React here.
import { effectiveCertainty } from '@/lib/projections';

export type Ccy = 'USD' | 'INR';
export type Money = { amount_inr: number; amount_usd: number };
export const pickAmt = (m: Money, c: Ccy) => (c === 'USD' ? m.amount_usd : m.amount_inr) || 0;

export type SnapshotSO = Money & {
  name: string; partner: string | null; date_order: string | null; currency: string;
  invoice_status: string | null; delivery_status: string | null;
  original_delivery: string | null; delivery_date: string | null; effective_date: string | null;
  mo_names: string[]; mo_missing_pack: number; ready_date: string | null;
  /** True when every linked MO is 'done' in Odoo (older snapshots: undefined). */
  all_mos_done?: boolean; mos_done_date?: string | null;
};
export type CashItem = Money & { kind: 'so' | 'po' | 'invoice' | 'bill' | 'igst' | 'overhead' | 'pipeline_in' | 'pipeline_out'; ref: string; partner: string | null; date: string; sign: 1 | -1; advance_applied_inr?: number; advance_covered?: boolean };
export type Snapshot = {
  inr_per_usd: number; today: string; overhead_months: number;
  /** Sum of Odoo asset_cash account balances (INR) at sync time. */
  opening_cash_inr?: number;
  sales_orders: SnapshotSO[]; cash_items: CashItem[];
  invoiced: (Money & { ref: string; partner: string | null; date: string | null })[];
  pending_so_revenue: (Money & { ref: string; partner: string | null; date: string })[];
  overhead_monthly: { inr: number; months: number; history: Record<string, number> };
  actual_hours_by_month: Record<string, number>;
  booked_hours_by_month: Record<string, number>;
  labortrax_entry_count: number; labortrax_fields: string[]; warnings: string[];
};

export const MIN_ORDER_USD = 100;
const inR = (d: string | null | undefined, from: Date, to: Date) => {
  if (!d) return false; const t = new Date(d.length === 10 ? d + 'T12:00:00' : d).getTime();
  return t >= from.getTime() && t <= to.getTime();
};

// ---------- KPIs ----------
export function confirmedOrdersKpi(sos: SnapshotSO[], from: Date, to: Date, inrPerUsd: number) {
  const inWin = sos.filter(s => inR(s.date_order, from, to));
  const qualifying = inWin.filter(s => s.amount_usd >= MIN_ORDER_USD || (inrPerUsd > 0 && s.amount_inr / inrPerUsd >= MIN_ORDER_USD));
  return { all: inWin, qualifying };
}

export type OtdRow = SnapshotSO & { onTime: boolean | null; lateDays: number | null; completed_on: string | null };
/** OTD: in-house SOs only (≥1 MO) whose MOs are all done (or delivered in full), completed in window.
 *  Completion = last Packaging entry + 1 day, else latest MO finish, else delivery date. */
export function otdKpi(sos: SnapshotSO[], from: Date, to: Date) {
  const rows: OtdRow[] = sos
    .filter(s => s.mo_names.length > 0 && (s.all_mos_done || s.delivery_status === 'full'))
    .map(s => ({ s, done: s.ready_date || s.mos_done_date || s.effective_date || null }))
    .filter(({ done }) => inR(done, from, to))
    .map(({ s, done }) => {
      if (!done || !s.original_delivery) return { ...s, completed_on: done, onTime: null, lateDays: null };
      const late = Math.round((new Date(done).getTime() - new Date(s.original_delivery).getTime()) / 86400000);
      return { ...s, completed_on: done, onTime: late <= 0, lateDays: late };
    });
  const scored = rows.filter(r => r.onTime !== null);
  const onTime = scored.filter(r => r.onTime).length;
  return { rows, scored: scored.length, onTime, rate: scored.length ? onTime / scored.length : null, unscored: rows.length - scored.length };
}

// ---------- Pipeline (PV perspective) ----------
export type PipelineInquiry = {
  id: string; rfq_number: string; title: string | null; status: string; customer: string | null;
  certainty: number;
  /** Full order FOB (customer-facing). */
  fob_usd: number;
  /** PV's share: FOB × (1 − selling retention) when another entity (DKT) sells; else FOB. */
  pv_revenue_usd: number;
  via_other_entity: boolean;
  gpm: number; man_hours: number;
  revenue_month: string | null; start_month: string; duration_months: number;
  /** Inflows to PV (customer payments, or inter-entity payments when DKT sells). */
  cust: { pct: number; month: string | null }[]; vend: { pct: number; month: string | null }[];
  fob_source: 'projection' | 'live'; mh_source: 'projection' | 'live';
};
const BOOKED = new Set(['po', 'complete', 'cancelled', 'paused']);
const pct = (v: number) => (v > 1 ? v / 100 : v);
const addMonths = (ym: string, n: number) => { const d = new Date(ym.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };

export type PipelineOpts = {
  today: string;
  pvEntityId: string | null;
  defaults: { custDeposit: number; ieDeposit: number };
  live: Record<string, { fob_usd: number; gpm: number; man_hours: number }>;
};

export function buildPipeline(inquiries: any[], opts: PipelineOpts): PipelineInquiry[] {
  const thisMonth = opts.today.slice(0, 7) + '-01';
  return inquiries
    .filter(i => !BOOKED.has(i.status))
    .map(i => {
      const p = (Array.isArray(i.inquiry_projections) ? i.inquiry_projections[0] : i.inquiry_projections) || {};
      const certainty = effectiveCertainty(p, i.products || [], i.status);
      const live = opts.live[i.id] || { fob_usd: 0, gpm: 0, man_hours: 0 };
      const projFob = Number(p.projected_fob_revenue_usd) || 0;
      const fob = projFob || live.fob_usd;
      const projMh = Number(p.estimated_man_hours) || 0;
      const mh = projMh || live.man_hours;
      const gpm = p.project_gpm != null ? pct(Number(p.project_gpm)) : live.gpm;
      const duration = Math.max(1, Number(p.duration_months) || 3);
      const start = (p.start_month || thisMonth).slice(0, 10);
      const ship = (p.shipping_month || p.delivery_month || p.cust_final_month || addMonths(start, duration - 1)).slice(0, 10);
      const viaOther = !!(p.selling_entity_id && opts.pvEntityId && p.selling_entity_id !== opts.pvEntityId);
      const retention = viaOther ? pct(Number(p.selling_retention_pct) || 0) : 0;
      const pvRev = fob * (1 - retention);
      let cust: { pct: number; month: string | null }[];
      if (viaOther) {
        const dep = p.ie_deposit_pct != null ? pct(Number(p.ie_deposit_pct)) : opts.defaults.ieDeposit;
        const bal = p.ie_balance_pct != null && p.ie_deposit_pct != null ? pct(Number(p.ie_balance_pct)) : 1 - dep;
        cust = [
          { pct: dep, month: p.ie_deposit_month || p.cust_deposit_month || start },
          { pct: bal, month: p.ie_balance_month || ship },
        ];
      } else {
        const dep = p.cust_deposit_pct != null ? pct(Number(p.cust_deposit_pct)) : opts.defaults.custDeposit;
        const fin = p.cust_final_pct != null ? pct(Number(p.cust_final_pct)) : 1 - dep - (Number(p.cust_other_pct) || 0);
        cust = [
          { pct: dep, month: p.cust_deposit_month || start },
          { pct: fin, month: p.cust_final_month || ship },
          { pct: pct(Number(p.cust_other_pct) || 0), month: p.cust_other_month },
        ];
      }
      return {
        id: i.id, rfq_number: i.rfq_number, title: i.title, status: i.status, customer: i.customers?.name ?? null,
        certainty, fob_usd: fob, pv_revenue_usd: pvRev, via_other_entity: viaOther, gpm, man_hours: mh,
        revenue_month: ship, start_month: start, duration_months: duration,
        cust,
        vend: [
          { pct: Number(p.vendor_deposit_pct) || 0, month: p.vendor_deposit_month || null },
          { pct: Number(p.vendor_balance_pct) || 0, month: p.vendor_balance_month || null },
        ],
        fob_source: projFob ? 'projection' : 'live', mh_source: projMh ? 'projection' : 'live',
      } as PipelineInquiry;
    })
    .filter(x => x.certainty > 0 && (x.fob_usd > 0 || x.man_hours > 0));
}

const usdMoney = (usd: number, rate: number): Money => ({ amount_usd: usd, amount_inr: usd * rate });

export function pipelineCashItems(pipe: PipelineInquiry[], hqRate: number, today: string): CashItem[] {
  const out: CashItem[] = [];
  const clamp = (m: string | null) => { const d = (m || today).slice(0, 10); return d < today ? today : d; };
  for (const p of pipe) {
    for (const c of p.cust) if (c.pct && c.month) out.push({ kind: 'pipeline_in', ref: p.rfq_number + (p.via_other_entity ? ' (via DKT)' : ''), partner: p.customer, date: clamp(c.month), sign: 1, ...usdMoney(p.pv_revenue_usd * pct(c.pct) * p.certainty, hqRate) });
    const cost = p.fob_usd * (1 - pct(p.gpm));
    for (const v of p.vend) if (v.pct && v.month) out.push({ kind: 'pipeline_out', ref: p.rfq_number, partner: p.customer, date: clamp(v.month), sign: -1, ...usdMoney(cost * pct(v.pct) * p.certainty, hqRate) });
  }
  return out;
}

// ---------- Months ----------
export function nextMonths(today: string, n = 12): string[] {
  const d = new Date(today.slice(0, 7) + '-01T00:00:00Z');
  return Array.from({ length: n }, (_, i) => { const x = new Date(d); x.setUTCMonth(d.getUTCMonth() + i); return x.toISOString().slice(0, 7); });
}
export const monthLabel = (k: string) => new Date(k + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export function fyBounds(today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return { start: `${start}-04-01`, end: `${start + 1}-03-31`, label: `FY ${String(start).slice(2)}–${String(start + 1).slice(2)}` };
}

// ---------- Cash flow table ----------
export type CashRowKey = 'so' | 'invoice' | 'igst' | 'pipeline_in' | 'po' | 'bill' | 'overhead' | 'pipeline_out';
export const CASH_ROWS: { key: CashRowKey; label: string; dir: 1 | -1 }[] = [
  { key: 'so', label: 'Pending SOs (customer)', dir: 1 },
  { key: 'invoice', label: 'Open customer invoices', dir: 1 },
  { key: 'igst', label: 'IGST refunds (178)', dir: 1 },
  { key: 'pipeline_in', label: 'Pipeline inflows (weighted)', dir: 1 },
  { key: 'po', label: 'Pending POs & RFQs', dir: -1 },
  { key: 'bill', label: 'Open vendor bills', dir: -1 },
  { key: 'overhead', label: 'Overhead (non-PO)', dir: -1 },
  { key: 'pipeline_out', label: 'Pipeline vendor costs (weighted)', dir: -1 },
];

export function cashflowTable(items: CashItem[], months: string[], ccy: Ccy, overheadPerMonth: number, opening: number) {
  const cells: Record<CashRowKey, Record<string, number>> = {} as any;
  const detail: Record<string, CashItem[]> = {};
  CASH_ROWS.forEach(r => (cells[r.key] = {}));
  const last = months[months.length - 1];
  for (const it of items) {
    let m = it.date.slice(0, 7);
    if (m < months[0]) m = months[0];
    if (m > last) continue;
    const key = it.kind as CashRowKey;
    if (!cells[key]) continue;
    cells[key][m] = (cells[key][m] || 0) + pickAmt(it, ccy) * it.sign * (CASH_ROWS.find(r => r.key === key)!.dir);
    (detail[`${key}|${m}`] ||= []).push(it);
  }
  months.forEach(m => (cells.overhead[m] = overheadPerMonth));
  const net: Record<string, number> = {}, ending: Record<string, number> = {};
  let bal = opening;
  for (const m of months) {
    const n = CASH_ROWS.reduce((s, r) => s + r.dir * (cells[r.key][m] || 0), 0);
    net[m] = n; bal += n; ending[m] = bal;
  }
  return { cells, net, ending, detail };
}

export function fmtMoney(v: number, ccy: Ccy, compact = true) {
  const sym = ccy === 'USD' ? '$' : '₹';
  const a = Math.abs(v);
  let s: string;
  if (!compact) s = Math.round(a).toLocaleString(ccy === 'INR' ? 'en-IN' : 'en-US');
  else if (ccy === 'INR') s = a >= 1e7 ? (a / 1e7).toFixed(2) + ' Cr' : a >= 1e5 ? (a / 1e5).toFixed(1) + ' L' : Math.round(a).toLocaleString('en-IN');
  else s = a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : Math.round(a).toString();
  return (v < 0 ? '−' : '') + sym + s;
}
