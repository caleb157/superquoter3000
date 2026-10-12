// @ts-nocheck
// Reads an Odoo customer invoice for the Commercial Invoice & Packing List tool.
// action "list": recent posted customer invoices (for the picker).
// action "get":  one invoice with its lines, addresses, sales order reference and
//                per-product HSN code and IGST rate from the Odoo product.
// Odoo credentials stay in edge-function secrets; admin/team users only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), search: z.string().max(100).optional().nullable(), limit: z.number().int().min(1).max(200).optional() }),
  z.object({ action: z.literal('get'), invoice_id: z.number().int().positive() }),
]);

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
const id = (v: any) => (Array.isArray(v) ? v[0] : v || null);
const nm = (v: any) => (Array.isArray(v) ? v[1] : null);
const num = (v: any) => (v == null || v === false ? 0 : Number(v) || 0);
const str = (v: any) => (v == null || v === false ? '' : String(v));

const PARTNER_FIELDS = ['name', 'commercial_company_name', 'street', 'street2', 'city', 'state_id', 'zip', 'country_id', 'vat', 'phone', 'mobile', 'email'];
function partnerOut(p: any) {
  if (!p) return null;
  return {
    name: str(p.commercial_company_name) || str(p.name),
    contact: str(p.name),
    street: str(p.street), street2: str(p.street2), city: str(p.city),
    state: str(nm(p.state_id)), zip: str(p.zip), country: str(nm(p.country_id)),
    vat: str(p.vat), phone: str(p.phone) || str(p.mobile), email: str(p.email),
  };
}

/** IGST rate (%) from a product's customer taxes: the tax named IGST, else the
 *  largest percent tax (an export line itself is usually zero-rated under LUT). */
function igstOf(taxes: any[]): number | null {
  if (!taxes.length) return null;
  const igst = taxes.find(t => /igst/i.test(str(t.name)) || /igst/i.test(str(nm(t.tax_group_id))));
  if (igst) return num(igst.amount);
  const pct = taxes.filter(t => str(t.amount_type) === 'percent' || t.amount_type == null);
  if (!pct.length) return null;
  return Math.max(...pct.map(t => num(t.amount)));
}

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
    const body = parsed.data;

    if (body.action === 'list') {
      const domain: unknown[] = [['move_type', '=', 'out_invoice'], ['state', '=', 'posted']];
      const q = body.search?.trim();
      if (q) domain.push('|', '|', ['name', 'ilike', q], ['partner_id.name', 'ilike', q], ['invoice_origin', 'ilike', q]);
      const rows = await sr('account.move', domain,
        ['name', 'invoice_date', 'partner_id', 'amount_total', 'currency_id', 'invoice_origin', 'ref'],
        { order: 'invoice_date desc, id desc', limit: body.limit ?? 50 });
      return json({
        invoices: rows.map(r => ({
          id: r.id, name: str(r.name), date: str(r.invoice_date) || null, customer: str(nm(r.partner_id)),
          amount_total: num(r.amount_total), currency: str(nm(r.currency_id)), origin: str(r.invoice_origin), ref: str(r.ref),
        })),
      });
    }

    // --- get one invoice ---
    const [mv] = await sr('account.move', [['id', '=', body.invoice_id]],
      ['name', 'invoice_date', 'partner_id', 'partner_shipping_id', 'currency_id', 'invoice_origin', 'ref',
        'amount_untaxed', 'amount_tax', 'amount_total', 'invoice_incoterm_id', 'invoice_payment_term_id', 'company_id', 'narration', 'move_type', 'state']);
    if (!mv) return json({ error: 'Invoice not found in Odoo.' }, 404);

    const lines = (await sr('account.move.line', [['move_id', '=', mv.id], ['display_type', 'in', ['product', false]]],
      ['product_id', 'name', 'quantity', 'price_unit', 'price_subtotal', 'product_uom_id', 'sequence', 'display_type'],
      { order: 'sequence, id' })).filter(l => id(l.product_id) || num(l.quantity));

    const prodIds = [...new Set(lines.map(l => id(l.product_id)).filter(Boolean))];
    const prods = prodIds.length
      ? await sr('product.product', [['id', 'in', prodIds]],
        ['default_code', 'name', 'l10n_in_hsn_code', 'hs_code', 'taxes_id', 'weight', 'volume'], { context: { active_test: false } })
      : [];
    const taxIds = [...new Set(prods.flatMap(p => (Array.isArray(p.taxes_id) ? p.taxes_id : [])))];
    const taxes = taxIds.length
      ? await sr('account.tax', [['id', 'in', taxIds]], ['name', 'amount', 'amount_type', 'tax_group_id'], { context: { active_test: false } })
      : [];
    const taxById = new Map(taxes.map(t => [t.id, t]));
    const prodById = new Map(prods.map(p => [p.id, p]));

    const partnerIds = [...new Set([id(mv.partner_id), id(mv.partner_shipping_id)].filter(Boolean))];
    const partners = partnerIds.length ? await sr('res.partner', [['id', 'in', partnerIds]], PARTNER_FIELDS) : [];
    const partnerById = new Map(partners.map(p => [p.id, p]));

    // Buyer's order number: the sales order's customer reference, else the SO name.
    let so: any = null;
    const origin = str(mv.invoice_origin).split(',')[0].trim();
    if (origin) {
      [so] = await sr('sale.order', [['name', '=', origin]], ['name', 'client_order_ref', 'date_order', 'commitment_date', 'partner_shipping_id']);
    }

    let company: any = null;
    if (id(mv.company_id)) {
      [company] = await sr('res.company', [['id', '=', id(mv.company_id)]], ['name', 'street', 'street2', 'city', 'state_id', 'zip', 'country_id', 'vat', 'phone', 'email']);
    }

    return json({
      invoice: {
        id: mv.id, name: str(mv.name), date: str(mv.invoice_date) || null, currency: str(nm(mv.currency_id)),
        origin: str(mv.invoice_origin), ref: str(mv.ref),
        buyer_order_no: str(so?.client_order_ref) || str(so?.name) || origin,
        buyer_order_date: so?.date_order ? String(so.date_order).slice(0, 10) : null,
        sale_order: str(so?.name) || null,
        incoterm: str(nm(mv.invoice_incoterm_id)), payment_terms: str(nm(mv.invoice_payment_term_id)),
        amount_untaxed: num(mv.amount_untaxed), amount_tax: num(mv.amount_tax), amount_total: num(mv.amount_total),
        buyer: partnerOut(partnerById.get(id(mv.partner_id))),
        consignee: partnerOut(partnerById.get(id(mv.partner_shipping_id)) ?? partnerById.get(id(mv.partner_id))),
        company: company ? partnerOut(company) : null,
      },
      lines: lines.map(l => {
        const p = prodById.get(id(l.product_id));
        const pTaxes = (Array.isArray(p?.taxes_id) ? p.taxes_id : []).map((t: number) => taxById.get(t)).filter(Boolean);
        return {
          product_id: id(l.product_id), sku: str(p?.default_code), product_name: str(p?.name) || str(nm(l.product_id)),
          description: str(l.name), quantity: num(l.quantity), uom: str(nm(l.product_uom_id)),
          price_unit: num(l.price_unit), subtotal: num(l.price_subtotal),
          hsn_code: str(p?.l10n_in_hsn_code) || str(p?.hs_code) || null,
          igst_rate: igstOf(pTaxes),
          odoo_weight_kg: p?.weight ? num(p.weight) : null, odoo_volume_m3: p?.volume ? num(p.volume) : null,
        };
      }),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
