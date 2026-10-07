// @ts-nocheck
// Master Analytics sync: pulls Odoo (SOs, POs, invoices/bills, IGST 178, overhead tag)
// and LaborTrax (packaging dates, hours) into one cached snapshot. Admin/team only.
// The page reads the latest snapshot instantly; this only runs on Refresh.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  overhead_months: z.number().int().min(1).max(24).optional(),
  igst_account_id: z.number().int().positive().optional(),
  overhead_tag_id: z.number().int().positive().optional(),
});

const ODOO_URL = (Deno.env.get('ODOO_URL') ?? '').replace(/\/+$/, '');
const ODOO_DB = Deno.env.get('ODOO_DB') ?? 'parableventures';
const ODOO_USER = Deno.env.get('ODOO_USERNAME') ?? '';
const ODOO_KEY = Deno.env.get('ODOO_API_KEY') ?? '';

const HERITAGE_PROJECT_BY_SO: Record<string, number> = { S00075: 110, S00076: 109, S00078: 108, S00081: 123, S00082: 123 };

let rpcId = 0;
async function rpc(service: string, method: string, args: unknown[]) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service, method, args } }),
  });
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error?.data?.message || data.error?.message || 'Odoo error');
  return data.result;
}
let uid: number | null = null;
async function kw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
  if (!uid) {
    uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_KEY, {}]);
    if (!uid) throw new Error('Odoo login failed');
  }
  return rpc('object', 'execute_kw', [ODOO_DB, uid, ODOO_KEY, model, method, args, kwargs]);
}
const fieldCache: Record<string, Set<string>> = {};
async function fieldsOf(model: string) {
  if (!fieldCache[model]) fieldCache[model] = new Set(Object.keys((await kw(model, 'fields_get', [], { attributes: ['type'] })) || {}));
  return fieldCache[model];
}
async function sr(model: string, domain: unknown[], fields: string[], extra: Record<string, unknown> = {}) {
  const avail = await fieldsOf(model);
  return (await kw(model, 'search_read', [domain], { fields: fields.filter(f => avail.has(f)), ...extra })) as any[];
}
const id = (v: any) => (Array.isArray(v) ? v[0] : v || null);
const nm = (v: any) => (Array.isArray(v) ? v[1] : null);
const num = (v: any) => (v == null || v === false ? 0 : Number(v) || 0);
const d10 = (v: any) => (v ? String(v).slice(0, 10) : null);
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const maxDate = (...xs: (string | null)[]) => xs.filter(Boolean).sort().pop() ?? null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const started = Date.now();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let userId: string | null = null;
  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: authErr } = await sb.auth.getClaims(auth.replace('Bearer ', ''));
    if (authErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    userId = claims.claims.sub;
    const { data: allowed } = await sb.rpc('is_admin_or_team', { _user_id: userId });
    if (!allowed) return json({ error: 'Forbidden' }, 403);
    if (!ODOO_URL || !ODOO_USER || !ODOO_KEY) return json({ error: 'Odoo is not connected.' }, 400);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const overheadMonths = parsed.data.overhead_months ?? 3;
    const igstAccountId = parsed.data.igst_account_id ?? 178;
    const overheadTagId = parsed.data.overhead_tag_id ?? 220;

    const warnings: string[] = [];
    const today = todayStr();
    const tomorrow = addDays(today, 1);

    // --- FX: INR per USD (Odoo current) ---
    let inrPerUsd = 0;
    try {
      const usd = await sr('res.currency', [['name', '=', 'USD']], ['rate', 'inverse_rate']);
      const inv = num(usd[0]?.inverse_rate), r = num(usd[0]?.rate);
      inrPerUsd = inv > 1 ? inv : r > 0 && r < 1 ? 1 / r : r;
    } catch (e) { warnings.push('USD rate: ' + e.message); }
    // Converts a doc-currency amount to INR/USD. rateDocPerInr = Odoo currency_rate (doc units per 1 INR).
    const money = (amountDoc: number, cur: string | null, rateDocPerInr: number) => {
      const isInr = !cur || cur === 'INR';
      const inr = isInr ? amountDoc : rateDocPerInr > 0 ? amountDoc / rateDocPerInr : amountDoc * (inrPerUsd || 0);
      const usd = cur === 'USD' ? amountDoc : inrPerUsd > 0 ? inr / inrPerUsd : 0;
      return { inr, usd };
    };

    // --- partner advances (customer credit<0 = advance; vendor debit<0 = advance) ---
    const advanceCache = new Map<number, { cust: number; vend: number }>();
    async function loadAdvances(pids: number[]) {
      const need = pids.filter(p => p && !advanceCache.has(p));
      if (!need.length) return;
      try {
        const rows = await sr('res.partner', [['id', 'in', need]], ['credit', 'debit'], { context: { active_test: false } });
        for (const r of rows) advanceCache.set(r.id, { cust: Math.max(0, -num(r.credit)), vend: Math.max(0, -num(r.debit)) });
      } catch (e) { warnings.push('Partner balances: ' + e.message); }
    }
    // FIFO: advances soak up a partner's earliest-dated items first.
    function waterfall(items: any[], key: 'cust' | 'vend') {
      const byPartner = new Map<number, any[]>();
      for (const it of items) { if (!byPartner.has(it.partner_id)) byPartner.set(it.partner_id, []); byPartner.get(it.partner_id)!.push(it); }
      for (const [pid, list] of byPartner) {
        let leftInr = advanceCache.get(pid)?.[key] ?? 0;
        list.sort((a, b) => a.date.localeCompare(b.date));
        for (const it of list) {
          if (leftInr <= 0) break;
          const take = Math.min(leftInr, it.amount_inr);
          const ratio = it.amount_inr > 0 ? take / it.amount_inr : 0;
          it.advance_applied_inr = take;
          it.amount_inr -= take;
          it.amount_usd -= it.amount_usd * ratio;
          leftInr -= take;
        }
      }
      // Fully advance-covered items stay (amount 0) so they remain visible in drill-downs.
      return items.map(i => (i.amount_inr <= 0.5 ? { ...i, amount_inr: 0, amount_usd: 0, advance_covered: true } : i));
    }

    // ================= SALES ORDERS =================
    const since = addDays(today, -730);
    const sos = await sr('sale.order', [['state', 'in', ['sale', 'done']], ['date_order', '>=', since + ' 00:00:00']],
      ['name', 'date_order', 'partner_id', 'amount_untaxed', 'amount_total', 'currency_id', 'currency_rate', 'invoice_status',
        'delivery_status', 'commitment_date', 'expected_date', 'effective_date', 'signed_on', 'project_id', 'state', 'x_studio_original_delivery_date'],
      { order: 'date_order desc', limit: 2000 });

    // MOs linked by project or origin
    const mos = await sr('mrp.production', [['state', '!=', 'cancel'], ['create_date', '>=', since + ' 00:00:00']],
      ['name', 'origin', 'project_id', 'state', 'date_start', 'date_planned_start', 'date_finished', 'product_id', 'product_qty'], { limit: 5000 });
    const pidOf = (o: any) => id(o.project_id) ?? HERITAGE_PROJECT_BY_SO[o.name] ?? null;
    const mosBySo = new Map<string, any[]>();
    for (const o of sos) {
      const pid = pidOf(o);
      mosBySo.set(o.name, mos.filter(m => (pid && id(m.project_id) === pid) || (m.origin && String(m.origin).includes(o.name))));
    }

    // ================= LABORTRAX =================
    let ltEntries: any[] = [];
    let ltSampleKeys: string[] = [];
    try {
      const ltKey = Deno.env.get('LABORTRAX_API_KEY');
      if (!ltKey) throw new Error('LABORTRAX_API_KEY not set');
      const res = await fetch(`https://labor-trax.lovable.app/api/public/labor-entries?from=${since}`, { headers: { 'x-api-key': ltKey } });
      if (!res.ok) throw new Error(`LaborTrax ${res.status}`);
      ltEntries = (await res.json())?.entries || [];
      ltSampleKeys = Object.keys(ltEntries[0] || {});
    } catch (e) { warnings.push('LaborTrax: ' + e.message); }
    const pick = (e: any, keys: string[]) => { for (const k of keys) if (e[k] != null && e[k] !== '') return e[k]; return null; };
    const lt = ltEntries.map(e => {
      const wo = String(pick(e, ['work_order_category', 'work_order', 'work_order_name', 'work_center', 'workorder', 'category']) ?? '');
      const act = String(pick(e, ['work_activity', 'activity', 'activity_name', 'master_work_activity']) ?? '');
      const date = d10(pick(e, ['date', 'work_date', 'entry_date', 'end_time', 'start_time', 'created_at']));
      let hours = num(pick(e, ['hours', 'man_hours', 'duration_hours', 'total_hours']));
      if (!hours) { const mins = num(pick(e, ['minutes', 'duration_minutes'])); if (mins) hours = mins / 60; }
      const workers = num(pick(e, ['workers', 'num_workers', 'headcount'])) || 1;
      if (e.man_hours == null && workers > 1 && e.hours != null) hours = hours * workers;
      return { mo: e.mo_id != null ? String(e.mo_id) : '', wo, act, date, hours };
    }).filter(e => e.date);

    const lastPackByMo = new Map<string, string>();
    for (const e of lt) {
      if (!/packag/i.test(e.wo) || /post|pre[\s-]?ship/i.test(e.wo)) continue;
      const cur = lastPackByMo.get(e.mo);
      if (!cur || e.date! > cur) lastPackByMo.set(e.mo, e.date!);
    }
    const actualHoursByMonth: Record<string, number> = {};
    for (const e of lt) { const m = e.date!.slice(0, 7); actualHoursByMonth[m] = (actualHoursByMonth[m] || 0) + e.hours; }

    const salesOrders = sos.map(o => {
      const cur = nm(o.currency_id) || 'INR';
      const m = money(num(o.amount_untaxed), cur, num(o.currency_rate));
      const myMos = mosBySo.get(o.name) || [];
      let ready: string | null = null;
      let missing = 0;
      for (const mo of myMos) {
        const last = lastPackByMo.get(String(mo.name)) ?? lastPackByMo.get(String(mo.id));
        if (last) ready = maxDate(ready, last); else missing++;
      }
      return {
        name: o.name, partner: nm(o.partner_id), date_order: d10(o.date_order), currency: cur,
        amount_doc: num(o.amount_untaxed), amount_inr: m.inr, amount_usd: m.usd,
        invoice_status: o.invoice_status || null, delivery_status: o.delivery_status || null,
        original_delivery: d10(o.x_studio_original_delivery_date) || d10(o.commitment_date) || d10(o.expected_date),
        delivery_date: d10(o.commitment_date) || d10(o.expected_date),
        effective_date: d10(o.effective_date), signed_on: d10(o.signed_on),
        mo_names: myMos.map(m => m.name), mo_missing_pack: missing,
        ready_date: ready ? addDays(ready, 1) : null,
        all_mos_done: myMos.length > 0 && myMos.every(m => m.state === 'done'),
        mos_done_date: myMos.reduce((acc: string | null, m) => maxDate(acc, d10(m.date_finished)), null),
      };
    });

    // ================= CASH: pending SOs =================
    const cash: any[] = [];
    const pendingSoRevenue: any[] = [];
    try {
      const openSos = sos.filter(o => ['to invoice', 'no'].includes(o.invoice_status));
      const lines = openSos.length ? await sr('sale.order.line', [['order_id', 'in', openSos.map(o => o.id)], ['display_type', '=', false]],
        ['order_id', 'product_uom_qty', 'qty_invoiced', 'price_unit', 'price_subtotal', 'price_total']) : [];
      const soById = new Map(openSos.map(o => [o.id, o]));
      const agg = new Map<number, { gross: number; net: number }>();
      for (const l of lines) {
        const q = num(l.product_uom_qty), rem = Math.max(0, q - num(l.qty_invoiced));
        if (!q || !rem) continue;
        const a = agg.get(id(l.order_id)) || { gross: 0, net: 0 };
        a.gross += rem * (num(l.price_total) / q); a.net += rem * (num(l.price_subtotal) / q);
        agg.set(id(l.order_id), a);
      }
      await loadAdvances(openSos.map(o => id(o.partner_id)));
      const items: any[] = [];
      for (const [oid, a] of agg) {
        const o = soById.get(oid)!; const cur = nm(o.currency_id) || 'INR';
        const g = money(a.gross, cur, num(o.currency_rate)), n = money(a.net, cur, num(o.currency_rate));
        let date = maxDate(d10(o.commitment_date) || d10(o.expected_date), d10(o.signed_on)) || today;
        if (date < today) date = today;
        items.push({ kind: 'so', ref: o.name, partner: nm(o.partner_id), partner_id: id(o.partner_id), date, amount_inr: g.inr, amount_usd: g.usd, sign: 1 });
        pendingSoRevenue.push({ ref: o.name, partner: nm(o.partner_id), date, amount_inr: n.inr, amount_usd: n.usd });
      }
      cash.push(...waterfall(items, 'cust'));
    } catch (e) { warnings.push('Pending SOs: ' + e.message); }

    // ================= CASH: pending POs (incl. RFQs) =================
    try {
      const pos = await sr('purchase.order', [['state', 'in', ['draft', 'sent', 'to approve', 'purchase']]],
        ['name', 'partner_id', 'currency_id', 'currency_rate', 'date_planned', 'receipt_status', 'invoice_status', 'state'], { limit: 2000 });
      // Goods: open until fully received. Services (blank receipt status): open until fully billed.
      const open = pos.filter(p => p.receipt_status ? p.receipt_status !== 'full' : p.invoice_status !== 'invoiced');
      const serviceIds = new Set(open.filter(p => !p.receipt_status).map(p => p.id));
      const lines = open.length ? await sr('purchase.order.line', [['order_id', 'in', open.map(p => p.id)], ['display_type', '=', false]],
        ['order_id', 'product_qty', 'qty_received', 'qty_invoiced', 'price_total', 'date_planned']) : [];
      const poById = new Map(open.map(p => [p.id, p]));
      const agg = new Map<number, number>();
      for (const l of lines) {
        const q = num(l.product_qty), done = serviceIds.has(id(l.order_id)) ? num(l.qty_invoiced) : num(l.qty_received), rem = Math.max(0, q - done);
        if (!q || !rem) continue;
        agg.set(id(l.order_id), (agg.get(id(l.order_id)) || 0) + rem * (num(l.price_total) / q));
      }
      await loadAdvances(open.map(p => id(p.partner_id)));
      const items: any[] = [];
      for (const [pid, amt] of agg) {
        const p = poById.get(pid)!; const cur = nm(p.currency_id) || 'INR';
        const m = money(amt, cur, num(p.currency_rate));
        let date = d10(p.date_planned) || tomorrow; if (date < tomorrow) date = tomorrow;
        items.push({ kind: 'po', ref: p.name + (p.state !== 'purchase' ? ' (RFQ)' : ''), partner: nm(p.partner_id), partner_id: id(p.partner_id), date, amount_inr: m.inr, amount_usd: m.usd, sign: -1 });
      }
      cash.push(...waterfall(items, 'vend'));
    } catch (e) { warnings.push('Pending POs: ' + e.message); }

    // ================= CASH: open invoices & bills (incl. draft) =================
    try {
      const moves = await sr('account.move', [['move_type', 'in', ['out_invoice', 'out_refund', 'in_invoice', 'in_refund']], '|', ['state', '=', 'draft'], '&', ['state', '=', 'posted'], ['payment_state', 'not in', ['paid', 'in_payment', 'reversed']]],
        ['name', 'move_type', 'partner_id', 'invoice_date_due', 'invoice_date', 'state', 'currency_id', 'amount_residual', 'amount_residual_signed', 'amount_total', 'amount_total_signed', 'invoice_origin'], { limit: 3000 });
      for (const mv of moves) {
        const draft = mv.state === 'draft';
        const doc = Math.abs(num(draft ? mv.amount_total : mv.amount_residual));
        const cur0 = nm(mv.currency_id) || 'INR';
        let inr = Math.abs(num(draft ? mv.amount_total_signed : mv.amount_residual_signed));
        if (inr < 0.5 && doc > 0) inr = cur0 === 'INR' ? doc : doc * (inrPerUsd || 0); // drafts may lack signed totals
        if (inr < 0.5) continue;
        const cur = nm(mv.currency_id) || 'INR';
        const usd = cur === 'USD' ? doc : inrPerUsd ? inr / inrPerUsd : 0;
        const customer = mv.move_type.startsWith('out');
        const refund = mv.move_type.endsWith('refund');
        let date = d10(mv.invoice_date_due) || today; if (date < today) date = today;
        cash.push({ kind: customer ? 'invoice' : 'bill', ref: (mv.name && mv.name !== '/' ? mv.name : 'Draft') + (draft ? ' (draft)' : '') + (mv.invoice_origin ? ` · ${mv.invoice_origin}` : ''),
          partner: nm(mv.partner_id), date, amount_inr: inr, amount_usd: usd, sign: (customer ? 1 : -1) * (refund ? -1 : 1) });
      }
    } catch (e) { warnings.push('Invoices/bills: ' + e.message); }

    // ================= Invoiced revenue (for KPIs + FY) =================
    let invoiced: any[] = [];
    try {
      const fyStartYear = new Date().getUTCMonth() >= 3 ? new Date().getUTCFullYear() - 1 : new Date().getUTCFullYear() - 2;
      const inv = await sr('account.move', [['move_type', 'in', ['out_invoice', 'out_refund']], ['state', '=', 'posted'], ['invoice_date', '>=', `${fyStartYear}-04-01`]],
        ['name', 'move_type', 'partner_id', 'invoice_date', 'currency_id', 'amount_untaxed', 'amount_untaxed_signed'], { limit: 5000 });
      invoiced = inv.map(mv => {
        const cur = nm(mv.currency_id) || 'INR';
        const inr = num(mv.amount_untaxed_signed);
        const usd = cur === 'USD' ? num(mv.amount_untaxed) * Math.sign(inr || 1) : inrPerUsd ? inr / inrPerUsd : 0;
        return { ref: mv.name, partner: nm(mv.partner_id), date: d10(mv.invoice_date), amount_inr: inr, amount_usd: usd };
      });
    } catch (e) { warnings.push('Invoiced revenue: ' + e.message); }

    // ================= IGST receivable (account 178) =================
    try {
      const qStart = (s: string) => { const d = new Date(s + 'T00:00:00Z'); const fq = Math.floor(((d.getUTCMonth() + 9) % 12) / 3); return fq; };
      const lines = await sr('account.move.line', [['account_id', '=', igstAccountId], ['parent_state', '=', 'posted'], ['date', '>=', addDays(today, -400)], ['debit', '>', 0]],
        ['date', 'debit'], { limit: 10000 });
      const byPayout = new Map<string, number>();
      for (const l of lines) {
        const d = new Date(d10(l.date) + 'T00:00:00Z');
        const m = d.getUTCMonth(); // quarter calendar: Jan-Mar, Apr-Jun...
        const qEndMonth = Math.floor(m / 3) * 3 + 3; // first month of next quarter (0-based, may be 12)
        const payout = new Date(Date.UTC(d.getUTCFullYear(), qEndMonth, 15)).toISOString().slice(0, 10);
        byPayout.set(payout, (byPayout.get(payout) || 0) + num(l.debit));
      }
      void qStart;
      for (const [payout, inr] of byPayout) {
        if (payout < today.slice(0, 7) + '-01') continue; // already received
        cash.push({ kind: 'igst', ref: `IGST refund (${payout.slice(0, 7)})`, partner: 'GST', date: payout < today ? today : payout, amount_inr: inr, amount_usd: inrPerUsd ? inr / inrPerUsd : 0, sign: 1 });
      }
    } catch (e) { warnings.push('IGST 178: ' + e.message); }

    // ================= Opening cash (all asset_cash accounts) =================
    let openingCashInr = 0;
    try {
      const accts = await sr('account.account', [['account_type', '=', 'asset_cash']], ['id', 'code', 'name', 'current_balance']);
      if (accts.length && accts.some(a => a.current_balance != null && a.current_balance !== false)) {
        openingCashInr = accts.reduce((s, a) => s + num(a.current_balance), 0);
      } else if (accts.length) {
        const ls = await sr('account.move.line', [['account_id', 'in', accts.map(a => a.id)], ['parent_state', '=', 'posted']], ['balance'], { limit: 200000 });
        openingCashInr = ls.reduce((s, l) => s + num(l.balance), 0);
      } else warnings.push('Opening cash: no asset_cash accounts found');
    } catch (e) { warnings.push('Opening cash: ' + e.message); }

    // ================= Overhead (account tag) =================
    let overheadMonthly = { inr: 0, months: overheadMonths, history: {} as Record<string, number> };
    try {
      const firstThisMonth = today.slice(0, 7) + '-01';
      const d = new Date(firstThisMonth + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - overheadMonths);
      const from = d.toISOString().slice(0, 10);
      const lines = await sr('account.move.line', [['account_id.tag_ids', 'in', [overheadTagId]], ['parent_state', '=', 'posted'], ['date', '>=', from], ['date', '<', firstThisMonth]],
        ['date', 'debit', 'credit'], { limit: 20000 });
      let total = 0;
      for (const l of lines) { const v = num(l.debit) - num(l.credit); total += v; const k = d10(l.date)!.slice(0, 7); overheadMonthly.history[k] = (overheadMonthly.history[k] || 0) + v; }
      overheadMonthly.inr = total / overheadMonths;
    } catch (e) { warnings.push('Overhead tag: ' + e.message); }

    // ================= Booked capacity (open MO work orders) =================
    const bookedHoursByMonth: Record<string, number> = {};
    try {
      const openMos = mos.filter(m => !['done', 'cancel'].includes(m.state));
      if (openMos.length) {
        const wos = await sr('mrp.workorder', [['production_id', 'in', openMos.map(m => m.id)], ['state', 'not in', ['done', 'cancel']]],
          ['production_id', 'duration_expected', 'duration', 'date_start', 'date_planned_start'], { limit: 10000 });
        const moById = new Map(openMos.map(m => [m.id, m]));
        for (const w of wos) {
          const remMin = Math.max(0, num(w.duration_expected) - num(w.duration));
          if (!remMin) continue;
          const mo = moById.get(id(w.production_id));
          let dt = d10(w.date_start) || d10(w.date_planned_start) || d10(mo?.date_start) || d10(mo?.date_planned_start) || today;
          if (dt < today) dt = today;
          const k = dt.slice(0, 7);
          bookedHoursByMonth[k] = (bookedHoursByMonth[k] || 0) + remMin / 60;
        }
      }
    } catch (e) { warnings.push('Booked capacity: ' + e.message); }

    const payload = {
      inr_per_usd: inrPerUsd, today, overhead_months: overheadMonths, opening_cash_inr: openingCashInr,
      sales_orders: salesOrders, cash_items: cash, invoiced, pending_so_revenue: pendingSoRevenue,
      overhead_monthly: overheadMonthly, actual_hours_by_month: actualHoursByMonth, booked_hours_by_month: bookedHoursByMonth,
      labortrax_entry_count: lt.length, labortrax_fields: ltSampleKeys, warnings,
    };
    const duration = Date.now() - started;
    await admin.from('analytics_snapshots').insert({ payload, synced_by: userId, status: warnings.length ? 'partial' : 'ok', duration_ms: duration });
    // keep last 20
    const { data: old } = await admin.from('analytics_snapshots').select('id').order('synced_at', { ascending: false }).range(20, 200);
    if (old?.length) await admin.from('analytics_snapshots').delete().in('id', old.map(o => o.id));
    return json({ ok: true, warnings, duration_ms: duration });
  } catch (e) {
    console.error(e);
    return json({ error: e.message || String(e) }, 500);
  }
});
