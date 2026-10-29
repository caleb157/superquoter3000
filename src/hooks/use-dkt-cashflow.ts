// Loads everything DKT Cash Flow needs and saves edits straight back (one row at a time).
// DKT orders are HQ inquiries whose selling entity is DKT; their margin, customer deposit %,
// advance % and months are read from and written to inquiry_projections, the same fields the
// inquiry's Projection tab and PV analytics use.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { loadProjectionDefaults } from '@/lib/projection-defaults';
import { liveInquiryFinancials } from '@/lib/pipeline-live';
import {
  addMonths, DEFAULT_SETTINGS, toMonth,
  type CostItem, type CreditDraw, type CreditLine, type DktOrder, type DktSettings, type Loan, type LoanPayment, type Month,
  type OdooInvoice, type OdooOrder,
} from '@/lib/dkt-cashflow';
import type { AmazonSku } from '@/lib/dkt-amazon';

const db = supabase as any;
// Before PO the order lives in HQ; once confirmed it is a PV → DKT sales order in Odoo (read live),
// the same split Master Analytics uses, so an order is never counted twice.
export const OPEN_STATUSES = ['active', 'projected_po'];

export type OdooTerms = {
  so_name: string; margin_pct: number | null; cust_deposit_pct: number | null; ship_month: Month | null;
  cust_deposit_done: boolean; cust_balance_done: boolean; excluded: boolean; pv_paid_usd: number | null; cust_paid_usd: number | null;
  cust_paid_in_cash_usd: number | null;
};
type OdooRaw = {
  orders: { name: string; ref: string; date: string | null; ship_date: string | null; total_usd: number; to_invoice_usd: number; advance_usd?: number; cash_date?: string | null }[];
  invoices: { name: string; origin: string; due: string | null; date: string | null; residual_usd: number; total_usd: number }[];
  partner: string | null;
  fetched_at: string | null;
  share?: OdooShare | null;
};
/** PV's invoiced revenue over the last 12 months, and how much of it was to DKT. */
export type OdooShare = {
  since: string; total_usd: number; dkt_usd: number;
  invoices?: { name: string; partner: string; date: string; origin: string; amount_usd: number; dkt: boolean }[];
};
export type OdooRow = OdooOrder & { ship_month_set: boolean; margin_set: boolean; cust_set: boolean; invoices: OdooInvoice[] };

export type AmazonScenario = { id: string; name: string; notes: string | null; in_forecast: boolean };
export type OrderMeta = {
  po_month_set: boolean; ship_month_set: boolean; margin_set: boolean; advance_set: boolean; cust_set: boolean;
  /** The three terms as the inquiry's Projection tab has them; the cash flow may use its own (dkt_order_status). */
  inquiry: { margin_pct: number; cust_deposit_pct: number; advance_pct: number };
};
export const TERM_KEYS = ['margin_pct', 'cust_deposit_pct', 'advance_pct'] as const;
export type TermKey = typeof TERM_KEYS[number];

export type DktData = {
  settings: DktSettings;
  orders: DktOrder[];
  orderMeta: Record<string, OrderMeta>;
  costs: CostItem[];
  loans: (Loan & { notes: string | null })[];
  loanPayments: LoanPayment[];
  creditLines: (CreditLine & { notes: string | null })[];
  creditDraws: CreditDraw[];
  scenarios: AmazonScenario[];
  skus: AmazonSku[];
  dktEntityName: string | null;
  odooTerms: OdooTerms[];
  defaults: { custDeposit: number; ieDeposit: number; vendorDeposit: number };
};

