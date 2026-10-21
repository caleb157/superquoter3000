// @ts-nocheck
// Live search of Odoo employees (hr.employee) for the HR Notes picker. Read-only;
// an HR note stores only the picked employee id + name. Admins only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({
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
    const { data: allowed } = await sb.rpc('has_role', { _user_id: claims.claims.sub, _role: 'admin' });
    if (!allowed) return json({ error: 'Forbidden' }, 403);
    if (!ODOO_URL || !ODOO_USER || !ODOO_KEY) return json({ error: 'Odoo is not connected yet.' }, 400);
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
    const q = parsed.data.search?.trim();
    const domain: unknown[] = q ? [['name', 'ilike', q]] : [];
    const rows = await sr('hr.employee', domain, ['name', 'job_title', 'department_id'], { order: 'name asc', limit: parsed.data.limit ?? 30 });
    return json({ employees: rows.map(r => ({ id: r.id, name: str(r.name), job: str(r.job_title), department: str(nm(r.department_id)) })) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
