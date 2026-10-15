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
  z.object({ action: z.literal('prefixes') }),
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

    if (body.action === 'prefixes') {
      // SKU prefixes in use (the part before the first "-"), split into finished goods and the rest.
      const rows = await sr('product.product', [['default_code', '!=', false]], ['default_code', 'sale_ok', 'name']);
      const by = new Map<string, { prefix: string; saleable: number; other: number; sample: string }>();
      for (const r of rows) {
        const code = str(r.default_code).trim().toUpperCase();
        const m = /^([A-Z0-9]{2,6})-/.exec(code);
        if (!m) continue;
        const e = by.get(m[1]) ?? { prefix: m[1], saleable: 0, other: 0, sample: `${code} ${str(r.name)}`.slice(0, 80) };
        if (r.sale_ok) e.saleable += 1; else e.other += 1;
        by.set(m[1], e);
      }
      return json({ prefixes: [...by.values()].sort((a, b) => (b.saleable + b.other) - (a.saleable + a.other)) });
    }

    if (body.action === 'search') {
      const q = body.search?.trim();
      const domain: unknown[] = q ? ['|', ['default_code', 'ilike', q], ['name', 'ilike', q]] : [];
      const rows = await sr('product.product', domain, PRODUCT_FIELDS, { order: 'default_code, name', limit: body.limit ?? 20 });
      return json({ products: rows.map(toProduct) });
    }

    if (body.action === 'suggest') {
      // Best few Odoo products per HQ component name: whole name first, then every word.
      // Two batched Odoo queries instead of one or two per name, so Odoo isn't flooded.
      const out: Record<string, any[]> = {};
      const names = [...new Set(body.names.map(n => n.trim()).filter(Boolean))];
      const orDomain = (conds: unknown[][]) => [...Array(Math.max(0, conds.length - 1)).fill('|'), ...conds];
      const has = (r: any, w: string) => str(r.name).toLowerCase().includes(w.toLowerCase());
      if (names.length) {
        const whole = await sr('product.product', orDomain(names.map(n => ['name', 'ilike', n])), PRODUCT_FIELDS, { limit: 600 });
        for (const n of names) out[n] = whole.filter(r => has(r, n)).slice(0, 3).map(toProduct);
        const wordsOf = (n: string) => n.split(/[^A-Za-z0-9.]+/).filter(w => w.length > 2).slice(0, 4);
        const missing = names.filter(n => !out[n].length && wordsOf(n).length);
        const words = [...new Set(missing.flatMap(wordsOf))];
        if (words.length) {
          const byWord = await sr('product.product', orDomain(words.map(w => ['name', 'ilike', w])), PRODUCT_FIELDS, { limit: 1500 });
          for (const n of missing) out[n] = byWord.filter(r => wordsOf(n).every(w => has(r, w))).slice(0, 3).map(toProduct);
        }
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
