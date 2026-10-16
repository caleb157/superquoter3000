// @ts-nocheck
// Send to Odoo: creates a reviewed product, its new components and its BOM in Odoo through
// the API, in that order (components → finished product → BOM). Admins only.
//
// Components are looked up by SKU first (archived ones included) and reused when they exist.
// Every push makes a new BOM (Odoo allows several per product). With existingProductId the
// finished product is not created; the BOM attaches to it. New raw materials carry no cost
// (Odoo costs them from purchase orders). Company and route are left to Odoo's defaults.
// Every category/unit name is resolved before anything is written. Result -> odoo_push_log.
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
  salePrice: z.number().min(0).optional().nullable(),
  hsn: z.string().trim().max(20).optional().nullable(),
  weightKg: z.number().min(0).optional().nullable(),
  volumeM3: z.number().min(0).optional().nullable(),
  variant: z.string().trim().max(200).optional().nullable(),     // value on the global "variant" attribute
  customerSku: z.string().trim().max(100).optional().nullable(), // Odoo variant tag
});
const Line = z.object({
  productId: z.number().int().positive().optional().nullable(), // existing Odoo product.product id
  sku: z.string().trim().max(100).optional().nullable(),          // SKU of an existing or new product
  qty: z.number().positive(),
  uom: z.string().trim().min(1).max(100),
});
const Body = z.object({
  // full = components + product + BOM; product = finished product only; components = new raw materials only.
  mode: z.enum(['full', 'product', 'components']).default('full'),
  hqProductId: z.string().uuid().optional().nullable(),
  code: z.string().trim().max(100).optional().nullable(),
  bomUnits: z.number().positive().max(100000).default(1),
  existingProductId: z.number().int().positive().optional().nullable(),
  existingSku: z.string().trim().max(100).optional().nullable(),
  imageUrl: z.string().url().max(2000).optional().nullable(),
  finished: Item.optional().nullable(),
  components: z.array(Item).max(100),
  lines: z.array(Line).max(200).default([]),
});

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
/** Keeps only the fields this Odoo version has, so one payload works on Odoo 17 and 18. */
async function only(model: string, vals: Record<string, unknown>) {
  const avail = await fieldsOf(model);
  return Object.fromEntries(Object.entries(vals).filter(([k, v]) => avail.has(k) && v !== undefined));
}
const VARIANT_ATTRIBUTE_ID = 31; // Odoo's single global "variant" attribute
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
    const { finished, mode } = body;
    const components = mode === 'product' ? [] : body.components;
    const lines = mode === 'full' ? body.lines : [];
    if (mode === 'full' && !lines.length) return json({ error: 'The BOM has no lines.' }, 400);
    if (mode === 'product' && !finished) return json({ error: 'Fill in the new product.' }, 400);
    if (mode === 'components' && !components.length) return json({ error: 'There are no new items to create.' }, 400);
    if (mode === 'full' && !finished && !body.existingProductId && !body.existingSku) return json({ error: 'Pick the Odoo product, or fill in the new product.' }, 400);

    // ---- 1. Resolve every name before writing anything ----
    const [cats, uoms] = await Promise.all([
      sr('product.category', [], ['complete_name', 'name']),
      sr('uom.uom', [], ['name']),
    ]);
    const byName = (rows: any[], key: string) => new Map(rows.map(r => [norm(String(r[key] || r.name || '')), r.id]));
    // Categories by full path ("All / Expenses / …"), and by their own name when that name is unique.
    const catId = byName(cats, 'complete_name');
    const leafCount = new Map<string, number>();
    for (const c of cats) { const k = norm(String(c.name || '')); leafCount.set(k, (leafCount.get(k) ?? 0) + 1); }
    for (const c of cats) { const k = norm(String(c.name || '')); if (k && leafCount.get(k) === 1 && !catId.has(k)) catId.set(k, c.id); }
    const uomId = byName(uoms, 'name');

    const problems: string[] = [];
    const need = (map: Map<string, number>, name: string | null | undefined, what: string) => {
      if (!name) return null;
      const id = map.get(norm(name));
      if (!id) problems.push(`${what} "${name}" was not found in Odoo.`);
      return id ?? null;
    };
    const items = [...(finished && mode !== 'components' ? [{ ...finished, finished: true }] : []), ...components.map(c => ({ ...c, finished: false }))];
    const resolved = items.map(it => ({
      it,
      categ_id: need(catId, it.category, 'Category'),
      uom_id: need(uomId, it.uom, 'Unit'),
      uom_po_id: need(uomId, it.purchaseUom || it.uom, 'Purchase unit'),
    }));
    const lineUoms = lines.map(l => need(uomId, l.uom, 'Unit'));
    for (const l of lines) if (!l.productId && !l.sku) problems.push('A BOM line has no product.');
    if (problems.length) return json({ error: 'Nothing was sent. Fix these first:', problems: [...new Set(problems)] }, 400);

    // Existing products by SKU (archived included, so they are reused, never duplicated).
    const allSkus = [...new Set([...items.map(i => i.sku), ...lines.map(l => l.sku).filter(Boolean), body.existingSku].filter(Boolean) as string[])];
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

    // The HQ photo for a new finished product (skipped quietly if it can't be fetched).
    let image: string | null = null;
    if (finished && mode !== 'components' && body.imageUrl) {
      try {
        const res = await fetch(body.imageUrl);
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.length < 10_000_000) {
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            image = btoa(bin);
          }
        }
      } catch { /* no image */ }
    }

    // The existing finished product, when the BOM is for one already in Odoo.
    let fin: { id: number; tmpl: number } | null = null;
    if (!finished && mode === 'full') {
      const dom = body.existingProductId ? [['id', '=', body.existingProductId]] : [['default_code', '=', body.existingSku]];
      const [p] = await sr('product.product', dom, ['id', 'product_tmpl_id'], { limit: 1, context: { active_test: false } });
      if (!p) return json({ error: 'The picked Odoo product was not found. Nothing was sent.' }, 400);
      fin = { id: p.id, tmpl: Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : p.product_tmpl_id };
    }

    // ---- 2. Create missing components, then the finished product ----
    const tmplFields = await fieldsOf('product.template');
    const createProduct = async (r: typeof resolved[number]) => {
      const it = r.it;
      const hit = variantBySku.get(norm(it.sku));
      if (hit) { reused.push({ kind: it.finished ? 'product' : 'component', sku: it.sku, id: hit.id }); return hit; }
      if (it.finished) return createFinished(r);
      const vals: Record<string, unknown> = {
        name: it.name, default_code: it.sku, categ_id: r.categ_id, uom_id: r.uom_id, uom_po_id: r.uom_po_id,
        sale_ok: it.finished, purchase_ok: !it.finished,
        list_price: it.salePrice ?? undefined,
        l10n_in_hsn_code: it.hsn || undefined, weight: it.weightKg ?? undefined, volume: it.volumeM3 ?? undefined,
        image_1920: it.finished ? image ?? undefined : undefined,
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
    // Finished product: template-level data on product.template (name, category, HSN, tracking),
    // a single variant on the global "variant" attribute, and variant-level data on product.product
    // (SKU, photo, volume, weight, customer-SKU tag). Further variants can be added in Odoo later.
    async function createFinished(r: typeof resolved[number]) {
      const it = r.it;
      const hit = variantBySku.get(norm(it.sku));
      if (hit) { reused.push({ kind: 'product', sku: it.sku, id: hit.id }); return hit; }
      const label = (it.variant || '').trim() || 'Standard';
      const [val] = await sr('product.attribute.value', [['attribute_id', '=', VARIANT_ATTRIBUTE_ID], ['name', '=ilike', label]], ['id'], { limit: 1 });
      const valId = val?.id ?? await kw('product.attribute.value', 'create', [{ attribute_id: VARIANT_ATTRIBUTE_ID, name: label }]);
      const vals: Record<string, unknown> = {
        name: it.name, categ_id: r.categ_id, uom_id: r.uom_id, uom_po_id: r.uom_po_id,
        sale_ok: true, purchase_ok: false, list_price: it.salePrice ?? undefined,
        l10n_in_hsn_code: it.hsn || undefined,
        attribute_line_ids: [[0, 0, { attribute_id: VARIANT_ATTRIBUTE_ID, value_ids: [[6, 0, [valId]]] }]],
      };
      if (tmplFields.has('is_storable')) { vals.type = 'consu'; vals.is_storable = it.tracked; }
      else if (tmplFields.has('detailed_type')) vals.detailed_type = it.tracked ? 'product' : 'consu';
      else vals.type = it.tracked ? 'product' : 'consu';
      const tmplId = await kw('product.template', 'create', [await only('product.template', vals)]);
      const [v] = await sr('product.product', [['product_tmpl_id', '=', tmplId]], ['id'], { limit: 1, context: { active_test: false } });
      if (!v?.id) throw new Error('Odoo created the product but no variant. Check the "variant" attribute in Odoo.');
      const pv: Record<string, unknown> = { default_code: it.sku, weight: it.weightKg ?? undefined, volume: it.volumeM3 ?? undefined, image_1920: image ?? undefined };
      if (it.customerSku) {
        try {
          const [tag] = await sr('product.tag', [['name', '=ilike', it.customerSku]], ['id'], { limit: 1 });
          const tagId = tag?.id ?? await kw('product.tag', 'create', [{ name: it.customerSku }]);
          pv.additional_product_tag_ids = [[4, tagId]];
        } catch { /* tags are optional */ }
      }
      await kw('product.product', 'write', [[v.id], await only('product.product', pv)]);
      const out = { id: v.id, tmpl: tmplId };
      variantBySku.set(norm(it.sku), out);
      created.push({ kind: 'product', sku: it.sku, id: out.id });
      return out;
    }

    for (const r of resolved.filter(x => !x.it.finished)) await createProduct(r);
    const finR = resolved.find(x => x.it.finished);
    if (!fin && finR) fin = await createProduct(finR);

    // Remember the Odoo product on the HQ product, so it shows as "In Odoo" and isn't created twice.
    if (fin && body.hqProductId && (finished || mode === 'full')) {
      try {
        await sb.from('products').update({
          odoo_product_id: fin.id, odoo_template_id: fin.tmpl, odoo_sku: finished?.sku ?? body.existingSku ?? null,
          odoo_variant: finished?.variant || null, odoo_pushed_at: new Date().toISOString(),
        }).eq('id', body.hqProductId);
      } catch { /* the link is a convenience */ }
    }
    if (mode !== 'full') {
      const result = {
        ok: true, created, reused, bomId: null, bomReused: false, productTemplateId: fin?.tmpl ?? null, productId: fin?.id ?? null,
        productUrl: fin ? `${ODOO_URL}/web#id=${fin.tmpl}&model=product.template&view_type=form` : null, bomUrl: null,
      };
      await log(true, result);
      return json(result);
    }

    // ---- 3. A new BOM, always (a product can have several) ----
    let bomId: number | null = null;
    const bomReused = false;
    {
      const bomLines = lines.map((l, i) => {
        const pid = l.productId || variantBySku.get(norm(l.sku!))?.id;
        return [0, 0, { product_id: pid, product_qty: l.qty, product_uom_id: lineUoms[i] }];
      });
      bomId = await kw('mrp.bom', 'create', [await only('mrp.bom', {
        product_tmpl_id: fin.tmpl, product_qty: body.bomUnits, type: 'normal', code: body.code || undefined,
        bom_line_ids: bomLines,
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
