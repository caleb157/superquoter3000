// @ts-nocheck
// Send to Odoo: creates a reviewed product, its new components and its BOM in Odoo through
// the API, in that order (components → finished product → BOM). Admins only.
//
// Safe to run again: every product is looked up by SKU first (archived ones included) and
// reused when it exists, and no BOM is created when the product already has one, so a run
// that stopped half way picks up where it left off without duplicates. Every name the request
// uses (categories, units, routes, company) is resolved before anything is created, so a
// typo stops the run with nothing written. HQ stores only the result (odoo_push_log).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Item = z.object({
  sku: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(300),
  category: z.string().trim().min(1).max(300),
  tracked: z.boolean(),
  uom: z.string().trim().min(1).max(100),
  purchaseUom: z.string().trim().max(100).optional().nullable(),
  cost: z.number().min(0).optional().nullable(),
  salePrice: z.number().min(0).optional().nullable(),
  hsn: z.string().trim().max(20).optional().nullable(),
  weightKg: z.number().min(0).optional().nullable(),
  volumeM3: z.number().min(0).optional().nullable(),
  route: z.string().trim().max(100).optional().nullable(),
});
const Line = z.object({
  productId: z.number().int().positive().optional().nullable(), // existing Odoo product.product id
  sku: z.string().trim().max(100).optional().nullable(),          // SKU of an existing or new product
  qty: z.number().positive(),
  uom: z.string().trim().min(1).max(100),
});
const Body = z.object({
  hqProductId: z.string().uuid().optional().nullable(),
  company: z.string().trim().max(300).optional().nullable(),
  code: z.string().trim().max(100).optional().nullable(),
  finished: Item,
  components: z.array(Item).max(100),
  lines: z.array(Line).min(1).max(200),
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
/** Keeps only the fields this Odoo version has, so one payload works on Odoo 17 and 18. */
async function only(model: string, vals: Record<string, unknown>) {
  const avail = await fieldsOf(model);
  return Object.fromEntries(Object.entries(vals).filter(([k, v]) => avail.has(k) && v !== undefined));
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let sb: any = null;
  let body: any = null;
  let userId: string | null = null;
  const created: { kind: string; sku: string; id: number }[] = [];
  const reused: { kind: string; sku: string; id: number }[] = [];
  const log = async (ok: boolean, result: Record<string, unknown>) => {
    try {
      await sb?.from('odoo_push_log').insert({
        product_id: body?.hqProductId ?? null, ok, request: body, result, created_by: userId,
      });
    } catch { /* the log table is optional */ }
  };
  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: authErr } = await sb.auth.getClaims(auth.replace('Bearer ', ''));
    if (authErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    userId = claims.claims.sub;
    const { data: isAdmin } = await sb.rpc('has_role', { _user_id: userId, _role: 'admin' });
    if (!isAdmin) return json({ error: 'Only admins can send products to Odoo.' }, 403);
    if (!ODOO_URL || !ODOO_USER || !ODOO_KEY) return json({ error: 'Odoo is not connected yet. Add the Odoo address, username and API key.' }, 400);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: 'The request was incomplete.', details: parsed.error.flatten().fieldErrors }, 400);
    body = parsed.data;
    const { finished, components, lines } = body;

    // ---- 1. Resolve every name before writing anything ----
    const [cats, uoms, routes, companies] = await Promise.all([
      sr('product.category', [], ['complete_name', 'name']),
      sr('uom.uom', [], ['name']),
      sr('stock.route', [['product_selectable', '=', true]], ['name']).catch(() => []),
      sr('res.company', [], ['name']),
    ]);
    const byName = (rows: any[], key: string) => new Map(rows.map(r => [norm(String(r[key] || r.name || '')), r.id]));
    const catId = byName(cats, 'complete_name');
    const uomId = byName(uoms, 'name');
    const routeId = byName(routes, 'name');
    const companyId = byName(companies, 'name');

    const problems: string[] = [];
    const need = (map: Map<string, number>, name: string | null | undefined, what: string) => {
      if (!name) return null;
      const id = map.get(norm(name));
      if (!id) problems.push(`${what} "${name}" was not found in Odoo.`);
      return id ?? null;
    };
    const company = need(companyId, body.company, 'Company');
    const items = [{ ...finished, finished: true }, ...components.map(c => ({ ...c, finished: false }))];
    const resolved = items.map(it => ({
      it,
      categ_id: need(catId, it.category, 'Category'),
      uom_id: need(uomId, it.uom, 'Unit'),
      uom_po_id: need(uomId, it.purchaseUom || it.uom, 'Purchase unit'),
      route: need(routeId, it.route || (it.finished ? 'Manufacture' : 'Buy'), 'Route'),
    }));
    const lineUoms = lines.map(l => need(uomId, l.uom, 'Unit'));
    for (const l of lines) if (!l.productId && !l.sku) problems.push('A BOM line has no product.');
    if (problems.length) return json({ error: 'Nothing was sent. Fix these first:', problems: [...new Set(problems)] }, 400);

    // Existing products by SKU (archived included, so they are reused, never duplicated).
    const allSkus = [...new Set([...items.map(i => i.sku), ...lines.map(l => l.sku).filter(Boolean)] as string[])];
    const existing = await sr('product.product', [['default_code', 'in', allSkus]], ['default_code', 'product_tmpl_id', 'active'],
      { context: { active_test: false } });
    const variantBySku = new Map<string, { id: number; tmpl: number }>();
    for (const p of existing) variantBySku.set(norm(String(p.default_code)), { id: p.id, tmpl: Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : p.product_tmpl_id });
    for (const l of lines) {
      if (!l.productId && l.sku && !variantBySku.has(norm(l.sku)) && !items.some(i => norm(i.sku) === norm(l.sku!))) {
        problems.push(`BOM line ${l.sku} is not in Odoo and is not marked new.`);
      }
    }
    if (problems.length) return json({ error: 'Nothing was sent. Fix these first:', problems: [...new Set(problems)] }, 400);

    // ---- 2. Create missing components, then the finished product ----
    const tmplFields = await fieldsOf('product.template');
    const createProduct = async (r: typeof resolved[number]) => {
      const it = r.it;
      const hit = variantBySku.get(norm(it.sku));
      if (hit) { reused.push({ kind: it.finished ? 'product' : 'component', sku: it.sku, id: hit.id }); return hit; }
      const vals: Record<string, unknown> = {
        name: it.name, default_code: it.sku, categ_id: r.categ_id, uom_id: r.uom_id, uom_po_id: r.uom_po_id,
        sale_ok: it.finished, purchase_ok: !it.finished,
        list_price: it.salePrice ?? undefined, standard_price: it.cost ?? undefined,
        l10n_in_hsn_code: it.hsn || undefined, weight: it.weightKg ?? undefined, volume: it.volumeM3 ?? undefined,
        company_id: company ?? undefined,
        route_ids: r.route ? [[6, 0, [r.route]]] : undefined,
      };
      if (tmplFields.has('is_storable')) { vals.type = 'consu'; vals.is_storable = it.tracked; }         // Odoo 18
      else if (tmplFields.has('detailed_type')) vals.detailed_type = it.tracked ? 'product' : 'consu';     // Odoo 17
      else vals.type = it.tracked ? 'product' : 'consu';
      const tmplId = await kw('product.template', 'create', [await only('product.template', vals)]);
      const [v] = await sr('product.product', [['product_tmpl_id', '=', tmplId]], ['id'], { limit: 1, context: { active_test: false } });
      const out = { id: v?.id, tmpl: tmplId };
      variantBySku.set(norm(it.sku), out);
      created.push({ kind: it.finished ? 'product' : 'component', sku: it.sku, id: out.id });
      return out;
    };
    for (const r of resolved.slice(1)) await createProduct(r);
    const fin = await createProduct(resolved[0]);

    // ---- 3. The BOM (only when the product has none yet) ----
    const bomDomain = [['product_tmpl_id', '=', fin.tmpl]];
    const boms = await sr('mrp.bom', bomDomain, ['id', 'code'], { context: { active_test: false } });
    let bomId: number | null = null;
    let bomReused = false;
    if (boms.length) {
      bomId = boms[0].id;
      bomReused = true;
    } else {
      const bomLines = lines.map((l, i) => {
        const pid = l.productId || variantBySku.get(norm(l.sku!))?.id;
        return [0, 0, { product_id: pid, product_qty: l.qty, product_uom_id: lineUoms[i] }];
      });
      bomId = await kw('mrp.bom', 'create', [await only('mrp.bom', {
        product_tmpl_id: fin.tmpl, product_qty: 1, type: 'normal', code: body.code || undefined,
        company_id: company ?? undefined, bom_line_ids: bomLines,
      })]);
    }

    const result = {
      ok: true, created, reused, bomId, bomReused, productTemplateId: fin.tmpl, productId: fin.id,
      productUrl: `${ODOO_URL}/web#id=${fin.tmpl}&model=product.template&view_type=form`,
      bomUrl: bomId ? `${ODOO_URL}/web#id=${bomId}&model=mrp.bom&view_type=form` : null,
    };
    await log(true, result);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Anything created before the failure stays in Odoo; running again reuses it.
    await log(false, { error: msg, created, reused });
    return json({ error: msg, created, reused }, 500);
  }
});
