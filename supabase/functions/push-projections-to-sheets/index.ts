// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/google_sheets/v4';

// ----- helpers -----
function monthStart(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function addMonths(d: Date, n: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}
function monthHeader(d: Date) {
  const m = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const y = String(d.getUTCFullYear()).slice(-2);
  return `${m} '${y}`;
}

function productWeight(p: any, status: string): number {
  if (status === 'complete' || status === 'cancelled') return 0;
  if (status === 'po') return 1.0;
  if (p.sample_stage) return 0.75;
  if (p.quote_stage === 'quoted') return 0.5;
  if (
    p.design_stage === 'designed' ||
    p.quote_stage === 'quoting' ||
    p.quote_stage === 'ready_for_quote'
  )
    return 0.25;
  return 0;
}
function effectiveCertainty(proj: any, products: any[], status: string): number {
  if (proj?.certainty_override != null) return Number(proj.certainty_override);
  if (status === 'po' || status === 'complete') return 1.0;
  if (status === 'cancelled' || status === 'paused') return 0;
  if (status === 'projected_po') return 0.5;
  if (!products?.length) return 0;
  return products.reduce((a, p) => a + productWeight(p, status), 0) / products.length;
}
function cashForMonth(proj: any, cert: number, mStart: Date, mEnd: Date): number {
  if (!proj?.projected_fob_revenue_usd) return 0;
  const fob = Number(proj.projected_fob_revenue_usd);
  const ms = [
    [proj.cust_deposit_month, proj.cust_deposit_pct],
    [proj.cust_final_month, proj.cust_final_pct],
    [proj.cust_other_month, proj.cust_other_pct],
  ];
  let total = 0;
  for (const [m, p] of ms) {
    if (!m || !p) continue;
    const d = new Date(m as string);
    if (d >= mStart && d < mEnd) total += fob * Number(p) * cert;
  }
  return total;
}

async function sheetsCall(
  path: string,
  init: RequestInit,
  lovableKey: string,
  sheetsKey: string,
) {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${lovableKey}`,
      'X-Connection-Api-Key': sheetsKey,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || text || `HTTP ${res.status}`;
    throw new Error(`Sheets API [${res.status}]: ${msg}`);
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (status: number, body: any) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GOOGLE_SHEETS_API_KEY = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!LOVABLE_API_KEY) return json(500, { ok: false, error: 'LOVABLE_API_KEY missing' });
    if (!GOOGLE_SHEETS_API_KEY) return json(500, { ok: false, error: 'Google Sheets is not connected. Link the connector in Lovable.' });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json(401, { ok: false, error: 'Unauthorized' });

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: authErr } = await userClient.auth.getClaims(token);
    if (authErr || !claims?.claims) return json(401, { ok: false, error: 'Unauthorized' });
    const userId = claims.claims.sub;
    const userEmail = claims.claims.email ?? 'unknown';

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const testOnly = !!body.test_only;

    // Settings
    const { data: settings } = await admin
      .from('global_settings')
      .select('projections_sheet_id, projections_sheet_tab_name')
      .limit(1)
      .maybeSingle();

    const sheetId = settings?.projections_sheet_id;
    const tabName = settings?.projections_sheet_tab_name || 'Projections';
    if (!sheetId) return json(400, { ok: false, error: 'Google Sheet ID is not configured in Settings → Integrations.' });

    // Test-only: just hit the metadata endpoint
    if (testOnly) {
      try {
        await sheetsCall(
          `/spreadsheets/${sheetId}?fields=spreadsheetId,properties.title`,
          { method: 'GET' },
          LOVABLE_API_KEY,
          GOOGLE_SHEETS_API_KEY,
        );
        return json(200, { ok: true, sheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}` });
      } catch (e: any) {
        return json(400, { ok: false, error: e.message });
      }
    }

    // Rate limit: 1 push / 30s per user
    const since = new Date(Date.now() - 30_000).toISOString();
    const { data: recent } = await admin
      .from('projection_push_log')
      .select('id')
      .eq('triggered_by', userId)
      .gte('triggered_at', since)
      .limit(1);
    if (recent && recent.length > 0) {
      return json(429, { ok: false, error: 'Please wait 30 seconds between pushes.' });
    }

    const startingMonth: string = body.starting_month;
    const monthsCount: number = Number(body.months_count) || 6;
    const statusFilter: string[] = Array.isArray(body.status_filter) && body.status_filter.length
      ? body.status_filter
      : ['active', 'projected_po', 'po'];

    const startDate = startingMonth ? monthStart(new Date(startingMonth)) : monthStart(new Date());
    const months: Date[] = Array.from({ length: monthsCount }, (_, i) => addMonths(startDate, i));

    // Fetch inquiries + projections + products
    const { data: rows, error: qErr } = await admin
      .from('customer_rfqs')
      .select(`
        id, rfq_number, title, status,
        customers:customer_id ( name, company ),
        inquiry_projections ( * ),
        products ( design_stage, quote_stage, sample_stage )
      `)
      .in('status', statusFilter)
      .order('created_at', { ascending: false });

    if (qErr) throw new Error(qErr.message);

    // Build 2D data
    const meta1 = `Last updated: ${new Date().toISOString()} by ${userEmail}`;
    const meta2 = `Window: ${startDate.toISOString().slice(0, 10)} for ${monthsCount} months · Status: ${statusFilter.join(', ')}`;

    const headers = [
      'Inquiry #', 'Customer', 'Status', 'Repeat Order',
      'Certainty %', 'FOB Revenue (USD)', 'GPM %', 'Expected Revenue', 'Expected GP',
      'Start Month', 'Shipping Month', 'Delivery Month',
      ...months.map(monthHeader),
      'Notes',
    ];

    const dataRows: any[][] = [];
    const totals = {
      fob: 0, expRev: 0, expGp: 0,
      perMonth: new Array(months.length).fill(0),
    };

    for (const r of (rows || [])) {
      const proj = Array.isArray(r.inquiry_projections) ? r.inquiry_projections[0] : r.inquiry_projections;
      const products = r.products || [];
      const cert = effectiveCertainty(proj, products, r.status);
      const fob = Number(proj?.projected_fob_revenue_usd) || 0;
      const gpm = Number(proj?.project_gpm) || 0;
      const expRev = fob * cert;
      const expGp = fob * gpm * cert;

      totals.fob += fob;
      totals.expRev += expRev;
      totals.expGp += expGp;

      const monthCells = months.map((m, i) => {
        const v = cashForMonth(proj, cert, m, addMonths(m, 1));
        totals.perMonth[i] += v;
        return v || 0;
      });

      dataRows.push([
        r.rfq_number ?? '',
        (r.customers as any)?.company || (r.customers as any)?.name || '',
        r.status,
        proj?.repeat_order ? 'Yes' : 'No',
        cert,
        fob,
        gpm,
        expRev,
        expGp,
        proj?.start_month ?? '',
        proj?.shipping_month ?? '',
        proj?.delivery_month ?? '',
        ...monthCells,
        proj?.notes ?? '',
      ]);
    }

    // Ensure tab exists (must happen before we try to read existing values)
    const meta = await sheetsCall(
      `/spreadsheets/${sheetId}?fields=sheets.properties`,
      { method: 'GET' },
      LOVABLE_API_KEY,
      GOOGLE_SHEETS_API_KEY,
    );
    const exists = (meta.sheets || []).some((s: any) => s.properties?.title === tabName);
    if (!exists) {
      await sheetsCall(
        `/spreadsheets/${sheetId}:batchUpdate`,
        { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }) },
        LOVABLE_API_KEY,
        GOOGLE_SHEETS_API_KEY,
      );
    }

    // Upsert by Inquiry # (column A): preserve existing rows not in this push,
    // update matching ones in place, append brand-new ones.
    let existingDataRows: any[][] = [];
    if (exists) {
      try {
        const existing = await sheetsCall(
          `/spreadsheets/${sheetId}/values/${tabName}!A5:ZZ`,
          { method: 'GET' },
          LOVABLE_API_KEY,
          GOOGLE_SHEETS_API_KEY,
        );
        const raw: any[][] = existing?.values || [];
        // Drop trailing TOTAL row and any empty rows
        existingDataRows = raw.filter(
          (r) => r && r[0] && String(r[0]).trim() !== '' && String(r[0]).trim() !== 'TOTAL',
        );
      } catch { /* tab existed but range empty — ignore */ }
    }

    const newByKey = new Map<string, any[]>();
    for (const dr of dataRows) newByKey.set(String(dr[0]), dr);

    const mergedRows: any[][] = [];
    const usedKeys = new Set<string>();
    for (const er of existingDataRows) {
      const key = String(er[0] ?? '').trim();
      if (newByKey.has(key)) {
        mergedRows.push(newByKey.get(key)!);
        usedKeys.add(key);
      } else {
        mergedRows.push(er);
      }
    }
    for (const dr of dataRows) {
      const key = String(dr[0]);
      if (!usedKeys.has(key)) mergedRows.push(dr);
    }

    // Recompute totals across merged set (existing + updated + new)
    // Column layout: 0 Inquiry, 1 Customer, 2 Status, 3 Repeat, 4 Cert, 5 FOB,
    // 6 GPM, 7 ExpRev, 8 ExpGP, 9-11 month-date cols, 12.. month cells, last Notes
    const monthStartCol = 12;
    const num = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const mTotals = {
      fob: 0, expRev: 0, expGp: 0,
      perMonth: new Array(monthsCount).fill(0),
    };
    for (const r of mergedRows) {
      mTotals.fob    += num(r[5]);
      mTotals.expRev += num(r[7]);
      mTotals.expGp  += num(r[8]);
      for (let i = 0; i < monthsCount; i++) {
        mTotals.perMonth[i] += num(r[monthStartCol + i]);
      }
    }

    const totalRow: any[] = [
      'TOTAL', '', '', '',
      '', mTotals.fob, '', mTotals.expRev, mTotals.expGp,
      '', '', '',
      ...mTotals.perMonth,
      '',
    ];

    const values: any[][] = [
      [meta1],
      [meta2],
      [],
      headers,
      ...mergedRows,
      totalRow,
    ];

    // Clear & write merged result (clear wipes any leftover stale TOTAL row beyond new length)
    await sheetsCall(
      `/spreadsheets/${sheetId}/values/${tabName}!A:ZZ:clear`,
      { method: 'POST', body: '{}' },
      LOVABLE_API_KEY,
      GOOGLE_SHEETS_API_KEY,
    );
    await sheetsCall(
      `/spreadsheets/${sheetId}/values/${tabName}!A1?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values }) },
      LOVABLE_API_KEY,
      GOOGLE_SHEETS_API_KEY,
    );


    const rowsWritten = dataRows.length;
    await admin.from('projection_push_log').insert({
      triggered_by: userId,
      status_filter: statusFilter,
      starting_month: startDate.toISOString().slice(0, 10),
      months_count: monthsCount,
      rows_written: rowsWritten,
      success: true,
    });

    return json(200, {
      ok: true,
      rows_written: rowsWritten,
      sheet_url: `https://docs.google.com/spreadsheets/d/${sheetId}`,
    });
  } catch (e: any) {
    const msg = e?.message || 'Unknown error';
    try {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      await admin.from('projection_push_log').insert({
        success: false,
        error_message: msg,
      });
    } catch {}
    return json(500, { ok: false, error: msg });
  }
});
