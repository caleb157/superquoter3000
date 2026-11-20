// @ts-nocheck
// DKT's own books, read live from DKT's Odoo (desertkingdomtraders.odoo.com) for DKT Cash Flow
// (/tools/dkt-cash-flow): DKT's open sales orders to its customers with their purchase orders to PV,
// unpaid customer invoices, unpaid PV bills, money customers have paid that no invoice uses yet
// (deposits), money DKT has paid PV that no bill uses yet (advances), and the bank balance.
// Read-only (only search_read is ever called) and stores nothing. DKT's books are in USD.
// Admin/team users only. Credentials stay in edge-function secrets:
//   DKT_ODOO_URL      https://desertkingdomtraders.odoo.com
//   DKT_ODOO_DB       the database name (Settings → Activate developer mode shows it; usually the subdomain)
//   DKT_ODOO_API_KEY  an API key for a (preferably read-only) DKT Odoo user
// Uses Odoo 19's JSON-2 API: POST /json/2/<model>/<method> with a bearer API key.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const URL_ = (Deno.env.get('DKT_ODOO_URL') ?? '').replace(/\/+$/, '');
const DB = Deno.env.get('DKT_ODOO_DB') ?? '';
const KEY = Deno.env.get('DKT_ODOO_API_KEY') ?? '';

