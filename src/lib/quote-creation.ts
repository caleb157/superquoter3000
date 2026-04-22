import { supabase } from '@/integrations/supabase/client';

export type QuoteProductInput = {
  // Source product (variants ride on the same id, with a different display_name + variant_id)
  id: string;
  name: string;
  sku?: string | null;
  quantity?: number | null;
  // If provided, this is the unit price the quote should use, in the *display* currency
  // (USD or INR depending on `currency`). Lets the user override calculated price.
  unit_price_override?: number | null;
  // Fallback (legacy) — USD-only target price, gets converted if currency is INR.
  target_price_usd?: number | null;
  markup_percent?: number | null;
  // Optional: render this label/photo instead of the product's defaults (used for variants)
  display_name?: string | null;
  display_photo_url?: string | null;
  variant_id?: string | null;
  variant_name?: string | null;
};

export type CreateQuoteParams = {
  inquiryId: string;
  selectedProducts: QuoteProductInput[];
  entityId: string;
  validUntil: string; // YYYY-MM-DD
  currency?: 'USD' | 'INR';
};

export type CreateQuoteResult = {
  id?: string;
  share_token?: string;
  quote_number?: string;
  error?: string;
};

/**
 * Creates a quote_snapshot row that freezes a point-in-time copy of:
 * - product line items (with dimensions, photo, CBM)
 * - the customer (id, name, company, email, logo)
 * - the company entity (full address + bank details)
 * - the inquiry reference (number, title)
 *
 * The snapshot is the source of truth for the customer-facing quote page.
 */
export async function createQuoteSnapshot(params: CreateQuoteParams): Promise<CreateQuoteResult> {
  const { inquiryId, selectedProducts, entityId, validUntil, currency } = params;
  if (selectedProducts.length === 0) return { error: 'No products selected' };
  if (!entityId) return { error: 'Company entity is required' };

  // Dedupe product IDs since variants reuse the same product_id
  const productIds = Array.from(new Set(selectedProducts.map(p => p.id)));

  // Fetch in parallel: full product details, CBM estimates, inquiry+customer, entity (with bank fields), global settings
  const [productsRes, cbmRes, inquiryRes, entityRes, gsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, sku, photo_url, quantity, target_price_usd, markup_percent, width_inch, depth_inch, height_inch, weight_kg, moq')
      .in('id', productIds),
    supabase
      .from('cbm_estimates')
      .select('product_id, final_unit_cbm')
      .in('product_id', productIds),
    (supabase as any)
      .from('customer_rfqs')
      .select('id, rfq_number, title, customer_id, exchange_rate_override, markup_percent_override, customers(id, name, company, email, logo_url)')
      .eq('id', inquiryId)
      .maybeSingle(),
    supabase
      .from('company_entities')
      .select('id, name, legal_name, entity_type, logo_url, address_line1, address_line2, city, state, postal_code, country, email, phone, website, bank_name, bank_branch, account_name, account_number, ifsc_code, routing_number, swift_code, gst_number, ein_number')
      .eq('id', entityId)
      .maybeSingle(),
    supabase.from('global_settings').select('*').limit(1).maybeSingle(),
  ]);

  if (productsRes.error) return { error: productsRes.error.message };
  if (entityRes.error) return { error: entityRes.error.message };

  const dbProducts = productsRes.data ?? [];
  const cbmMap = new Map<string, number>();
  (cbmRes.data ?? []).forEach((c: any) => {
    if (c.product_id && c.final_unit_cbm) cbmMap.set(c.product_id, Number(c.final_unit_cbm));
  });

  // Currency conversion: snapshot stores prices in the chosen display currency.
  // Inquiry-level overrides (FX, markup) win over global settings.
  const inqRow: any = inquiryRes.data ?? {};
  const { mergeSettingsWithInquiry } = await import('@/lib/inquiry-overrides');
  const effective = mergeSettingsWithInquiry(gsRes.data as any, inqRow);
  const fxRate = Number(effective?.exchange_rate ?? 90);
  const inquiryMarkup: number | null = inqRow.markup_percent_override ?? null;
  const isInr = (currency || 'USD') === 'INR';
  const toDisplay = (usd: number) => isInr ? usd * fxRate : usd;

  // Build line items from DB (single source of truth) merged with caller overrides.
  const productsJson = selectedProducts.map(sel => {
    const db: any = dbProducts.find(p => p.id === sel.id) ?? {};
    const qty = Number(sel.quantity ?? db.quantity ?? 0);
    // Prefer caller-supplied display-currency price; otherwise convert legacy USD target,
    // applying the inquiry-level markup override if the product had no explicit price.
    const baseUsd = Number(sel.target_price_usd ?? db.target_price_usd ?? 0);
    const productMarkup = Number(sel.markup_percent ?? db.markup_percent ?? 0);
    const effectiveMarkup = inquiryMarkup != null ? Number(inquiryMarkup) : productMarkup;
    // If the price was stored *before* markup, this gives us the marked-up price.
    // (Most callers pass unit_price_override anyway, so this is the legacy-fallback path.)
    const usdWithMarkup = effectiveMarkup && !sel.target_price_usd ? baseUsd * (1 + effectiveMarkup) : baseUsd;
    const unit = sel.unit_price_override != null
      ? Number(sel.unit_price_override)
      : toDisplay(usdWithMarkup);
    let unitCbm = cbmMap.get(sel.id) ?? 0;
    if (!unitCbm && db.width_inch && db.depth_inch && db.height_inch) {
      unitCbm = (Number(db.width_inch) * Number(db.depth_inch) * Number(db.height_inch)) / 61020;
    }
    return {
      product_id: sel.id,
      name: sel.display_name?.trim() || db.name || sel.name,
      sku: db.sku ?? sel.sku ?? null,
      photo_url: sel.display_photo_url ?? db.photo_url ?? null,
      quantity: qty,
      unit_price_usd: unit, // value is in display currency (USD or INR)
      total: unit * qty,
      unit_cbm: unitCbm,
      width_inch: db.width_inch ?? null,
      depth_inch: db.depth_inch ?? null,
      height_inch: db.height_inch ?? null,
      weight_kg: db.weight_kg ?? null,
      moq: db.moq ?? null,
      // Variant metadata (optional)
      variant_id: sel.variant_id ?? null,
      variant_name: sel.variant_name ?? null,
    };
  });

  const totalQty = productsJson.reduce((s, p) => s + p.quantity, 0);
  const grandTotal = productsJson.reduce((s, p) => s + p.total, 0);
  const totalCbm = productsJson.reduce((s, p) => s + p.unit_cbm * p.quantity, 0);

  const inq: any = inquiryRes.data ?? {};
  const cust: any = inq.customers ?? null;
  const customerJson = cust
    ? {
        id: cust.id,
        name: cust.name,
        company: cust.company ?? null,
        email: cust.email ?? null,
        logo_url: cust.logo_url ?? null,
      }
    : null;
  const inquiryJson = inq.id
    ? { id: inq.id, rfq_number: inq.rfq_number ?? null, title: inq.title ?? null }
    : null;

  const entityJson = entityRes.data ?? null;

  const insertPayload: any = {
    customer_rfq_id: inquiryId,
    quote_number: 'Q-' + Date.now(),
    status: 'draft',
    share_token: crypto.randomUUID(),
    products: productsJson,
    totals: {
      sku_count: productsJson.length,
      total_qty: totalQty,
      grand_total: grandTotal,
      total_cbm: totalCbm,
    },
    entity_id: entityId,
    valid_until: validUntil,
    currency: currency || 'USD',
    entity: entityJson,
    customer: customerJson,
    inquiry: inquiryJson,
  };

  const { data, error } = await (supabase as any)
    .from('quote_snapshots')
    .insert(insertPayload)
    .select('id, share_token, quote_number')
    .single();

  if (error) return { error: error.message };
  return { id: data.id, share_token: data.share_token, quote_number: data.quote_number };
}

