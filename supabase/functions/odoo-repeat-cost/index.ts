// @ts-nocheck
// Live, read-only Odoo reader for the product page's "Repeat product" check: search
// products on past sales order lines, list the operation names BOMs use (for the
// operation → labour type mapping), and pull what a finished manufacturing order of a
// product actually cost (components used and their value, hours per work order).
// Stores nothing. Odoo credentials stay in edge-function secrets; admin/team users only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('search'), search: z.string().max(100).optional().nullable(), limit: z.number().int().min(1).max(50).optional() }),
  z.object({ action: z.literal('operations') }),
  z.object({
    action: z.literal('cost'),
    product_id: z.number().int().positive(),
    sale_line_id: z.number().int().positive().optional().nullable(),
    mo_id: z.number().int().positive().optional().nullable(),
  }),
]);

const ODOO_URL = (Deno.env.get('ODOO_URL') ?? '').replace(/\/+$/, '');
const ODOO_DB = Deno.env.get('ODOO_DB') ?? 'parableventures';
const ODOO_USER = Deno.env.get('ODOO_USERNAME') ?? '';
const ODOO_KEY = Deno.env.get('ODOO_API_KEY') ?? '';

let rpcId = 0;
async function rpc(service: string, method: string, args: unknown[]) {
  // Odoo rate-limits bursts (HTTP 429/503): wait and retry with backoff, honouring Retry-After.
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
const fieldCache: Record<string, Set<string>> = {};
async function fieldsOf(model: string) {
  if (!fieldCache[model]) fieldCache[model] = new Set(Object.keys((await kw(model, 'fields_get', [], { attributes: ['type'] })) || {}));
  return fieldCache[model];
}
async function sr(model: string, domain: unknown[], fields: string[], extra: Record<string, unknown> = {}) {
  const avail = await fieldsOf(model);
  return (await kw(model, 'search_read', [domain], { fields: fields.filter(f => avail.has(f)), ...extra })) as any[];
}
const id0 = (v: any) => (Array.isArray(v) ? v[0] : null);
const nm = (v: any) => (Array.isArray(v) ? String(v[1]) : '');
const num = (v: any) => (v == null || v === false ? 0 : Number(v) || 0);
const str = (v: any) => (v == null || v === false ? '' : String(v));
/** "WH/MO/00167 - Finishing" → "Finishing" (work orders and productivity rows carry the MO name). */
const opName = (s: string) => s.replace(/^.*?\s-\s/, '').trim();

async function productsById(ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const rows = await sr('product.product', [['id', 'in', ids]], ['default_code', 'name', 'categ_id', 'standard_price', 'uom_id', 'type'], { context: { active_test: false } });
  return new Map(rows.map(r => [r.id, r]));
}

async function search(q: string | undefined, limit: number) {
  const domain: unknown[] = [['state', '!=', 'cancel'], ['display_type', '=', false], ['product_id', '!=', false]];
  if (q) domain.push('|', '|', '|', ['order_id.name', 'ilike', q], ['order_partner_id.name', 'ilike', q], ['product_id.default_code', 'ilike', q], ['product_id.name', 'ilike', q]);
  const lines = await sr('sale.order.line', domain,
    ['order_id', 'order_partner_id', 'product_id', 'product_uom_qty', 'price_unit', 'currency_id', 'create_date', 'state'],
    { order: 'id desc', limit: limit * 3 });
  const prods = await productsById([...new Set(lines.map(l => id0(l.product_id)).filter(Boolean))]);
  const seen = new Set<string>();
  const out = [];
  for (const l of lines) {
    const p = prods.get(id0(l.product_id));
    // Services (freight, sampling charges…) are never manufactured.
    if (p?.type === 'service') continue;
    const k = `${id0(l.order_id)}:${id0(l.product_id)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      sale_line_id: l.id, order: nm(l.order_id), customer: nm(l.order_partner_id),
      product_id: id0(l.product_id), sku: str(p?.default_code), name: str(p?.name) || nm(l.product_id),
      quantity: num(l.product_uom_qty), price_unit: num(l.price_unit), currency: nm(l.currency_id),
      date: str(l.create_date).slice(0, 10) || null, state: str(l.state),
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function operations() {
  const rows = await sr('mrp.routing.workcenter', [], ['name'], { limit: 2000 });
  return [...new Set(rows.map(r => str(r.name).trim()).filter(Boolean))].sort();
}

async function cost(productId: number, saleLineId: number | null | undefined, moId: number | null | undefined) {
  let sale = null;
  if (saleLineId) {
    const [l] = await sr('sale.order.line', [['id', '=', saleLineId]],
      ['order_id', 'order_partner_id', 'product_id', 'product_uom_qty', 'price_unit', 'currency_id', 'purchase_price']);
    if (l) sale = {
      sale_line_id: l.id, order: nm(l.order_id), customer: nm(l.order_partner_id), quantity: num(l.product_uom_qty),
      price_unit: num(l.price_unit), currency: nm(l.currency_id), odoo_cost_unit: num(l.purchase_price),
    };
  }
  const [prod] = await sr('product.product', [['id', '=', productId]], ['default_code', 'name', 'standard_price'], { context: { active_test: false } });

  const mos = await sr('mrp.production', [['product_id', '=', productId], ['state', '=', 'done']],
    ['name', 'origin', 'product_qty', 'qty_produced', 'date_finished'], { order: 'id desc', limit: 20 });
  const moList = mos.map(m => ({
    id: m.id, name: str(m.name), origin: str(m.origin), planned: num(m.product_qty), produced: num(m.qty_produced),
    date: str(m.date_finished).slice(0, 10) || null, linked: !!sale && str(m.origin).includes(sale.order),
  }));
  const chosen = moList.find(m => m.id === moId) ?? moList.find(m => m.linked) ?? moList[0] ?? null;
  const base = {
    product: { id: productId, sku: str(prod?.default_code), name: str(prod?.name), standard_price: num(prod?.standard_price) },
    sale, mos: moList,
  };
  if (!chosen) return { ...base, mo: null, components: [], labour: [] };

  const moveFields = ['product_id', 'product_uom_qty', 'quantity', 'product_uom', 'value', 'state'];
  const [raw, fin] = await Promise.all([
    sr('stock.move', [['raw_material_production_id', '=', chosen.id], ['state', '=', 'done']], moveFields),
    sr('stock.move', [['production_id', '=', chosen.id], ['state', '=', 'done'], ['product_id', '=', productId]], moveFields),
  ]);
  const prods = await productsById([...new Set(raw.map(m => id0(m.product_id)).filter(Boolean))]);
  // One row per component: the same product can be consumed in several moves.
  const byProduct = new Map<number, any>();
  let valueEstimated = false;
  for (const m of raw) {
    const pid = id0(m.product_id);
    const p = prods.get(pid);
    const used = num(m.quantity);
    let value = Math.abs(num(m.value));
    if (!('value' in m)) { value = used * num(p?.standard_price); valueEstimated = true; }
    const cur = byProduct.get(pid) ?? {
      odoo_product_id: pid, sku: str(p?.default_code), name: str(p?.name) || nm(m.product_id),
      category: nm(p?.categ_id), uom: nm(m.product_uom), planned: 0, used: 0, value: 0,
    };
    cur.planned += num(m.product_uom_qty);
    cur.used += used;
    cur.value += value;
    byProduct.set(pid, cur);
  }

  const [wos, prodRows] = await Promise.all([
    sr('mrp.workorder', [['production_id', '=', chosen.id]], ['name', 'duration', 'duration_expected']),
    sr('mrp.workcenter.productivity', [['production_id', '=', chosen.id]], ['workorder_id', 'duration', 'total_cost', 'employee_cost']),
  ]);
  const labour = new Map<string, { operation: string; hours: number; expected_hours: number; cost: number }>();
  const woName = new Map(wos.map(w => [w.id, opName(str(w.name))]));
  for (const w of wos) {
    const op = opName(str(w.name));
    const cur = labour.get(op) ?? { operation: op, hours: 0, expected_hours: 0, cost: 0 };
    cur.hours += num(w.duration) / 60;
    cur.expected_hours += num(w.duration_expected) / 60;
    labour.set(op, cur);
  }
  for (const t of prodRows) {
    const op = woName.get(id0(t.workorder_id)) ?? opName(nm(t.workorder_id));
    const cur = labour.get(op) ?? { operation: op, hours: num(t.duration) / 60, expected_hours: 0, cost: 0 };
    cur.cost += 'total_cost' in t ? num(t.total_cost) : (num(t.duration) / 60) * num(t.employee_cost);
    labour.set(op, cur);
  }

  const finished = fin.reduce((a, m) => ({ qty: a.qty + num(m.quantity), value: a.value + Math.abs(num(m.value)) }), { qty: 0, value: 0 });
  return {
    ...base,
    mo: { ...chosen, produced: chosen.produced || finished.qty, finished_value: finished.value, value_estimated: valueEstimated },
    components: [...byProduct.values()].filter(c => c.used > 0 || c.value > 0),
    labour: [...labour.values()],
  };
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
    const b = parsed.data;
    if (b.action === 'search') return json({ lines: await search(b.search?.trim() || undefined, b.limit ?? 25) });
    if (b.action === 'operations') return json({ operations: await operations() });
    return json(await cost(b.product_id, b.sale_line_id, b.mo_id));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