const num = (v: any, d = 0) => (v == null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
export const monthToDate = (m: Month | null) => (m ? `${m}-01` : null);

function mapOrders(inqs: any[], statusRows: any[], live: Record<string, { fob_usd: number }>, settings: DktSettings, defaults: { custDeposit: number; ieDeposit: number; vendorDeposit: number }, thisMonth: Month) {
  const st = new Map(statusRows.map((r: any) => [r.inquiry_id, r]));
  const meta: Record<string, OrderMeta> = {};
  const orders: DktOrder[] = inqs.map(i => {
    const p = (Array.isArray(i.inquiry_projections) ? i.inquiry_projections[0] : i.inquiry_projections) || {};
    const s: any = st.get(i.id) || {};
    const projFob = num(p.projected_fob_revenue_usd);
    const poRaw = p.cust_deposit_month || p.ie_deposit_month || p.start_month;
    const po = toMonth(poRaw) ?? thisMonth;
    const shipRaw = p.cust_final_month || p.ie_balance_month || p.shipping_month || p.delivery_month;
    const ship = toMonth(shipRaw) ?? addMonths(po, Math.max(1, num(p.duration_months, 3)) - 1);
    const inquiry = {
      margin_pct: num(p.selling_retention_pct, settings.default_margin_pct),
      cust_deposit_pct: num(p.cust_deposit_pct, defaults.custDeposit),
      advance_pct: num(p.ie_deposit_pct, defaults.ieDeposit),
    };
    meta[i.id] = {
      po_month_set: !!poRaw, ship_month_set: !!shipRaw,
      margin_set: p.selling_retention_pct != null, advance_set: p.ie_deposit_pct != null, cust_set: p.cust_deposit_pct != null,
      inquiry,
    };
    return {
      inquiry_id: i.id, rfq_number: i.rfq_number, title: i.title, customer: i.customers?.name ?? null, status: i.status,
      fob_usd: projFob || live[i.id]?.fob_usd || 0, fob_source: projFob ? 'projection' : 'live',
      // The inquiry's terms unless the cash flow has its own.
      margin_pct: num(s.margin_pct, inquiry.margin_pct),
      cust_deposit_pct: num(s.cust_deposit_pct, inquiry.cust_deposit_pct),
      advance_pct: num(s.advance_pct, inquiry.advance_pct),
      po_month: po, ship_month: ship < po ? po : ship,
      // Pipeline orders have no payments yet (deposits only start once it's a real sales order).
      done: { cust_deposit: false, advance: false, cust_balance: false, pv_balance: false },
      excluded: !!s.excluded,
    } as DktOrder;
  });
  return { orders, meta };
}

export function useDktCashflow(thisMonth: Month) {
  const [data, setData] = useState<DktData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [set, ents, inq, ost, costs, loans, pays, lines, draws, scen, skus, defaults, terms] = await Promise.all([
      db.from('dkt_cash_settings').select('*').eq('id', 1).maybeSingle(),
      db.from('company_entities').select('id, name, entity_type'),
      db.from('customer_rfqs').select('id, rfq_number, title, status, customers(name), inquiry_projections(*)').in('status', OPEN_STATUSES),
      db.from('dkt_order_status').select('*'),
      db.from('dkt_cash_items').select('*').order('kind').order('created_at'),
      db.from('dkt_loans').select('*').order('created_at'),
      db.from('dkt_loan_payments').select('*').order('due_date'),
      db.from('dkt_credit_lines').select('*').order('created_at'),
      db.from('dkt_credit_draws').select('*').order('month'),
      db.from('dkt_amazon_scenarios').select('*').order('created_at'),
      db.from('dkt_amazon_skus').select('*').order('created_at'),
      loadProjectionDefaults(),
      db.from('dkt_odoo_order_terms').select('*'),
    ]);
    const firstErr = [set, ents, inq, ost, costs, loans, pays, lines, draws, scen, skus].find(r => r.error)?.error;
    if (firstErr) {
      setError(/relation|does not exist|schema cache/i.test(firstErr.message || '')
        ? 'The DKT Cash Flow tables are not in the database yet. Run the DKT cash flow SQL, then reload.'
        : firstErr.message);
      setLoading(false);
      return;
    }
    const settings: DktSettings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(Object.entries(set.data || {}).filter(([, v]) => v != null)) } as DktSettings;
    for (const k of ['cash_usd', 'min_cash_usd', 'monthly_overhead_usd', 'horizon_months', 'default_margin_pct', 'allegro_balance_usd', 'allegro_monthly_usd', 'allegro_launch_usd'] as const) {
      (settings as any)[k] = num((settings as any)[k], (DEFAULT_SETTINGS as any)[k]);
    }
    const entities = (ents.data as any[]) || [];
    const pv = entities.find(e => /parable/i.test(e.name || '') || e.entity_type === 'India');
    const dkt = entities.find(e => /\bdkt\b|desert/i.test(e.name || '')) ?? entities.find(e => e.id !== pv?.id && e.entity_type !== 'India');
    const mine = ((inq.data as any[]) || []).filter(i => {
      const p = (Array.isArray(i.inquiry_projections) ? i.inquiry_projections[0] : i.inquiry_projections) || {};
      return p.selling_entity_id && (dkt ? p.selling_entity_id === dkt.id : p.selling_entity_id !== pv?.id);
    });
    const needLive = mine.filter(i => {
      const p = (Array.isArray(i.inquiry_projections) ? i.inquiry_projections[0] : i.inquiry_projections) || {};
      return !num(p.projected_fob_revenue_usd);
    }).map(i => i.id);
    const live = needLive.length ? await liveInquiryFinancials(needLive).catch(() => ({})) : {};
    const { orders, meta } = mapOrders(mine, ost.data || [], live, settings, defaults, thisMonth);
    orders.sort((a, b) => a.po_month.localeCompare(b.po_month) || a.rfq_number.localeCompare(b.rfq_number));
    const m = (r: any, k: string) => toMonth(r[k]);
    setData({
      settings,
      orders, orderMeta: meta,
      costs: (costs.data || []).map((r: any) => ({ ...r, amount_usd: num(r.amount_usd), start_month: m(r, 'start_month'), end_month: m(r, 'end_month') })),
      loans: (loans.data || []).map((r: any) => ({ ...r, balance_usd: num(r.balance_usd), rate_pct: num(r.rate_pct), due_month: m(r, 'due_month'), proceeds_usd: r.proceeds_usd == null ? null : num(r.proceeds_usd), proceeds_month: m(r, 'proceeds_month') })),
      loanPayments: (pays.data || []).map((r: any) => ({ ...r, principal_usd: num(r.principal_usd), interest_usd: num(r.interest_usd) })),
      creditLines: (lines.data || []).map((r: any) => ({ ...r, limit_usd: num(r.limit_usd), drawn_usd: num(r.drawn_usd), rate_pct: num(r.rate_pct), maturity_month: m(r, 'maturity_month'), term_months: r.term_months == null ? null : num(r.term_months), monthly_fee_pct: r.monthly_fee_pct == null ? null : num(r.monthly_fee_pct) })),
      creditDraws: (draws.data || []).map((r: any) => ({
        ...r, month: m(r, 'month'), amount_usd: num(r.amount_usd), actual: !!r.actual, maturity_month: m(r, 'maturity_month'),
        term_months: r.term_months == null ? null : num(r.term_months), monthly_fee_pct: r.monthly_fee_pct == null ? null : num(r.monthly_fee_pct),
        rate_pct: r.rate_pct == null ? null : num(r.rate_pct),
      })),
      scenarios: scen.data || [],
      skus: (skus.data || []).map((r: any) => ({
        ...r, price_usd: num(r.price_usd), net_margin_pct: num(r.net_margin_pct), units_per_month: num(r.units_per_month),
        start_month: m(r, 'start_month'), unit_cost_usd: num(r.unit_cost_usd), freight_per_unit_usd: num(r.freight_per_unit_usd),
        order_qty: num(r.order_qty), make_months: num(r.make_months, 2), ship_months: num(r.ship_months, 2),
        first_order_qty: r.first_order_qty == null ? null : num(r.first_order_qty),
        launch_margin_pct: r.launch_margin_pct == null ? null : num(r.launch_margin_pct),
        launch_units_per_month: r.launch_units_per_month == null ? null : num(r.launch_units_per_month),
        ramp_months: r.ramp_months == null ? null : num(r.ramp_months),
      })),
      dktEntityName: dkt?.name ?? null,
      odooTerms: (terms.error ? [] : terms.data || []).map((r: any) => ({ ...r, ship_month: m(r, 'ship_month') })),
      defaults,
    });
    setLoading(false);
  }, [thisMonth]);

  useEffect(() => { load(); }, [load]);

  // PV's open sales orders and unpaid invoices to DKT, live from Odoo (nothing is stored).
  const [odoo, setOdoo] = useState<OdooRaw | null>(null);
  const [odooLoading, setOdooLoading] = useState(false);
  const [odooError, setOdooError] = useState<string | null>(null);
  const loadOdoo = useCallback(async () => {
    setOdooLoading(true); setOdooError(null);
    const { data: res, error: err } = await supabase.functions.invoke('odoo-dkt-orders', { body: {} });
    setOdooLoading(false);
    if (err || res?.error) { setOdooError(typeof res?.error === 'string' ? res.error : err?.message || 'Could not load DKT orders from Odoo'); return; }
    setOdoo({ orders: res.orders ?? [], invoices: res.invoices ?? [], partner: res.partner ?? null, fetched_at: res.fetched_at ?? null, share: res.share ?? null });
  }, []);
  useEffect(() => { loadOdoo(); }, [loadOdoo]);

  const odooRows: OdooRow[] = useMemo(() => {
    if (!odoo || !data) return [];
    const terms = new Map(data.odooTerms.map(t => [t.so_name, t]));
    return odoo.orders.map(o => {
      const t = terms.get(o.name);
      const po = toMonth(o.date) ?? thisMonth;
      // Ship month and what's been paid to PV come from PV's Odoo only (the date PV's cash flow uses).
      const odooShip = toMonth(o.cash_date) ?? toMonth(o.ship_date);
      const ship = odooShip ? (odooShip < thisMonth ? thisMonth : odooShip) : addMonths(po, 3);
      return {
        name: o.name, ref: o.ref, po_month: po,
        ship_month: ship,
        pv_total_usd: o.total_usd, to_invoice_usd: o.to_invoice_usd, advance_usd: num(o.advance_usd, 0), pv_paid_usd: 0, cust_paid_usd: t?.cust_paid_usd == null ? null : num(t.cust_paid_usd),
        // Until the in-cash column exists, every typed payment counts as already in current cash.
        cust_paid_in_cash_usd: t && !('cust_paid_in_cash_usd' in (t as object)) ? t.cust_paid_usd : t?.cust_paid_in_cash_usd == null ? null : num(t.cust_paid_in_cash_usd),
        margin_pct: num(t?.margin_pct, data.settings.default_margin_pct),
        cust_deposit_pct: num(t?.cust_deposit_pct, data.defaults.custDeposit),
        done: { cust_deposit: !!t?.cust_deposit_done, cust_balance: !!t?.cust_balance_done },
        excluded: !!t?.excluded,
        ship_month_set: !!odooShip, margin_set: t?.margin_pct != null, cust_set: t?.cust_deposit_pct != null,
        invoices: odoo.invoices.filter(i => i.origin.split(',').map(s => s.trim()).includes(o.name)).map(toInvoice(thisMonth)),
      };
    });
  }, [odoo, data, thisMonth]);
  const odooInvoices: OdooInvoice[] = useMemo(() => (odoo?.invoices ?? []).map(toInvoice(thisMonth)), [odoo, thisMonth]);

  const fail = (e: any) => { if (e) { toast.error(e.message || 'Could not save'); return true; } return false; };

  /** Local update first so typing stays instant, then the save. */
  const patchLocal = (fn: (d: DktData) => DktData) => setData(d => (d ? fn(d) : d));

  const api = {
    reloadOdoo: loadOdoo,
    async saveOdooTerms(soName: string, patch: Partial<Omit<OdooTerms, 'so_name'>>) {
      patchLocal(d => {
        const has = d.odooTerms.some(t => t.so_name === soName);
        const blank: OdooTerms = { so_name: soName, margin_pct: null, cust_deposit_pct: null, ship_month: null, cust_deposit_done: false, cust_balance_done: false, excluded: false, pv_paid_usd: null, cust_paid_usd: null, cust_paid_in_cash_usd: null };
        return { ...d, odooTerms: has ? d.odooTerms.map(t => (t.so_name === soName ? { ...t, ...patch } : t)) : [...d.odooTerms, { ...blank, ...patch }] };
      });
      const { error } = await db.from('dkt_odoo_order_terms').upsert({ so_name: soName, ...toDb(patch as any) }, { onConflict: 'so_name' });
      fail(error);
    },
    reload: load,
    async saveSettings(patch: Partial<DktSettings>) {
      // A new current cash figure includes every customer payment typed so far, so mark them as in cash.
      const rollIn = patch.cash_usd != null;
      patchLocal(d => ({
        ...d, settings: { ...d.settings, ...patch },
        odooTerms: rollIn ? d.odooTerms.map(t => ({ ...t, cust_paid_in_cash_usd: t.cust_paid_usd })) : d.odooTerms,
      }));
      const { error } = await db.from('dkt_cash_settings').upsert({ id: 1, ...patch });
      if (fail(error) || !rollIn) return;
      const pending = (data?.odooTerms ?? []).filter(t => t.cust_paid_usd != null && Number(t.cust_paid_in_cash_usd ?? 0) !== Number(t.cust_paid_usd));
      if (!pending.length || !('cust_paid_in_cash_usd' in pending[0])) return;
      for (const t of pending) {
        const { error: e2 } = await db.from('dkt_odoo_order_terms').update({ cust_paid_in_cash_usd: t.cust_paid_usd }).eq('so_name', t.so_name);
        if (fail(e2)) return;
      }
    },
    async saveOrder(inquiryId: string, patch: Partial<Pick<DktOrder, 'margin_pct' | 'cust_deposit_pct' | 'advance_pct' | 'po_month' | 'ship_month' | 'fob_usd'>>) {
      patchLocal(d => ({ ...d, orders: d.orders.map(o => (o.inquiry_id === inquiryId ? { ...o, ...patch, ...(patch.fob_usd != null ? { fob_source: 'projection' as const } : {}) } : o)) }));
      // Margin, customer deposit and advance are the cash flow's own until pushed to the inquiry.
      const terms: any = {};
      for (const k of TERM_KEYS) if (patch[k] != null) terms[k] = patch[k];
      if (Object.keys(terms).length) {
        const { error } = await db.from('dkt_order_status').upsert({ inquiry_id: inquiryId, ...terms }, { onConflict: 'inquiry_id' });
        fail(error);
      }
      const row: any = { inquiry_id: inquiryId };
      // Vendor payments move with the customer's, so PV's cash flow keeps them in the same months.
      if (patch.po_month) { row.cust_deposit_month = row.ie_deposit_month = row.vendor_deposit_month = monthToDate(patch.po_month); }
      if (patch.ship_month) { row.cust_final_month = row.ie_balance_month = row.vendor_balance_month = monthToDate(patch.ship_month); }
      if (patch.fob_usd != null) row.projected_fob_revenue_usd = patch.fob_usd;
      if (Object.keys(row).length === 1) return;
      const { error } = await db.from('inquiry_projections').upsert(row, { onConflict: 'inquiry_id' });
      fail(error);
    },
    /** Write the cash flow's margin / customer deposit / advance into the inquiry's projection, then drop the cash flow's own copy. */
    async saveTermsToInquiry(inquiryId: string) {
      const o = data?.orders.find(x => x.inquiry_id === inquiryId);
      if (!o) return;
      const { error } = await db.from('inquiry_projections').upsert({
        inquiry_id: inquiryId,
        selling_retention_pct: o.margin_pct,
        cust_deposit_pct: o.cust_deposit_pct, cust_final_pct: Math.max(0, 1 - o.cust_deposit_pct),
        ie_deposit_pct: o.advance_pct, ie_balance_pct: Math.max(0, 1 - o.advance_pct),
      }, { onConflict: 'inquiry_id' });
      if (fail(error)) return;
      const { error: e2 } = await db.from('dkt_order_status').upsert({ inquiry_id: inquiryId, margin_pct: null, cust_deposit_pct: null, advance_pct: null }, { onConflict: 'inquiry_id' });
      if (fail(e2)) return;
      patchLocal(d => ({
        ...d,
        orderMeta: { ...d.orderMeta, [inquiryId]: { ...d.orderMeta[inquiryId], margin_set: true, advance_set: true, cust_set: true,
          inquiry: { margin_pct: o.margin_pct, cust_deposit_pct: o.cust_deposit_pct, advance_pct: o.advance_pct } } },
      }));
    },
    async saveOrderStatus(inquiryId: string, patch: Partial<DktOrder['done']> & { excluded?: boolean }) {
      patchLocal(d => ({
        ...d,
        orders: d.orders.map(o => (o.inquiry_id === inquiryId ? {
          ...o, excluded: patch.excluded ?? o.excluded,
          done: { ...o.done, ...Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'excluded')) },
        } : o)),
      }));
      const row: any = { inquiry_id: inquiryId };
      if (patch.cust_deposit != null) row.cust_deposit_done = patch.cust_deposit;
      if (patch.advance != null) row.advance_done = patch.advance;
      if (patch.cust_balance != null) row.cust_balance_done = patch.cust_balance;
      if (patch.pv_balance != null) row.pv_balance_done = patch.pv_balance;
      if (patch.excluded != null) row.excluded = patch.excluded;
      const { error } = await db.from('dkt_order_status').upsert(row, { onConflict: 'inquiry_id' });
      fail(error);
    },
    // Generic row helpers for the DKT-only tables. Months are stored as the 1st of the month.
    async insert(table: string, row: Record<string, any>) {
      const { error } = await db.from(table).insert(toDb(row));
      if (!fail(error)) await load();
    },
    async duplicateScenario(s: AmazonScenario, skus: AmazonSku[]) {
      const { data: row, error } = await db.from('dkt_amazon_scenarios')
        .insert({ name: `${s.name} (copy)`, notes: s.notes, in_forecast: false }).select('id').single();
      if (fail(error) || !row) return;
      const copies = skus.filter(x => x.scenario_id === s.id).map(({ id: _id, ...x }) => toDb({ ...x, scenario_id: row.id }));
      if (copies.length) fail((await db.from('dkt_amazon_skus').insert(copies)).error);
      await load();
    },
    async update(table: string, id: string, patch: Record<string, any>, listKey: keyof DktData) {
      patchLocal(d => ({ ...d, [listKey]: (d[listKey] as any[]).map(r => (r.id === id ? { ...r, ...patch } : r)) }));
      const { error } = await db.from(table).update(toDb(patch)).eq('id', id);
      fail(error);
    },
    async remove(table: string, id: string, listKey: keyof DktData) {
      patchLocal(d => ({ ...d, [listKey]: (d[listKey] as any[]).filter(r => r.id !== id) }));
      const { error } = await db.from(table).delete().eq('id', id);
      fail(error);
    },
  };

  return {
    data, loading, error, api,
    odoo: { rows: odooRows, invoices: odooInvoices, partner: odoo?.partner ?? null, share: odoo?.share ?? null, fetchedAt: odoo?.fetched_at ?? null, loading: odooLoading, error: odooError },
  };
}

const toInvoice = (thisMonth: Month) => (i: OdooRaw['invoices'][number]): OdooInvoice => ({
  name: i.name, origin: i.origin, due_month: toMonth(i.due || i.date) ?? thisMonth, residual_usd: i.residual_usd,
});

const MONTH_COLS = new Set(['start_month', 'end_month', 'due_month', 'month', 'ship_month', 'maturity_month', 'proceeds_month']);
function toDb(row: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) out[k] = MONTH_COLS.has(k) && typeof v === 'string' && v.length === 7 ? `${v}-01` : v;
  return out;
}
