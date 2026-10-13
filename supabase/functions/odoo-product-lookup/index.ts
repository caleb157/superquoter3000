// @ts-nocheck
// Live, read-only Odoo product lookups for the product "Odoo" tab (Send to Odoo):
// search products to match a costing line, suggest matches by name, check which SKUs
// already exist, and list the categories / units / routes / companies the import files
// may use. Stores nothing: HQ keeps only the link a person picks (odoo_component_links).
// Odoo credentials stay in edge-function secrets; admin/team users only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('meta') }),
  z.object({ action: z.literal('search'), search: z.string().max(100).optional().nullable(), limit: z.number().int().min(1).max(50).optional() }),
  z.object({ action: z.literal('suggest'), names: z.array(z.string().max(200)).max(60) }),
  z.object({ action: z.literal('skus'), skus: z.array(z.string().max(100)).max(200) }),
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
const nm = (v: any) => (Array.isArray(v) ? String(v[1]) : '');
const str = (v: any) => (v == null || v === false ? '' : String(v));

const PRODUCT_FIELDS = ['default_code', 'name', 'display_name', 'uom_id', 'categ_id', 'is_storable', 'type', 'detailed_type', 'active'];
const toProduct = (r: any) => ({
  id: r.id,
  sku: str(r.default_code),
  name: str(r.name),
  display_name: str(r.display_name) || (r.default_code ? `[${r.default_code}] ${str(r.name)}` : str(r.name)),
  uom: nm(r.uom_id),
  category: nm(r.categ_id),
  // Odoo 18: is_storable; Odoo 17: detailed_type 'product'.
  tracked: r.is_storable === true || r.detailed_type === 'product' || r.type === 'product',
  active: r.active !== false,
});

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

    if (body.action === 'meta') {
      const [cats, uoms, routes, companies] = await Promise.all([
        sr('product.category', [], ['complete_name', 'name'], { order: 'complete_name' }),
        sr('uom.uom', [], ['name', 'category_id'], { order: 'name' }),
        sr('stock.route', [['product_selectable', '=', true]], ['name'], { order: 'name' }).catch(() => []),
        sr('res.company', [], ['name'], { order: 'name' }),
      ]);
      return json({
        categories: cats.map(c => str(c.complete_name) || str(c.name)),
        uoms: uoms.map(u => ({ name: str(u.name), category: nm(u.category_id) })),
        routes: routes.map(r => str(r.name)),
        companies: companies.map(c => str(c.name)),
      });
    }

    if (body.action === 'search') {
      const q = body.search?.trim();
      const domain: unknown[] = q ? ['|', ['default_code', 'ilike', q], ['name', 'ilike', q]] : [];
      const rows = await sr('product.product', domain, PRODUCT_FIELDS, { order: 'default_code, name', limit: body.limit ?? 20 });
      return json({ products: rows.map(toProduct) });
    }

    if (body.action === 'suggest') {
      // Best few Odoo products per HQ component name: whole name first, then every word.
      const out: Record<string, any[]> = {};
      for (const raw of [...new Set(body.names.map(n => n.trim()).filter(Boolean))]) {
        let rows = await sr('product.product', [['name', 'ilike', raw]], PRODUCT_FIELDS, { limit: 3 });
        if (!rows.length) {
          const words = raw.split(/[^A-Za-z0-9.]+/).filter(w => w.length > 2).slice(0, 4);
          if (words.length) rows = await sr('product.product', words.map(w => ['name', 'ilike', w]), PRODUCT_FIELDS, { limit: 3 });
        }
        out[raw] = rows.map(toProduct);
      }
      return json({ suggestions: out });
    }

    // skus: which of these SKUs exist in Odoo (archived ones included, so they are not re-created).
    const skus = [...new Set(body.skus.map(s => s.trim()).filter(Boolean))];
    const rows = skus.length
      ? await sr('product.product', [['default_code', 'in', skus]], PRODUCT_FIELDS, { context: { active_test: false } })
      : [];
    return json({ products: rows.map(toProduct) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
