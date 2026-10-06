// Receives Odoo automation webhooks and creates task sets from task_automation_rules.
// Auth: shared token from task_automation_config, sent as header `x-webhook-token` or `?token=`.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

const TRIGGERS = ['so_created', 'so_confirmed', 'so_closed', 'mo_created', 'mo_confirmed', 'mo_closed'] as const;

const Body = z.object({
  event: z.enum(TRIGGERS),
  so_number: z.string().max(100).optional().nullable(),
  mo_number: z.string().max(100).optional().nullable(),
  customer: z.string().max(300).optional().nullable(),
  customer_ref: z.string().max(500).optional().nullable(),
  sku: z.string().max(200).optional().nullable(),
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Odoo many2one values arrive as [id, "Name"], {id, display_name}, or plain strings.
const m2o = (v: unknown): string | null => {
  if (v == null || v === false) return null;
  if (Array.isArray(v)) return v[1] != null ? String(v[1]) : null;
  if (typeof v === 'object') { const o = v as any; return o.display_name ?? o.name ?? null; }
  return String(v);
};
const str = (v: unknown): string | null => (v == null || v === false || v === '' ? null : String(v));

// Accepts our clean format or Odoo's native "Send Webhook Notification" payload (event via ?event=).
function normalize(raw: any, qEvent: string | null) {
  if (!raw || typeof raw !== 'object') return raw;
  const event = raw.event ?? qEvent;
  if (raw.so_number || raw.mo_number) return { ...raw, event };
  const model = String(raw._model ?? '');
  const isMo = model === 'mrp.production' || String(event ?? '').startsWith('mo_');
  if (isMo) {
    // product_id display is often "[SKU] Name"; prefer default_code if sent.
    const prod = m2o(raw.product_id);
    const sku = str(raw.default_code) ?? (prod?.match(/^\[([^\]]+)\]/)?.[1] ?? prod);
    return { event, mo_number: str(raw.name), sku, so_number: str(raw.origin) };
  }
  return { event, so_number: str(raw.name), customer: m2o(raw.partner_id), customer_ref: str(raw.client_order_ref) };
}

// Looks up res.partner name by id via Odoo JSON-RPC; returns null on any failure (2s budget).
async function partnerName(id: number): Promise<string | null> {
  const url = (Deno.env.get('ODOO_URL') ?? '').replace(/\/+$/, '');
  const db = Deno.env.get('ODOO_DB') ?? 'parableventures';
  const user = Deno.env.get('ODOO_USERNAME') ?? '';
  const key = Deno.env.get('ODOO_API_KEY') ?? '';
  if (!url || !user || !key) return null;
  const signal = AbortSignal.timeout(2000);
  const rpc = async (service: string, method: string, args: unknown[]) => {
    const r = await fetch(`${url}/jsonrpc`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error?.data?.message ?? 'odoo error');
    return j.result;
  };
  try {
    const uid = await rpc('common', 'authenticate', [db, user, key, {}]);
    if (!uid) return null;
    const res = await rpc('object', 'execute_kw', [db, uid, key, 'res.partner', 'read', [[id]], { fields: ['name'], context: { active_test: false } }]);
    return res?.[0]?.name ? String(res[0].name) : null;
  } catch (e) {
    console.log('partner lookup failed', String(e));
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const token = req.headers.get('x-webhook-token') ?? new URL(req.url).searchParams.get('token');
  const { data: cfg } = await admin.from('task_automation_config').select('webhook_token').eq('id', 1).maybeSingle();
  if (!token || !cfg || token !== cfg.webhook_token) return json({ error: 'Unauthorized' }, 401);

  let raw: any;
  try { raw = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  console.log("odoo-task-webhook payload", JSON.stringify(raw).slice(0, 2000), "event=", new URL(req.url).searchParams.get("event"));
  const parsed = Body.safeParse(normalize(raw, new URL(req.url).searchParams.get('event')));
  if (!parsed.success) return json({ error: parsed.error.flatten().fieldErrors }, 400);
  const p = parsed.data;
  // Odoo's native webhook sends partner_id as a bare integer; resolve it to the name.
  if (p.customer && /^\d+$/.test(p.customer)) {
    const name = await partnerName(Number(p.customer));
    if (name) p.customer = name;
  }

  const isMo = p.event.startsWith('mo_');
  const vars: Record<string, string> = {
    so_number: p.so_number ?? '', mo_number: p.mo_number ?? '',
    customer: p.customer ?? '', customer_ref: p.customer_ref ?? '', sku: p.sku ?? '',
  };
  const render = (s: string) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '').replace(/\s{2,}/g, ' ').trim();

  const association_type = isMo ? 'odoo_mo' : 'odoo_so';
  const association_id = (isMo ? p.mo_number : p.so_number) || null;
  if (!association_id) return json({ error: isMo ? 'mo_number required' : 'so_number required' }, 400);
  const association_label = isMo
    ? (p.sku || null)
    : ([p.customer, p.customer_ref].filter(Boolean).join(' · ') || null);

  const { data: rules, error } = await admin.from('task_automation_rules')
    .select('id, name, tasks').eq('trigger_event', p.event).eq('active', true);
  if (error) return json({ error: error.message }, 500);

  const today = new Date();
  const rows: any[] = [];
  for (const r of rules ?? []) {
    for (const t of (Array.isArray(r.tasks) ? r.tasks : []) as any[]) {
      if (!t?.title) continue;
      let due: string | null = null;
      if (typeof t.due_offset_days === 'number') {
        const d = new Date(today); d.setUTCDate(d.getUTCDate() + t.due_offset_days);
        due = d.toISOString().slice(0, 10);
      }
      rows.push({
        title: render(String(t.title)).slice(0, 500),
        description: t.description ? render(String(t.description)) : null,
        assignee: t.assignee || null,
        priority: ['low', 'normal', 'high', 'urgent'].includes(t.priority) ? t.priority : 'normal',
        due_date: due,
        status: 'open',
        association_type, association_id, association_label,
        source_event: `${p.event}:${r.id}`,
      });
    }
  }

  if (rows.length) {
    const { error: insErr } = await admin.from('tasks').insert(rows);
    if (insErr) return json({ error: insErr.message }, 500);
  }
  return json({ ok: true, created: rows.length, rules: rules?.length ?? 0 });
});