export function defaultValidUntil(daysFromNow = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

/**
 * Updates an existing quote_snapshot's product line items (name, quantity, unit price)
 * and recomputes totals. Used by the "Edit prices" action on the Quotes page.
 */
export async function updateQuoteLineItems(
  snapshotId: string,
  products: Array<{
    product_id?: string | null;
    name: string;
    sku?: string | null;
    photo_url?: string | null;
    quantity: number;
    unit_price_usd: number; // in display currency
    unit_cbm?: number | null;
    width_inch?: number | null;
    depth_inch?: number | null;
    height_inch?: number | null;
    weight_kg?: number | null;
    moq?: number | null;
    variant_id?: string | null;
    variant_name?: string | null;
  }>,
): Promise<{ error?: string }> {
  const productsJson = products.map(p => ({
    ...p,
    total: Number(p.quantity || 0) * Number(p.unit_price_usd || 0),
  }));
  const totalQty = productsJson.reduce((s, p) => s + Number(p.quantity || 0), 0);
  const grandTotal = productsJson.reduce((s, p) => s + Number(p.total || 0), 0);
  const totalCbm = productsJson.reduce((s, p) => s + Number(p.unit_cbm || 0) * Number(p.quantity || 0), 0);

  const { error } = await (supabase as any)
    .from('quote_snapshots')
    .update({
      products: productsJson,
      totals: {
        sku_count: productsJson.length,
        total_qty: totalQty,
        grand_total: grandTotal,
        total_cbm: totalCbm,
      },
    })
    .eq('id', snapshotId);

  if (error) return { error: error.message };
  return {};
}
