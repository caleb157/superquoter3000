// @ts-nocheck
// Live costing rates: pulls Odoo's current exchange rates and LaborTrax's labor
// cost per man-hour (fully burdened + direct wages by labor type) into
// global_settings.live_*. Costing reads them only while use_live_rates is on
// (src/lib/live-rates.ts); a failed source keeps its last good value. Admin/team only.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { inrPerUnitFromOdoo, laborRatesFromEntries, laborWindow } from './rates.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ODOO_URL = (Deno.env.get('ODOO_URL') ?? '').replace(/\/+$/, '');
const ODOO_DB = Deno.env.get('ODOO_DB') ?? 'parableventures';
const ODOO_USER = Deno.env.get('ODOO_USERNAME') ?? '';
const ODOO_KEY = Deno.env.get('ODOO_API_KEY') ?? '';
const LABOR_TYPES = ['Manufacturing', 'Finishing', 'Assembly', 'Packaging', 'QC', 'Market'];
const LABOR_MONTHS = 6;

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

async function odooCurrencies(): Promise<Record<string, number>> {
  if (!ODOO_URL || !ODOO_USER || !ODOO_KEY) throw new Error('Odoo is not connected');
  const uid = await rpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_KEY, {}]);
  if (!uid) throw new Error('Odoo login failed');
  const rows = await rpc('object', 'execute_kw', [ODOO_DB, uid, ODOO_KEY, 'res.currency', 'search_read',
    [[['active', '=', true]]], { fields: ['name', 'rate', 'inverse_rate'] }]) as any[];
  const out: Record<string, number> = {};
  for (const r of rows || []) {
    const v = inrPerUnitFromOdoo(r);
    if (r?.name && v > 0) out[String(r.name).toUpperCase()] = v;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: claims, error: authErr } = await sb.auth.getClaims(auth.replace('Bearer ', ''));
    if (authErr || !claims?.claims?.sub) return json({ error: 'Unauthorized' }, 401);
    const { data: allowed } = await sb.rpc('is_admin_or_team', { _user_id: claims.claims.sub });
    if (!allowed) return json({ error: 'Forbidden' }, 403);

    const { data: gs, error: gsErr } = await admin.from('global_settings').select('id, use_live_rates').limit(1).single();
    if (gsErr || !gs) return json({ error: 'global_settings not found' }, 500);

    const now = new Date().toISOString();
    const warnings: string[] = [];
    const update: Record<string, unknown> = {};

    // ---- Odoo exchange rates ----
    let currencyRates: Record<string, number> = {};
    try {
      currencyRates = await odooCurrencies();
      if (!(currencyRates.USD > 0)) throw new Error('Odoo has no active USD rate');
      update.live_exchange_rate = +currencyRates.USD.toFixed(4);
      update.live_currency_rates = currencyRates;
      update.live_exchange_rate_at = now;
    } catch (e) { warnings.push('Odoo exchange rate: ' + e.message); }

    // ---- LaborTrax labor cost per man-hour ----
    const window = laborWindow(now.slice(0, 10), LABOR_MONTHS);
    try {
      const ltKey = Deno.env.get('LABORTRAX_API_KEY');
      if (!ltKey) throw new Error('LABORTRAX_API_KEY not set');
      const res = await fetch(`https://labor-trax.lovable.app/api/public/labor-entries?from=${window.from}`, { headers: { 'x-api-key': ltKey } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = (await res.json())?.entries || [];
      const lr = laborRatesFromEntries(entries, window, LABOR_TYPES);
      if (!(lr.burdenedPerMh > 0)) throw new Error(`no costed hours between ${window.from} and ${window.to}`);
      update.live_burdened_per_mh = +lr.burdenedPerMh.toFixed(2);
      update.live_direct_rates = Object.fromEntries(Object.entries(lr.directByType).map(([k, v]) => [k, +v.toFixed(2)]));
      update.live_labor_detail = {
        window, hours: +lr.hours.toFixed(1), entries: lr.entryCount,
        burdened_per_mh: +lr.burdenedPerMh.toFixed(2), direct_per_mh: +lr.directPerMh.toFixed(2), overhead_per_mh: +lr.overheadPerMh.toFixed(2),
        categories: lr.categories.map(c => ({ ...c, hours: +c.hours.toFixed(1), directPerMh: +c.directPerMh.toFixed(2) })),
      };
      update.live_labor_at = now;
    } catch (e) { warnings.push('LaborTrax labor rates: ' + e.message); }

    update.live_rates_warnings = warnings;
    const { error: upErr } = await admin.from('global_settings').update(update).eq('id', gs.id);
    if (upErr) return json({ error: upErr.message }, 500);

    // Quotes freeze their rate from the currencies table, so keep it in step while live rates are on.
    let currenciesUpdated = 0;
    if (gs.use_live_rates && Object.keys(currencyRates).length) {
      const { data: cur } = await admin.from('currencies').select('code, units_per_inr_base');
      for (const c of cur || []) {
        const v = currencyRates[String(c.code).toUpperCase()];
        if (!v || c.code === 'INR') continue;
        const rate = +(v * (Number(c.units_per_inr_base) || 1)).toFixed(4);
        const { error } = await admin.from('currencies').update({ import_rate: rate, export_rate: rate }).eq('code', c.code);
        if (error) warnings.push(`Currency ${c.code}: ${error.message}`); else currenciesUpdated++;
      }
    }

    return json({ ok: true, warnings, currencies_updated: currenciesUpdated, ...update });
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
});
