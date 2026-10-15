// @ts-nocheck
// PV's open business with DKT, read live from Odoo for DKT Cash Flow (/tools/dkt-cash-flow):
// confirmed sales orders to DKT that PV hasn't been fully paid for, and PV's unpaid invoices to DKT.
// DKT's advances (its unmatched payments to PV, i.e. a negative customer balance) are applied to the
// open orders earliest first, the same way PV's cash flow (odoo-analytics-sync) applies them.
// Read-only and stores nothing (the app keeps no copy of Odoo orders). Amounts come back in USD.
// Admin/team users only; Odoo credentials stay in edge-function secrets.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  // How DKT is named in Odoo (customer search). Defaults to Desert Kingdom / DKT.
  partner: z.string().max(100).optional().nullable(),
});

const ODOO_URL = (Deno.env.get('ODOO_URL') ?? '').replace(/\/+$/, '');
const ODOO_DB = Deno.env.get('ODOO_DB') ?? 'parableventures';
const ODOO_USER = Deno.env.get('ODOO_USERNAME') ?? '';
const ODOO_KEY = Deno.env.get('ODOO_API_KEY') ?? '';

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
    if (!uid) throw new Error('Odoo login failed — check the Odoo username and API key.');
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
const nm = (v: any) => (Array.isArray(v) ? v[1] : null);
const num = (v: any) => (v == null || v === false ? 0 : Number(v) || 0);
const str = (v: any) => (v == null || v === false ? '' : String(v));

const id = (v: any) => (Array.isArray(v) ? v[0] : null);
const UNPAID = ['not_paid', 'partial'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: authErr } = await sb.auth.getClaims(auth.replace('Bearer ', ''));
    if (authErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const { data: allowed } = await sb.rpc('is_admin_or_team', { _user_id: claims.claims.sub });
    if (!allowed) return json({ error: 'Forbidden' }, 403);
    if (!ODOO_URL || !ODOO_USER || !ODOO_KEY) return json({ error: 'Odoo is not connected yet. Add the Odoo address, username and API key.' }, 400);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const q = parsed.data.partner?.trim();

    // DKT's company record(s) in PV's Odoo.
    const pDomain = q
      ? [['is_company', '=', true], ['name', 'ilike', q]]
      : [['is_company', '=', true], '|', ['name', 'ilike', 'desert kingdom'], ['name', '=ilike', 'dkt%']];
    const partners = await sr('res.partner', pDomain, ['name'], { limit: 5 });
    if (!partners.length) return json({ error: `No customer named ${q || 'Desert Kingdom / DKT'} found in Odoo.` }, 404);
    const pIds = partners.map(p => p.id);

    // USD rate (Odoo company currency is INR).
    let inrPerUsd: number | null = null;
    const usdCur = await sr('res.currency', [['name', '=', 'USD']], ['rate', 'inverse_rate']);
    if (usdCur[0]) {
      const inv = num(usdCur[0].inverse_rate);
      const r = num(usdCur[0].rate);
      inrPerUsd = inv > 1 ? inv : r > 0 && r < 1 ? 1 / r : r > 1 ? r : null;
    }
    const toUsd = (amt: number, cur: string) => (cur === 'USD' || !inrPerUsd ? amt : cur === 'INR' ? amt / inrPerUsd : amt);

    const invs = await sr('account.move',
      [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['partner_id', 'child_of', pIds], ['payment_state', 'in', UNPAID]],
      ['name', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual', 'currency_id', 'invoice_origin', 'ref'],
      { order: 'invoice_date_due asc, id asc', limit: 200 });
    const invoices = invs.map(r => {
      const cur = str(nm(r.currency_id)) || 'USD';
      return {
        name: str(r.name), origin: str(r.invoice_origin), ref: str(r.ref),
        date: str(r.invoice_date) || null, due: str(r.invoice_date_due) || str(r.invoice_date) || null,
        total_usd: toUsd(num(r.amount_total), cur), residual_usd: toUsd(num(r.amount_residual), cur), currency: cur,
      };
    });
    const invoicedOrigins = new Set(invoices.flatMap(i => i.origin.split(',').map(s => s.trim())).filter(Boolean));

    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(); since.setMonth(since.getMonth() - 24);
    const sos = await sr('sale.order',
      [['state', 'in', ['sale', 'done']], ['partner_id', 'child_of', pIds], ['date_order', '>=', since.toISOString().slice(0, 10)]],
      ['name', 'client_order_ref', 'date_order', 'commitment_date', 'expected_date', 'signed_on', 'amount_untaxed', 'amount_total', 'amount_to_invoice', 'invoice_status', 'currency_id'],
      { order: 'date_order asc, id asc', limit: 300 });
    const orders = sos
      .map(r => {
        const cur = str(nm(r.currency_id)) || 'USD';
        return {
          name: str(r.name), ref: str(r.client_order_ref),
          date: str(r.date_order).slice(0, 10) || null,
          ship_date: str(r.commitment_date || r.expected_date).slice(0, 10) || null,
          // PV's cash-flow date for the order: delivery date, or the signing date if later; never before
          // today (an overdue order ships now), exactly as odoo-analytics-sync dates pending SOs.
          cash_date: (() => {
            const d = [str(r.commitment_date || r.expected_date).slice(0, 10), str(r.signed_on).slice(0, 10)].filter(Boolean).sort().pop() || today;
            return d < today ? today : d;
          })(),
          total_usd: toUsd(num(r.amount_total), cur),
          to_invoice_usd: Math.max(0, toUsd(num(r.amount_to_invoice), cur)),
          currency: cur,
        };
      })
      // Open = PV still has something to invoice, or an invoice for it is unpaid.
      .filter(o => o.to_invoice_usd > 0.5 || invoicedOrigins.has(o.name))
      .map(o => ({ ...o, advance_usd: 0 }));

    // DKT's advances: a negative customer balance (credit) is money DKT paid PV that no invoice uses yet.
    // PV company currency is INR, so convert like everything else.
    let advanceUsd = 0;
    try {
      const bal = await sr('res.partner', [['id', 'in', pIds]], ['credit', 'commercial_partner_id'], { context: { active_test: false } });
      const seen = new Set<number>();
      for (const b of bal) {
        const cp = id(b.commercial_partner_id) ?? b.id;
        if (seen.has(cp)) continue;
        seen.add(cp);
        advanceUsd += toUsd(Math.max(0, -num(b.credit)), 'INR');
      }
    } catch { /* no balance, no advance */ }
    // Earliest open order first, as PV's cash flow does.
    let left = advanceUsd;
    for (const o of [...orders].sort((a, b) => a.cash_date.localeCompare(b.cash_date))) {
      if (left <= 0) break;
      const take = Math.min(left, o.to_invoice_usd);
      o.advance_usd = take;
      left -= take;
    }

    return json({
      partner: partners.map(p => str(p.name)).join(', '), orders, invoices, advance_usd: advanceUsd, advance_unapplied_usd: Math.max(0, left),
      inr_per_usd: inrPerUsd, fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
