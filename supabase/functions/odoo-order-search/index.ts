// @ts-nocheck
// Live search of Odoo sales orders (sale.order) and manufacturing orders
// (mrp.production) for the task "Associate with" picker. Read-only and stores
// nothing: the app keeps no copy of Odoo orders, the task saves only the picked
// number and label. Odoo credentials stay in edge-function secrets; admin/team users only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  kind: z.enum(['so', 'mo']),
  search: z.string().max(100).optional().nullable(),
  limit: z.number().int().min(1).max(50).optional(),
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
    const { kind, limit } = parsed.data;
    const q = parsed.data.search?.trim();

    if (kind === 'so') {
      const domain: unknown[] = [['state', '!=', 'cancel']];
      if (q) domain.push('|', '|', ['name', 'ilike', q], ['partner_id.name', 'ilike', q], ['client_order_ref', 'ilike', q]);
      const rows = await sr('sale.order', domain,
        ['name', 'partner_id', 'client_order_ref', 'state', 'date_order', 'amount_total', 'currency_id'],
        { order: 'date_order desc, id desc', limit: limit ?? 20 });
      return json({
        orders: rows.map(r => ({
          id: r.id, name: str(r.name), customer: str(nm(r.partner_id)), reference: str(r.client_order_ref),
          state: str(r.state), date: str(r.date_order).slice(0, 10) || null,
          amount_total: num(r.amount_total), currency: str(nm(r.currency_id)),
        })),
      });
    }

    const domain: unknown[] = [['state', '!=', 'cancel']];
    if (q) domain.push('|', '|', ['name', 'ilike', q], ['product_id.default_code', 'ilike', q], ['origin', 'ilike', q]);
    const rows = await sr('mrp.production', domain,
      ['name', 'product_id', 'origin', 'state', 'date_start', 'date_planned_start', 'product_qty'],
      { order: 'id desc', limit: limit ?? 20 });
    const prodIds = [...new Set(rows.map(r => (Array.isArray(r.product_id) ? r.product_id[0] : null)).filter(Boolean))];
    const prods = prodIds.length
      ? await sr('product.product', [['id', 'in', prodIds]], ['default_code'], { context: { active_test: false } })
      : [];
    const skuById = new Map(prods.map(p => [p.id, str(p.default_code)]));
    return json({
      orders: rows.map(r => ({
        id: r.id, name: str(r.name), product: str(nm(r.product_id)),
        sku: Array.isArray(r.product_id) ? (skuById.get(r.product_id[0]) ?? '') : '',
        reference: str(r.origin), state: str(r.state),
        date: str(r.date_start || r.date_planned_start).slice(0, 10) || null, quantity: num(r.product_qty),
      })),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