/** The only method this function may call: it can't change anything in DKT's Odoo. */
async function searchRead(model: string, domain: unknown[], fields: string[], extra: Record<string, unknown> = {}) {
  const res = await fetch(`${URL_}/json/2/${model}/search_read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `bearer ${KEY}`, ...(DB ? { 'X-Odoo-Database': DB } : {}) },
    body: JSON.stringify({ domain, fields, ...extra }),
  });
  if (res.status === 401 || res.status === 403) throw new Error('DKT Odoo refused the API key. Check DKT_ODOO_API_KEY (and DKT_ODOO_DB).');
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`DKT Odoo ${res.status} on ${model}: ${t.slice(0, 200)}`);
  }
  return (await res.json()) as any[];
}
const nm = (v: any) => (Array.isArray(v) ? v[1] : null);
const id = (v: any) => (Array.isArray(v) ? v[0] : null);
const num = (v: any) => (v == null || v === false ? 0 : Number(v) || 0);
const str = (v: any) => (v == null || v === false ? '' : String(v));
const day = (v: any) => str(v).slice(0, 10) || null;
const UNPAID = ['not_paid', 'partial'];
const names = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);

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
    if (!URL_ || !KEY) return json({ error: 'DKT Odoo is not connected yet. Add DKT_ODOO_URL, DKT_ODOO_DB and DKT_ODOO_API_KEY to the edge-function secrets.', not_connected: true }, 400);

    // PV as a vendor in DKT's books.
    const pv = await searchRead('res.partner', [['is_company', '=', true], ['name', 'ilike', 'parable']], ['name'], { limit: 3 });
    const pvIds = pv.map(p => p.id);

    // 1. Open sales orders: confirmed, from the last two years, still to invoice or with an unpaid invoice.
    const since = new Date(); since.setMonth(since.getMonth() - 24);
    const custInv = await searchRead('account.move',
      [['move_type', '=', 'out_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', UNPAID]],
      ['name', 'partner_id', 'commercial_partner_id', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual', 'invoice_origin', 'ref'],
      { order: 'invoice_date_due asc, id asc', limit: 300 });
    const invoiced = new Set(custInv.flatMap(r => names(str(r.invoice_origin))));
    const sos = (await searchRead('sale.order',
      [['state', '=', 'sale'], ['date_order', '>=', since.toISOString().slice(0, 10)]],
      ['name', 'partner_id', 'client_order_ref', 'date_order', 'commitment_date', 'amount_total', 'amount_invoiced', 'amount_to_invoice', 'invoice_status'],
      { order: 'date_order asc, id asc', limit: 300 }))
      .filter(r => num(r.amount_to_invoice) > 0.5 || invoiced.has(str(r.name)));
    // Customers' companies (deposits sit on the company, orders may be on a contact).
    const partnerIds = [...new Set(sos.map(r => id(r.partner_id)).filter(Boolean))];
    const parts = partnerIds.length ? await searchRead('res.partner', [['id', 'in', partnerIds]], ['commercial_partner_id'], { context: { active_test: false } }) : [];
    const company = new Map(parts.map(p => [p.id, id(p.commercial_partner_id) ?? p.id]));

    // 2. Purchase orders to PV, linked to their sales order by the PO's source document.
    const pos = pvIds.length ? await searchRead('purchase.order',
      [['partner_id', 'child_of', pvIds], ['state', 'in', ['draft', 'sent', 'to approve', 'purchase', 'done']]],
      ['name', 'origin', 'partner_ref', 'state', 'date_order', 'date_planned', 'amount_total', 'invoice_status'],
      { order: 'date_order asc, id asc', limit: 300 }) : [];

    // 3. PV bills not yet paid.
    const bills = pvIds.length ? await searchRead('account.move',
      [['move_type', '=', 'in_invoice'], ['state', '=', 'posted'], ['payment_state', 'in', UNPAID], ['partner_id', 'child_of', pvIds]],
      ['name', 'invoice_date', 'invoice_date_due', 'amount_total', 'amount_residual', 'invoice_origin', 'ref'],
      { order: 'invoice_date_due asc, id asc', limit: 200 }) : [];

    // 4. Money not yet matched to an invoice or bill: customer deposits (receivable credits) and
    //    advances to PV (payable debits).
    const openLines = await searchRead('account.move.line',
      [['parent_state', '=', 'posted'], ['reconciled', '=', false], ['account_id.account_type', 'in', ['asset_receivable', 'liability_payable']]],
      ['partner_id', 'amount_residual', 'account_id', 'account_type', 'date', 'name'], { limit: 2000 });
    const credit = new Map<number, { partner: string; usd: number }>();
    let pvPrepaid = 0;
    for (const l of openLines) {
      const pid = id(l.partner_id);
      const res = num(l.amount_residual);
      const payable = l.account_type ? l.account_type === 'liability_payable' : /payable/i.test(str(nm(l.account_id)));
      if (pid && pvIds.includes(pid)) { if (res > 0) pvPrepaid += res; continue; }
      if (!payable && pid && res < 0) {
        const c = credit.get(pid) ?? { partner: str(nm(l.partner_id)), usd: 0 };
        c.usd += -res; credit.set(pid, c);
      }
    }

    // 5. Bank: each bank journal's latest statement balance.
    const journals = await searchRead('account.journal', [['type', '=', 'bank']], ['name']);
    const banks = [];
    for (const j of journals) {
      const last = await searchRead('account.bank.statement.line', [['journal_id', '=', j.id]], ['date', 'running_balance'], { order: 'date desc, id desc', limit: 1 });
      if (last[0]) banks.push({ journal: str(j.name), balance_usd: num(last[0].running_balance), as_of: day(last[0].date) });
    }

    return json({
      pv_partner: pv.map(p => str(p.name)).join(', ') || null,
      orders: sos.map(r => ({
        name: str(r.name), partner_id: company.get(id(r.partner_id)) ?? id(r.partner_id), partner: str(nm(r.partner_id)), ref: str(r.client_order_ref),
        date: day(r.date_order), ship_date: day(r.commitment_date),
        total_usd: num(r.amount_total), invoiced_usd: num(r.amount_invoiced), to_invoice_usd: Math.max(0, num(r.amount_to_invoice)),
        pos: pos.filter(p => names(str(p.origin)).includes(str(r.name))).map(p => ({
          name: str(p.name), ref: str(p.partner_ref), state: str(p.state), date: day(p.date_order), planned: day(p.date_planned),
          total_usd: num(p.amount_total), invoice_status: str(p.invoice_status),
        })),
      })),
      invoices: custInv.map(r => ({
        name: str(r.name), partner_id: id(r.commercial_partner_id) ?? id(r.partner_id), partner: str(nm(r.partner_id)), origin: str(r.invoice_origin),
        due: day(r.invoice_date_due) || day(r.invoice_date), total_usd: num(r.amount_total), residual_usd: num(r.amount_residual),
      })),
      bills: bills.map(r => ({
        name: str(r.name), origin: str(r.invoice_origin), ref: str(r.ref),
        due: day(r.invoice_date_due) || day(r.invoice_date), total_usd: num(r.amount_total), residual_usd: num(r.amount_residual),
      })),
      customer_credit: [...credit].map(([partner_id, c]) => ({ partner_id, partner: c.partner, credit_usd: c.usd })),
      pv_prepaid_usd: pvPrepaid,
      banks,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
