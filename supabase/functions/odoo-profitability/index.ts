// @ts-nocheck
// Server-side Odoo reader for the Sales Order Profitability page.
// Odoo credentials stay in edge-function secrets; only admin/team users can call it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  search: z.string().max(100).optional().nullable(),
  limit: z.number().int().min(1).max(500).optional(),
  shipping_account_id: z.number().int().positive().optional().nullable(),
});

const DEFAULT_SHIPPING_ACCOUNT_ID = 170;
// MO states that mean the job is finished (or abandoned). Anything else means
// material stock moves have not been booked yet, so the order is not costable.
const CLOSED_MO_STATES = new Set(['done', 'cancel']);

const ODOO_URL = (Deno.env.get('ODOO_URL') ?? '').replace(/\/+$/, '');
const ODOO_DB = Deno.env.get('ODOO_DB') ?? 'parableventures';
const ODOO_USER = Deno.env.get('ODOO_USERNAME') ?? '';
const ODOO_KEY = Deno.env.get('ODOO_API_KEY') ?? '';

let rpcId = 0;
async function rpc(service: string, method: string, args: unknown[]) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service, method, args } }),
  });
  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error?.data?.message || data.error?.message || 'Odoo error');
  return data.result;
}

let uid: number | null = null;
async function login() {
  if (uid) return uid;
  uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_KEY, {}]);
  if (!uid) throw new Error('Odoo login failed — check the Odoo username and API key.');
  return uid;
}
async function kw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
  const u = await login();
  return rpc('object', 'execute_kw', [ODOO_DB, u, ODOO_KEY, model, method, args, kwargs]);
}
const fieldCache: Record<string, Set<string>> = {};
async function fieldsOf(model: string) {
  if (!fieldCache[model]) {
    const f = await kw(model, 'fields_get', [], { attributes: ['type'] });
    fieldCache[model] = new Set(Object.keys(f || {}));
  }
  return fieldCache[model];
}
async function searchRead(model: string, domain: unknown[], fields: string[], extra: Record<string, unknown> = {}) {
  const avail = await fieldsOf(model);
  const use = fields.filter(f => avail.has(f));
  return (await kw(model, 'search_read', [domain], { fields: use, ...extra })) as any[];
}
const m2oId = (v: any) => (Array.isArray(v) ? v[0] : v || null);
const m2oName = (v: any) => (Array.isArray(v) ? v[1] : null);
const num = (v: any) => (v == null || v === false ? 0 : Number(v) || 0);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // --- auth: admin or team only ---
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: claims, error: authErr } = await sb.auth.getClaims(auth.replace('Bearer ', ''));
    if (authErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const { data: allowed } = await sb.rpc('is_admin_or_team', { _user_id: claims.claims.sub });
    if (!allowed) return json({ error: 'Forbidden' }, 403);

    if (!ODOO_URL || !ODOO_USER || !ODOO_KEY) {
      return json({ error: 'Odoo is not connected yet. Add the Odoo address, username and API key.' }, 400);
    }

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const { date_from, date_to, search, limit } = parsed.data;

    // --- 1. Sales orders ---
    const soDomain: unknown[] = [['state', 'in', ['sale', 'done']]];
    if (date_from) soDomain.push(['date_order', '>=', `${date_from} 00:00:00`]);
    if (date_to) soDomain.push(['date_order', '<=', `${date_to} 23:59:59`]);
    if (search?.trim()) {
      soDomain.push('|', ['name', 'ilike', search.trim()], ['partner_id.name', 'ilike', search.trim()]);
    }
    const orders = await searchRead('sale.order', soDomain,
      ['name', 'date_order', 'partner_id', 'amount_untaxed', 'amount_total', 'project_id', 'currency_id', 'state'],
      { order: 'date_order desc', limit: limit ?? 200 });

    const projectIds = [...new Set(orders.map(o => m2oId(o.project_id)).filter(Boolean))] as number[];

    // --- projects + analytic accounts ---
    const projects = projectIds.length
      ? await searchRead('project.project', [['id', 'in', projectIds]], ['name', 'analytic_account_id', 'account_id'])
      : [];
    const projectById = new Map(projects.map(p => [p.id, p]));
    const analyticByProject = new Map<number, number>();
    for (const p of projects) {
      const a = m2oId(p.analytic_account_id) ?? m2oId(p.account_id);
      if (a) analyticByProject.set(p.id, a);
    }

    // --- 2. Manufacturing orders ---
    const mos = projectIds.length
      ? await searchRead('mrp.production', [['project_id', 'in', projectIds]],
        ['name', 'product_id', 'product_qty', 'state', 'project_id', 'date_start', 'date_finished'])
      : [];
    const moIds = mos.map(m => m.id);

    // Finished product SKUs
    const finishedIds = [...new Set(mos.map(m => m2oId(m.product_id)).filter(Boolean))];
    const finished = finishedIds.length
      ? await searchRead('product.product', [['id', 'in', finishedIds]], ['default_code', 'name'])
      : [];
    const finishedById = new Map(finished.map(p => [p.id, p]));

    // --- 3. Raw material moves ---
    const moves = moIds.length
      ? await searchRead('stock.move', [['raw_material_production_id', 'in', moIds], ['state', '!=', 'cancel']],
        ['product_id', 'raw_material_production_id', 'product_uom_qty', 'quantity', 'quantity_done', 'product_uom', 'standard_price', 'price_unit'])
      : [];
    const rawIds = [...new Set(moves.map(m => m2oId(m.product_id)).filter(Boolean))];
    const raws = rawIds.length
      ? await searchRead('product.product', [['id', 'in', rawIds]], ['default_code', 'name', 'standard_price', 'type', 'detailed_type'])
      : [];
    const rawById = new Map(raws.map(p => [p.id, p]));

    // --- 4. LaborTrax entries ---
    let labor: any[] = [];
    if (moIds.length) {
      try {
        labor = await searchRead('x_labortrax_entry', [['x_studio_mo_id', 'in', moIds]],
          ['x_name', 'x_studio_mo_id', 'x_studio_work_order_category', 'x_studio_hours',
            'x_studio_direct_labor_cost', 'x_studio_allocated_overhead_cost', 'x_studio_fully_burdened_cost']);
      } catch (_e) { labor = []; }
    }

    // --- 5. Analytic lines (shipping & freight) ---
    const analyticIds = [...new Set(analyticByProject.values())];
    const aLines = analyticIds.length
      ? await searchRead('account.analytic.line', [['account_id', 'in', analyticIds]],
        ['name', 'date', 'amount', 'product_id', 'account_id'], { order: 'date desc' })
      : [];

    // --- USD rate hint (INR per USD) ---
    let inrPerUsd: number | null = null;
    try {
      const usd = await searchRead('res.currency', [['name', '=', 'USD']], ['rate', 'inverse_rate']);
      if (usd[0]) {
        const inv = num(usd[0].inverse_rate);
        const r = num(usd[0].rate);
        inrPerUsd = inv > 1 ? inv : r > 0 && r < 1 ? 1 / r : r > 1 ? r : null;
      }
    } catch (_e) { /* ignore */ }

    // --- assemble ---
    const moById = new Map(mos.map(m => [m.id, m]));
    const out = orders.map(o => {
      const pid = m2oId(o.project_id);
      const myMos = mos.filter(m => m2oId(m.project_id) === pid && pid);
      const myMoIds = new Set(myMos.map(m => m.id));
      const materials = moves.filter(mv => myMoIds.has(m2oId(mv.raw_material_production_id))).map(mv => {
        const prod = rawById.get(m2oId(mv.product_id));
        const actual = num(mv.quantity ?? mv.quantity_done);
        const price = num(mv.standard_price) || num(prod?.standard_price) || Math.abs(num(mv.price_unit));
        return {
          mo_id: m2oId(mv.raw_material_production_id),
          mo_name: m2oName(mv.raw_material_production_id),
          sku: prod?.default_code || null,
          name: prod?.name || m2oName(mv.product_id),
          type: prod?.detailed_type || prod?.type || null,
          planned_qty: num(mv.product_uom_qty),
          actual_qty: actual,
          uom: m2oName(mv.product_uom),
          unit_price_inr: price,
          total_inr: actual * price,
        };
      });
      const laborRows = labor.filter(l => myMoIds.has(m2oId(l.x_studio_mo_id))).map(l => ({
        mo_id: m2oId(l.x_studio_mo_id),
        activity: l.x_name || null,
        category: l.x_studio_work_order_category || 'Uncategorised',
        hours: num(l.x_studio_hours),
        direct_inr: num(l.x_studio_direct_labor_cost),
        overhead_inr: num(l.x_studio_allocated_overhead_cost),
        burdened_inr: num(l.x_studio_fully_burdened_cost),
      }));
      const acc = pid ? analyticByProject.get(pid) : null;
      const shipping = acc ? aLines.filter(a => m2oId(a.account_id) === acc).map(a => ({
        date: a.date, name: a.name, product: m2oName(a.product_id),
        // Odoo stores costs as negative analytic amounts; flip so cost is positive.
        net_inr: -num(a.amount),
      })) : [];
      const allDone = myMos.length > 0 && myMos.every(m => m.state === 'done');
      return {
        id: o.id,
        name: o.name,
        date_order: o.date_order,
        customer: m2oName(o.partner_id),
        project_id: pid,
        project_name: m2oName(o.project_id) || projectById.get(pid)?.name || null,
        currency: m2oName(o.currency_id) || 'USD',
        amount_untaxed: num(o.amount_untaxed),
        amount_total: num(o.amount_total),
        state: o.state,
        status: o.state === 'done' || allDone ? 'Completed' : 'In Progress',
        mos: myMos.map(m => {
          const fp = finishedById.get(m2oId(m.product_id));
          return {
            id: m.id, name: m.name, state: m.state, qty: num(m.product_qty),
            product_id: m2oId(m.product_id),
            sku: fp?.default_code || null,
            product_name: fp?.name || m2oName(m.product_id),
          };
        }),
        materials,
        labor: laborRows,
        shipping,
      };
    });

    return json({ orders: out, inr_per_usd: inrPerUsd, fetched_at: new Date().toISOString() });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
