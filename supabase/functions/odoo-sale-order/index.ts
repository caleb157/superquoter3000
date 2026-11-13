// @ts-nocheck
// "Create SO" on the inquiry Odoo page: live Odoo customers / pricelists / payment terms,
// and creating a draft quotation (sale.order, state draft) from final products already in Odoo.
// Stores nothing in HQ. Odoo credentials stay in edge-function secrets; admin/team users only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('meta') }),
  z.object({ action: z.literal('customers'), search: z.string().max(100).optional().nullable() }),
  z.object({
    action: z.literal('create'),
    partnerId: z.number().int().positive(),
    pricelistId: z.number().int().positive().nullable().optional(),
    paymentTermId: z.number().int().positive().nullable().optional(),
    commitmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    lines: z.array(z.object({
      productId: z.number().int().positive(),
      qty: z.number().positive(),
      priceUnit: z.number().min(0),
      discount: z.number().min(0).max(100),
    })).min(1).max(300),
  }),
]);

const ODOO_URL = (Deno.env.get('ODOO_URL') ?? '').replace(/\/+$/, '');
const ODOO_DB = Deno.env.get('ODOO_DB') ?? 'parableventures';
const ODOO_USER = Deno.env.get('ODOO_USERNAME') ?? '';
const ODOO_KEY = Deno.env.get('ODOO_API_KEY') ?? '';

let rpcId = 0;
async function rpc(service: string, method: string, args: unknown[]) {
  let res: Response;
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service, method, args } }),
    });
    if ((res.status !== 429 && res.status !== 503) || attempt >= 5) break;
    await res.body?.cancel();
    const after = Number(res.headers.get('Retry-After'));
    await new Promise(r => setTimeout(r, Number.isFinite(after) && after > 0 ? Math.min(after, 10) * 1000 : 500 * 2 ** attempt));
  }
  if (!res.ok) throw new Error(res.status === 429 ? 'Odoo is busy (too many requests) — wait a few seconds and try again.' : `Odoo HTTP ${res.status}`);
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
const sr = (model: string, domain: unknown[], fields: string[], extra: Record<string, unknown> = {}) =>
  kw(model, 'search_read', [domain], { fields, ...extra }) as Promise<any[]>;
const nm = (v: any) => (Array.isArray(v) ? String(v[1]) : '');
const idOf = (v: any) => (Array.isArray(v) ? Number(v[0]) : null);

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
    if (!ODOO_URL || !ODOO_USER || !ODOO_KEY) return json({ error: 'Odoo is not connected yet.' }, 400);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: 'The request was incomplete.', details: parsed.error.flatten().fieldErrors }, 400);
    const body = parsed.data;

    if (body.action === 'meta') {
      const [pls, terms, curs] = await Promise.all([
        sr('product.pricelist', [], ['name', 'currency_id'], { order: 'name' }),
        sr('account.payment.term', [], ['name'], { order: 'name' }),
        sr('res.currency', [['active', '=', true]], ['name', 'rate', 'inverse_rate']),
      ]);
      // Company currency per 1 unit (Odoo rate = units per 1 company currency).
      const companyPerUnit: Record<string, number> = {};
      for (const c of curs) {
        const r = Number(c.rate) || 0, inv = Number(c.inverse_rate) || 0;
        const v = r > 0 ? 1 / r : inv;
        if (v > 0) companyPerUnit[String(c.name).toUpperCase()] = v;
      }
      return json({
        pricelists: pls.map(p => ({ id: p.id, name: String(p.name), currency: nm(p.currency_id) })),
        paymentTerms: terms.map(t => ({ id: t.id, name: String(t.name) })),
        companyPerUnit,
      });
    }

    if (body.action === 'customers') {
      const s = (body.search ?? '').trim();
      const domain: unknown[] = [['customer_rank', '>', 0]];
      if (s) domain.push(['name', 'ilike', s]);
      const rows = await sr('res.partner', domain, ['name', 'property_product_pricelist'], { limit: 250, order: 'name' });
      return json({ customers: rows.map(r => ({ id: r.id, name: String(r.name), pricelistId: idOf(r.property_product_pricelist) })) });
    }

    // create: draft quotation only, never confirmed from HQ.
    const vals: Record<string, unknown> = {
      partner_id: body.partnerId,
      order_line: body.lines.map(l => [0, 0, { product_id: l.productId, product_uom_qty: l.qty, price_unit: l.priceUnit, discount: l.discount }]),
    };
    if (body.pricelistId) vals.pricelist_id = body.pricelistId;
    if (body.paymentTermId) vals.payment_term_id = body.paymentTermId;
    if (body.commitmentDate) vals.commitment_date = `${body.commitmentDate} 12:00:00`;
    const id = await kw('sale.order', 'create', [vals]);
    // Odoo recomputes prices from the pricelist on create in some versions; re-assert ours.
    const [so] = await sr('sale.order', [['id', '=', id]], ['name', 'amount_total', 'currency_id', 'order_line']);
    const lineRows = await sr('sale.order.line', [['order_id', '=', id]], ['product_id', 'price_unit', 'discount']);
    for (const lr of lineRows) {
      const want = body.lines.find(l => l.productId === idOf(lr.product_id));
      if (want && (Math.abs(Number(lr.price_unit) - want.priceUnit) > 0.0001 || Math.abs(Number(lr.discount) - want.discount) > 0.0001)) {
        await kw('sale.order.line', 'write', [[lr.id], { price_unit: want.priceUnit, discount: want.discount }]);
      }
    }
    const [fresh] = await sr('sale.order', [['id', '=', id]], ['name', 'amount_total', 'currency_id']);
    return json({ id, name: String(fresh?.name ?? so?.name ?? ''), amountTotal: Number(fresh?.amount_total) || 0, currency: nm(fresh?.currency_id), url: `${ODOO_URL}/odoo/sales/${id}` });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
