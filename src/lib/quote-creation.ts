import { supabase } from '@/integrations/supabase/client';
import { computeFreight, dimKgPerUnit, type FreightInput, type FreightLine } from '@/lib/freight';

export type QuoteProductInput = {
  id: string;
  name: string;
  sku?: string | null;
  quantity?: number | null;
  unit_price_override?: number | null;
  target_price_usd?: number | null;
  markup_percent?: number | null;
  display_name?: string | null;
  display_photo_url?: string | null;
  variant_id?: string | null;
  variant_name?: string | null;
  // When set, `id` is product_assemblies.id (not products.id) and the snapshot
  // line will include an exploded components list with each component's box size.
  assembly_id?: string | null;
};

export type CreateQuoteParams = {
  inquiryId: string;
  selectedProducts: QuoteProductInput[];
  entityId: string;
  validUntil: string; // YYYY-MM-DD
  currency?: string;
  freight?: FreightInput | null;
  incoterm?: string | null;
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
  const { inquiryId, selectedProducts, entityId, validUntil, currency, incoterm } = params;
  if (selectedProducts.length === 0) return { error: 'No products selected' };
  if (!entityId) return { error: 'Company entity is required' };
  if (!incoterm || !incoterm.trim()) return { error: 'Incoterm is required' };

  // Split inputs: regular product lines vs. assembly lines
  const assemblyInputs = selectedProducts.filter(p => !!p.assembly_id);
  const productInputs = selectedProducts.filter(p => !p.assembly_id);

  // Dedupe product IDs since variants reuse the same product_id
  const productIds = Array.from(new Set(productInputs.map(p => p.id)));
  const assemblyIds = Array.from(new Set(assemblyInputs.map(p => p.assembly_id as string)));

  // First, fetch assembly headers + components so we can also load the component products' details
  const asmHeadersRes = assemblyIds.length > 0
    ? await (supabase as any)
        .from('product_assemblies')
        .select('id, name, sku, photo_url, moq, hard_moq, markup_percent, assembly_components(id, product_id, quantity_per_assembly, sort_order)')
        .in('id', assemblyIds)
    : { data: [], error: null };
  if (asmHeadersRes.error) return { error: asmHeadersRes.error.message };
  const assemblyHeaders: any[] = asmHeadersRes.data || [];
  const componentProductIds = Array.from(new Set(
    assemblyHeaders.flatMap((a: any) => (a.assembly_components || []).map((c: any) => c.product_id)),
  ));

  // All product IDs we need to fetch details (and CBM) for: direct + assembly components
  const allProductIds = Array.from(new Set([...productIds, ...componentProductIds]));

  // Fetch in parallel: full product details, CBM estimates, inquiry+customer, entity, global settings
  const [productsRes, cbmRes, inquiryRes, entityRes, gsRes] = await Promise.all([
    allProductIds.length > 0
      ? supabase
          .from('products')
          .select('id, name, sku, photo_url, quantity, target_price_usd, markup_percent, width_inch, depth_inch, height_inch, weight_kg, moq, hard_moq, quote_notes')
          .in('id', allProductIds)
      : Promise.resolve({ data: [], error: null } as any),
    allProductIds.length > 0
      ? supabase
          .from('cbm_estimates')
          .select('product_id, final_unit_cbm, ic_width, ic_depth, ic_height, mc_width, mc_depth, mc_height, products_per_ic, products_per_mc')
          .in('product_id', allProductIds)
      : Promise.resolve({ data: [], error: null } as any),
    (supabase as any)
      .from('customer_rfqs')
      .select('id, rfq_number, title, customer_id, exchange_rate_override, quoting_currency_rate_override, markup_percent_override, customers(id, name, company, email, logo_url)')
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
  const cbmRowByProduct = new Map<string, any>();
  const cbmMap = new Map<string, number>();
  (cbmRes.data ?? []).forEach((c: any) => {
    if (c.product_id) {
      cbmRowByProduct.set(c.product_id, c);
      if (c.final_unit_cbm) cbmMap.set(c.product_id, Number(c.final_unit_cbm));
    }
  });

  // Currency conversion: snapshot stores prices in the chosen display currency.
  // Inquiry-level overrides (FX, markup) win over global settings.
  const inqRow: any = inquiryRes.data ?? {};
  const { mergeSettingsWithInquiry } = await import('@/lib/inquiry-overrides');
  const effective = mergeSettingsWithInquiry(gsRes.data as any, inqRow);
  const usdFxRate = Number(effective?.exchange_rate ?? 90); // INR per USD (used for legacy USD→INR conversion of stored target_price_usd)
  const inquiryMarkup: number | null = inqRow.markup_percent_override ?? null;
  const code = currency || 'USD';

  // Resolve the freeze rate (INR per 1 unit of display currency) from the currencies table.
  const { loadCurrencyMap, inrPerUnit } = await import('@/lib/currency');
  const fxMap = await loadCurrencyMap();
  let frozenInrPerUnit: number | null = null;
  const perCurrencyOverride = inqRow.quoting_currency_rate_override == null ? null : Number(inqRow.quoting_currency_rate_override);
  if (code === 'INR') {
    frozenInrPerUnit = 1;
  } else if (perCurrencyOverride && perCurrencyOverride > 0) {
    // Inquiry-level override wins for any non-INR currency.
    frozenInrPerUnit = perCurrencyOverride;
  } else if (code === 'USD') {
    // Prefer the consolidated currencies table rate; fall back to the legacy global_settings exchange_rate.
    const r = inrPerUnit(fxMap, 'USD', 'import');
    frozenInrPerUnit = isFinite(r) ? r : usdFxRate;
  } else {
    const r = inrPerUnit(fxMap, code, 'import');
    if (!isFinite(r)) {
      return { error: `No import rate configured for ${code}. Add it in Settings → Currencies, or set a per-inquiry override.` };
    }
    frozenInrPerUnit = r;
  }

  // Convert a USD reference price (from target_price_usd) into the display currency.
  const toDisplay = (usd: number) => {
    if (code === 'USD') return usd;
    const inr = usd * usdFxRate; // legacy: target_price_usd → INR via global FX
    if (code === 'INR') return inr;
    return inr / (frozenInrPerUnit as number);
  };

  const buildBoxSizeStr = (cbmRow: any, db: any): string | null => {
    if (cbmRow?.mc_width && cbmRow?.mc_depth && cbmRow?.mc_height) {
      const ppm = cbmRow.products_per_mc ? ` (${cbmRow.products_per_mc}/MC)` : '';
      return `${cbmRow.mc_width}" × ${cbmRow.mc_depth}" × ${cbmRow.mc_height}" master carton${ppm}`;
    }
    if (cbmRow?.ic_width && cbmRow?.ic_depth && cbmRow?.ic_height) {
      const ppi = cbmRow.products_per_ic && cbmRow.products_per_ic > 1 ? ` (${cbmRow.products_per_ic}/IC)` : '';
      return `${cbmRow.ic_width}" × ${cbmRow.ic_depth}" × ${cbmRow.ic_height}" inner carton${ppi}`;
    }
    if (db?.width_inch && db?.depth_inch && db?.height_inch) {
      return `${db.width_inch}" × ${db.depth_inch}" × ${db.height_inch}"`;
    }
    return null;
  };

  // Build line items from DB (single source of truth) merged with caller overrides.
  const productsJson = selectedProducts.map(sel => {
    // ===== Assembly line =====
    if (sel.assembly_id) {
      const asm: any = assemblyHeaders.find((a: any) => a.id === sel.assembly_id) ?? {};
      const qty = Number(sel.quantity ?? 0);
      const unit = sel.unit_price_override != null ? Number(sel.unit_price_override) : 0;
      const comps = (asm.assembly_components || [])
        .slice()
        .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      const componentsJson = comps.map((c: any) => {
        const cdb: any = dbProducts.find(p => p.id === c.product_id) ?? {};
        const cbmRow = cbmRowByProduct.get(c.product_id);
        const cbm = cbmRow?.final_unit_cbm ?? (cdb.width_inch && cdb.depth_inch && cdb.height_inch
          ? (Number(cdb.width_inch) * Number(cdb.depth_inch) * Number(cdb.height_inch)) / 61020
          : 0);
        return {
          product_id: c.product_id,
          name: cdb.name || 'Component',
          sku: cdb.sku ?? null,
          photo_url: cdb.photo_url ?? null,
          quantity_per_assembly: Number(c.quantity_per_assembly || 1),
          width_inch: cdb.width_inch ?? null,
          depth_inch: cdb.depth_inch ?? null,
          height_inch: cdb.height_inch ?? null,
          weight_kg: cdb.weight_kg ?? null,
          unit_cbm: cbm,
          box_size: buildBoxSizeStr(cbmRow, cdb),
        };
      });
      const unitCbm = componentsJson.reduce((s, c) => s + (c.unit_cbm || 0) * c.quantity_per_assembly, 0);
      const unitWeight = componentsJson.reduce((s, c) => s + (Number(c.weight_kg) || 0) * c.quantity_per_assembly, 0);
      return {
        product_id: null,
        assembly_id: sel.assembly_id,
        is_assembly: true,
        name: sel.display_name?.trim() || asm.name || sel.name,
        sku: asm.sku ?? null,
        photo_url: sel.display_photo_url ?? asm.photo_url ?? null,
        quantity: qty,
        unit_price_usd: unit,
        total: unit * qty,
        unit_cbm: unitCbm,
        weight_kg: unitWeight || null,
        moq: asm.moq ?? null,
        hard_moq: asm.hard_moq ?? null,
        components: componentsJson,
        // Variant fields kept null for assemblies
        variant_id: null,
        variant_name: null,
      };
    }

    // ===== Regular product line =====
    const db: any = dbProducts.find(p => p.id === sel.id) ?? {};
    const qty = Number(sel.quantity ?? db.quantity ?? 0);
    const baseUsd = Number(sel.target_price_usd ?? db.target_price_usd ?? 0);
    const productMarkup = Number(sel.markup_percent ?? db.markup_percent ?? 0);
    const effectiveMarkup = inquiryMarkup != null ? Number(inquiryMarkup) : productMarkup;
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
      quote_notes: db.quote_notes ?? null,
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
      hard_moq: db.hard_moq ?? null,
      box_size: buildBoxSizeStr(cbmRowByProduct.get(sel.id), db),
      variant_id: sel.variant_id ?? null,
      variant_name: sel.variant_name ?? null,
    };
  });

  const totalQty = productsJson.reduce((s, p) => s + p.quantity, 0);
  const grandTotal = productsJson.reduce((s, p) => s + p.total, 0);
  const totalCbm = productsJson.reduce((s, p) => s + p.unit_cbm * p.quantity, 0);

  // Optional rough freight estimate (sea per CBM, or air per chargeable kg).
  let freightSnap: ReturnType<typeof computeFreight> | null = null;
  if (params.freight && Number(params.freight.rate || 0) > 0) {
    const divisor = params.freight.dim_divisor || 5000;
    const freightLines: FreightLine[] = selectedProducts.map(sel => {
      if (sel.assembly_id) {
        const asm: any = assemblyHeaders.find((a: any) => a.id === sel.assembly_id) ?? {};
        const qty = Number(sel.quantity ?? 0);
        let dimUnit = 0, weightUnit = 0, cbmUnit = 0;
        for (const c of (asm.assembly_components || [])) {
          const cdb: any = dbProducts.find(p => p.id === c.product_id) ?? {};
          const qpa = Number(c.quantity_per_assembly || 1);
          dimUnit += dimKgPerUnit(cdb.width_inch, cdb.depth_inch, cdb.height_inch, divisor) * qpa;
          weightUnit += Number(cdb.weight_kg || 0) * qpa;
          const cbmRow = cbmRowByProduct.get(c.product_id);
          const cbm = cbmRow?.final_unit_cbm ?? (cdb.width_inch && cdb.depth_inch && cdb.height_inch
            ? (Number(cdb.width_inch) * Number(cdb.depth_inch) * Number(cdb.height_inch)) / 61020
            : 0);
          cbmUnit += Number(cbm || 0) * qpa;
        }
        return { quantity: qty, unit_cbm: cbmUnit, weight_kg: weightUnit, dim_kg_per_unit_override: dimUnit };
      }
      const db: any = dbProducts.find(p => p.id === sel.id) ?? {};
      const qty = Number(sel.quantity ?? db.quantity ?? 0);
      let unitCbm = cbmMap.get(sel.id) ?? 0;
      if (!unitCbm && db.width_inch && db.depth_inch && db.height_inch) {
        unitCbm = (Number(db.width_inch) * Number(db.depth_inch) * Number(db.height_inch)) / 61020;
      }
      return {
        quantity: qty,
        unit_cbm: unitCbm,
        weight_kg: db.weight_kg,
        width_inch: db.width_inch,
        depth_inch: db.depth_inch,
        height_inch: db.height_inch,
      };
    });
    freightSnap = computeFreight(freightLines, params.freight);
  }

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
      below_moq_surcharge_percent: Number((gsRes.data as any)?.below_moq_surcharge_percent ?? 0.15),
      freight: freightSnap,
    },
    entity_id: entityId,
    valid_until: validUntil,
    currency: code,
    currency_rate_inr_per_unit: frozenInrPerUnit,
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

  // Close the RFQ → Quote loop: mark every product included in the snapshot as `quoted`.
  // This is the timer-stop signal for analytics and removes products from the "ready to quote" backlog.
  if (productIds.length > 0) {
    await supabase.from('products').update({ quote_stage: 'quoted' }).in('id', productIds);
  }

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
  meta?: { payment_terms?: string | null; freight?: FreightInput | null; preserve_freight?: boolean },
): Promise<{ error?: string; products?: any[]; totals?: { sku_count: number; total_qty: number; grand_total: number; total_cbm: number; freight?: any }; payment_terms?: string | null }> {
  const productsJson = products.map(p => ({
    ...p,
    total: Number(p.quantity || 0) * Number(p.unit_price_usd || 0),
  }));
  const totalQty = productsJson.reduce((s, p) => s + Number(p.quantity || 0), 0);
  const grandTotal = productsJson.reduce((s, p) => s + Number(p.total || 0), 0);
  const totalCbm = productsJson.reduce((s, p) => s + Number(p.unit_cbm || 0) * Number(p.quantity || 0), 0);

  // Recompute freight using snapshot line data when caller sends new freight
  // settings; preserve the prior value otherwise.
  let freightSnap: any = undefined;
  if (meta && Object.prototype.hasOwnProperty.call(meta, 'freight')) {
    if (meta.freight && Number(meta.freight.rate || 0) > 0) {
      const divisor = meta.freight.dim_divisor || 5000;
      const freightLines: FreightLine[] = productsJson.map((p: any) => {
        // Assembly lines aggregate dim kg from their stored components array.
        if (p.is_assembly && Array.isArray(p.components)) {
          let dimUnit = 0;
          for (const c of p.components) {
            const qpa = Number(c.quantity_per_assembly || 1);
            dimUnit += dimKgPerUnit(c.width_inch, c.depth_inch, c.height_inch, divisor) * qpa;
          }
          return {
            quantity: Number(p.quantity || 0),
            unit_cbm: Number(p.unit_cbm || 0),
            weight_kg: Number(p.weight_kg || 0),
            dim_kg_per_unit_override: dimUnit,
          };
        }
        return {
          quantity: Number(p.quantity || 0),
          unit_cbm: Number(p.unit_cbm || 0),
          weight_kg: Number(p.weight_kg || 0),
          width_inch: p.width_inch,
          depth_inch: p.depth_inch,
          height_inch: p.height_inch,
        };
      });
      freightSnap = computeFreight(freightLines, meta.freight);
    } else {
      freightSnap = null; // explicit clear
    }
  }

  // Fetch existing totals when we need to preserve freight (no new value supplied).
  let existingFreight: any = undefined;
  if (freightSnap === undefined) {
    const { data: existing } = await (supabase as any)
      .from('quote_snapshots')
      .select('totals')
      .eq('id', snapshotId)
      .maybeSingle();
    existingFreight = existing?.totals?.freight ?? null;
  }

  const totals: any = {
    sku_count: productsJson.length,
    total_qty: totalQty,
    grand_total: grandTotal,
    total_cbm: totalCbm,
    freight: freightSnap !== undefined ? freightSnap : existingFreight,
  };

  const updatePayload: any = { products: productsJson, totals };
  if (meta && Object.prototype.hasOwnProperty.call(meta, 'payment_terms')) {
    updatePayload.payment_terms = meta.payment_terms?.toString().trim() || null;
  }

  const { error } = await (supabase as any)
    .from('quote_snapshots')
    .update(updatePayload)
    .eq('id', snapshotId);

  if (error) return { error: error.message };
  return { products: productsJson, totals, payment_terms: updatePayload.payment_terms };
}
