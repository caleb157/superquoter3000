import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const h = (s: any) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response(JSON.stringify({ error: "Missing token" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Fetch RFQ by share_token
  const { data: rfq, error: rfqErr } = await supabase
    .from("vendor_rfqs")
    .select("*")
    .eq("share_token", token)
    .single();

  if (rfqErr || !rfq) {
    return new Response(JSON.stringify({ error: "Vendor RFQ not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Fetch line items
  const { data: items } = await supabase
    .from("vendor_rfq_line_items")
    .select("*")
    .eq("vendor_rfq_id", rfq.id)
    .order("sort_order");

  // Fetch project info
  let project = null;
  if (rfq.project_id) {
    const { data } = await supabase
      .from("projects")
      .select("name, customer_name")
      .eq("id", rfq.project_id)
      .single();
    project = data;
  }

  // Fetch inquiry-level incoterm (shipping_type_id_override -> shipping_types.name)
  let incoterm: string | null = null;
  if (rfq.customer_rfq_id) {
    const { data: inq } = await supabase
      .from("customer_rfqs")
      .select("shipping_type_id_override")
      .eq("id", rfq.customer_rfq_id)
      .maybeSingle();
    if (inq?.shipping_type_id_override) {
      const { data: st } = await supabase
        .from("shipping_types")
        .select("name")
        .eq("id", inq.shipping_type_id_override)
        .maybeSingle();
      incoterm = st?.name ?? null;
    }
  }

  // Fetch entity (for company header). RFQs go to Indian vendors, so prefer the
  // India entity (Parable Ventures) over the US quoting entity.
  let entity = null;
  {
    const { data } = await supabase
      .from("company_entities")
      .select("*")
      .eq("entity_type", "India")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    entity = data;
  }

  // Fallback: any entity
  if (!entity) {
    const { data } = await supabase
      .from("company_entities")
      .select("*")
      .limit(1)
      .single();
    entity = data;
  }

  const lineItems = items || [];
  const total = lineItems.reduce((s: number, item: any) => s + (item.target_price || 0) * (item.quantity || 0), 0);

  // Build HTML for PDF
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Noto Sans', sans-serif; font-size: 11px; color: #1a1a1a; padding: 40px; }
  .header { display: flex; justify-content: space-between; margin-bottom: 30px; border-bottom: 2px solid #2563eb; padding-bottom: 15px; }
  .header-left h1 { font-size: 18px; font-weight: 700; color: #2563eb; margin-bottom: 4px; }
  .header-left p { font-size: 10px; color: #666; }
  .header-right { text-align: right; }
  .header-right h2 { font-size: 14px; font-weight: 700; color: #1a1a1a; }
  .meta { display: flex; gap: 40px; margin-bottom: 20px; }
  .meta-section h3 { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .meta-section p { font-size: 11px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; padding: 8px 6px; text-align: left; border-bottom: 1px solid #e2e8f0; }
  td { padding: 8px 6px; border-bottom: 1px solid #f1f5f9; font-size: 10px; vertical-align: top; }
  .text-right { text-align: right; }
  .font-medium { font-weight: 600; }
  .total-row { border-top: 2px solid #e2e8f0; }
  .total-row td { font-weight: 700; font-size: 11px; padding-top: 10px; }
  .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; }
  .footer p { font-size: 10px; color: #666; line-height: 1.6; }
  .notes { background: #f8fafc; padding: 12px; border-radius: 4px; margin-top: 20px; }
  .notes h3 { font-size: 10px; color: #64748b; text-transform: uppercase; margin-bottom: 6px; }
  .notes p { font-size: 10px; line-height: 1.5; white-space: pre-wrap; }
  .photo { width: 36px; height: 36px; object-fit: cover; border-radius: 3px; }
  .print-bar { position: fixed; top: 0; left: 0; right: 0; background: #1e293b; color: #fff; padding: 10px 40px; display: flex; align-items: center; justify-content: space-between; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  .print-bar button { background: #2563eb; color: #fff; border: none; padding: 8px 20px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'Noto Sans', sans-serif; }
  .print-bar button:hover { background: #1d4ed8; }
  .print-bar span { font-size: 13px; opacity: 0.8; }
  .print-spacer { height: 50px; }

  @media print {
    .print-bar, .print-spacer { display: none !important; }
    body { padding: 20px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { break-after: avoid; }
    table { break-inside: auto; }
    tr { break-inside: avoid; }
    .notes, .footer { break-inside: avoid; }
    th { background: #f1f5f9 !important; }
    @page { margin: 15mm; size: A4; }
  }
</style>
</head>
<body>
  <div class="print-bar">
    <span>${h(rfq.rfq_number || 'RFQ')} — ${h(rfq.title || '')}</span>
    <button onclick="window.print()">⌘P Print / Save as PDF</button>
  </div>
  <div class="print-spacer"></div>
  <div class="header">
    <div class="header-left">
      <h1>${h(entity?.name || 'Company')}</h1>
      <p>${h(entity?.legal_name || '')}</p>
      <p>${h([entity?.address_line1, entity?.city, entity?.state, entity?.postal_code, entity?.country].filter(Boolean).join(', '))}</p>
      ${entity?.phone ? `<p>Phone: ${h(entity.phone)}</p>` : ''}
      ${entity?.email ? `<p>Email: ${h(entity.email)}</p>` : ''}
    </div>
    <div class="header-right">
      <h2>REQUEST FOR QUOTATION</h2>
      <p><strong>${h(rfq.rfq_number || '')}</strong></p>
      <p>Date: ${h(new Date(rfq.created_at).toLocaleDateString())}</p>
      ${rfq.response_due ? `<p>Response Due: ${h(new Date(rfq.response_due).toLocaleDateString())}</p>` : ''}
      ${incoterm ? `<p><strong>Incoterm:</strong> ${h(incoterm)}</p>` : ''}
    </div>
  </div>

  <div class="meta">
    ${rfq.vendor_name ? `
    <div class="meta-section">
      <h3>To</h3>
      <p><strong>${h(rfq.vendor_name)}</strong></p>
      ${rfq.vendor_address ? `<p>${h(rfq.vendor_address)}</p>` : ''}
      ${rfq.vendor_email ? `<p>${h(rfq.vendor_email)}</p>` : ''}
      ${rfq.vendor_phone ? `<p>${h(rfq.vendor_phone)}</p>` : ''}
    </div>
    ` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Item</th>
        <th>Description</th>
        <th>Dimensions</th>
        <th class="text-right">Qty</th>
        <th>Units</th>
        <th class="text-right">Target Price</th>
        <th class="text-right">Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map((item: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td class="font-medium">${h(item.item_name || '')}</td>
        <td>${h(item.description || '')}</td>
        <td>${h(item.dimensions || '')}</td>
        <td class="text-right">${h(item.quantity || 0)}</td>
        <td>${h(item.units || '')}</td>
        <td class="text-right">${item.target_price != null ? `₹${Number(item.target_price).toFixed(2)}` : '—'}</td>
        <td class="text-right font-medium">${item.target_price != null ? `₹${(item.target_price * item.quantity).toFixed(2)}` : '—'}</td>
      </tr>
      `).join('')}
      <tr class="total-row">
        <td colspan="7" class="text-right">Total Target Value</td>
        <td class="text-right">₹${total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    </tbody>
  </table>

  ${rfq.notes || rfq.delivery_deadline || rfq.payment_terms ? `
  <div class="notes">
    ${rfq.notes ? `<h3>Notes / Instructions</h3><p>${h(rfq.notes)}</p>` : ''}
    ${rfq.delivery_deadline ? `<p><strong>Delivery Deadline:</strong> ${h(rfq.delivery_deadline)}</p>` : ''}
    ${rfq.payment_terms ? `<p><strong>Payment Terms:</strong> ${h(rfq.payment_terms)}</p>` : ''}
  </div>
  ` : ''}

  <div class="footer">
    ${rfq.response_due ? `<p>Please respond by <strong>${h(new Date(rfq.response_due).toLocaleDateString())}</strong></p>` : ''}
    ${entity?.email ? `<p>Please send your quotation to: <strong>${h(entity.email)}</strong></p>` : ''}
    <p style="margin-top:10px">${h(entity?.name || '')} ${entity?.gst_number ? `| GST: ${h(entity.gst_number)}` : ''} ${entity?.ein_number ? `| EIN: ${h(entity.ein_number)}` : ''}</p>
  </div>

</body>
</html>`;

  // Return HTML (browser can print to PDF)
  return new Response(html, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
    },
  });
});
