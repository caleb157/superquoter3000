// @ts-nocheck
// Late Report: read Odoo hr.attendance check-ins for a date range (read-only). Admins only.
// Classification/penalty math lives client-side in src/lib/late-report.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const Body = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

const ODOO_URL = (Deno.env.get('ODOO_URL') ?? '').replace(/\/+$/, '');
const ODOO_DB = Deno.env.get('ODOO_DB') ?? 'parableventures';
const ODOO_USER = Deno.env.get('ODOO_USERNAME') ?? '';
const ODOO_KEY = Deno.env.get('ODOO_API_KEY') ?? '';

let rpcId = 0;
async function rpc(service: string, method: string, args: unknown[]) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service, method, args } }),
    });
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      await new Promise(r => setTimeout(r, (Number(res.headers.get('Retry-After')) || 2 ** attempt) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error?.data?.message || data.error?.message || 'Odoo error');
    return data.result;
  }
}
let uid: number | null = null;
async function kw(model: string, method: string, args: unknown[], kwargs: Record<string, unknown> = {}) {
  if (!uid) {
    uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_KEY, {}]);
    if (!uid) throw new Error('Odoo login failed — check the Odoo username and API key.');
  }
  return rpc('object', 'execute_kw', [ODOO_DB, uid, ODOO_KEY, model, method, args, kwargs]);
}

// IST day boundaries expressed in Odoo's UTC "YYYY-MM-DD HH:MM:SS".
function istToUtc(date: string, time: string) {
  const d = new Date(`${date}T${time}+05:30`);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

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
    const { from, to } = parsed.data;
    const domain = [['check_in', '>=', istToUtc(from, '00:00:00')], ['check_in', '<=', istToUtc(to, '23:59:59')]];
    const out: { employee_id: number; employee_name: string; check_in: string }[] = [];
    for (let offset = 0; ; offset += 2000) {
      const rows = await kw('hr.attendance', 'search_read', [domain], { fields: ['employee_id', 'check_in'], order: 'check_in asc', limit: 2000, offset });
      for (const r of rows) {
        if (!Array.isArray(r.employee_id) || !r.check_in) continue;
        out.push({ employee_id: r.employee_id[0], employee_name: r.employee_id[1], check_in: String(r.check_in).replace(' ', 'T') + 'Z' });
      }
      if (rows.length < 2000) break;
    }
    return json({ entries: out });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
