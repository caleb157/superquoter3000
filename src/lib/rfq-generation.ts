// RFQ Generation Logic — aggregates inquiry data into RFQ line items
import { supabase } from '@/integrations/supabase/client';
import * as calc from '@/lib/calculations';

import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';

import { customerPrimary } from '@/lib/customer-name';
import { fxOrFallback } from '@/lib/live-rates';
export interface RfqLineItem {
  product_id?: string;
  product_name?: string;
  product_photo_url?: string;
  item_name: string;
  description?: string;
  dimensions?: string;
  quantity: number;
  units: string;
  estimated_cost?: number;
  target_price?: number;
  notes?: string;
  sort_order: number;
}

// ---------- Auto-generate RFQ number ----------
export async function generateRfqNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const { count } = await (supabase as any)
    .from('vendor_rfqs')
    .select('id', { count: 'exact', head: true })
    .like('rfq_number', `RFQ-${year}-%`);
  const seq = ((count || 0) + 1).toString().padStart(3, '0');
  return `RFQ-${year}-${seq}`;
}

// ---------- Fetch inquiry context ----------
async function fetchInquiryContext(inquiryId: string, filterProductIds?: string[]) {
  let productsQuery = (supabase as any).from('products').select('*').eq('customer_rfq_id', inquiryId).is('archived_at', null).order('sort_order');
  if (filterProductIds && filterProductIds.length > 0) {
    productsQuery = productsQuery.in('id', filterProductIds);
  }
  const productsRes = await productsQuery;
  const products = (productsRes.data || []).filter((p: any) => !p.is_component);
  const productIds = products.map((p: any) => p.id);

  const [cbmRes, cogsRes, inquiryRes, chemRes] = await Promise.all([
    productIds.length
      ? supabase.from('cbm_estimates').select('*').in('product_id', productIds)
      : Promise.resolve({ data: [] as any[] }),
    productIds.length
      ? supabase.from('cogs_items').select('*').in('product_id', productIds)
      : Promise.resolve({ data: [] as any[] }),
    (supabase as any)
      .from('customer_rfqs')
      .select('id, title, rfq_number, customer:customers(id, name, company)')
      .eq('id', inquiryId)
      .single(),
    supabase.from('chemical_prices').select('*'),
  ]);

  const cbm = cbmRes.data || [];
  const cogs = cogsRes.data || [];
  const inquiry = inquiryRes.data as any;
  const customer = inquiry?.customer || null;
  const chemPrices = chemRes.data || [];

  // Phase 7: inquiry-level settings TBD — for now use a sensible default discount.
  const discount = 0.10;
  // Phase 7: inquiry-level settings TBD — no per-inquiry logo override yet.
  const project = {
    name: inquiry?.title || inquiry?.rfq_number || 'Inquiry',
    customer_name: customerPrimary(customer) || null,
    customer_logo_url: null as string | null,
  };

  return { products, cbm, cogs, settings: null as any, project, chemPrices, discount };
}

// ---------- Raw Piece RFQ ----------
// mode 'raw_piece'         → back-solve just the raw piece price (all other costs held fixed)
// mode 'finishing_packing' → back-solve the whole finished product ex-shipping budget:
//   all COGS (raw piece, finishing materials, hardware, packing materials, other),
//   all non-unit COGS, direct + indirect overhead (finishing + packing labour).
//   Only shipping and margin are excluded.
// mode 'outsourced'       → back-solve the whole ex-factory INR price for an outsourced
//   product: only margin and shipping are pulled out; the vendor delivers finished, packed goods.
export type RawTargetMode = 'raw_piece' | 'finishing_packing' | 'outsourced';

export async function generateRawPieceRfq(
  inquiryId: string,
  filterProductIds?: string[],
  mode: RawTargetMode = 'raw_piece',
  opts: { includeAll?: boolean; discount?: number } = {},
): Promise<{ title: string; items: RfqLineItem[]; discount: number }> {
  const ctx = await fetchInquiryContext(inquiryId, filterProductIds);
  const { products, cogs, project, chemPrices } = ctx;
  const discount = opts.discount ?? ctx.discount;


  const productIds = products.map((p: any) => p.id);
  const empty = { data: [] as any[] };
  const [ohRes, nuRes, shipItemsRes, shipTypesRes, empRes, gsRes, cbmRes, ptRes, inqRes, diffRes, boxRes, locRes, rawRes] = await Promise.all([
    productIds.length ? supabase.from('overhead_items').select('*').in('product_id', productIds) : Promise.resolve(empty),
    productIds.length ? supabase.from('non_unit_cogs').select('*').in('product_id', productIds) : Promise.resolve(empty),
    productIds.length ? supabase.from('shipping_items').select('*').in('product_id', productIds) : Promise.resolve(empty),
    supabase.from('shipping_types').select('*'),
    supabase.from('labor_employees').select('*'),
    supabase.from('global_settings').select('*').limit(1).single(),
    productIds.length ? supabase.from('cbm_estimates').select('*').in('product_id', productIds) : Promise.resolve(empty),
    supabase.from('product_types').select('*'),
    (supabase as any).from('customer_rfqs').select('*').eq('id', inquiryId).maybeSingle(),
    (supabase as any).from('finishing_difficulty').select('*'),
    supabase.from('box_data').select('*'),
    (supabase as any).from('local_transport_locations').select('id, cost_per_cbm_inr'),
    (supabase as any).from('raw_material_costs').select('id, name, cost, unit_type, active'),
  ]);

  const allOh = ohRes.data || [];
  const allNu = nuRes.data || [];
  const allShipItems = shipItemsRes.data || [];
  const shipTypes = shipTypesRes.data || [];
  const employees = empRes.data || [];
  const inq = (inqRes as any).data || null;
  const { buildShipmentPools } = await import('@/lib/shipment-pool');
  const shipmentPool = (await buildShipmentPools([inquiryId]))[inquiryId] ?? null;
  const gs = gsRes.data as any;
  const allCbm = cbmRes.data || [];
  const productTypes = ptRes.data || [];
  const difficulties = (diffRes as any).data || [];
  const boxData = boxRes.data || [];
  const locations = (locRes as any).data || [];
  const rawMaterialCosts = (rawRes as any).data || [];

  const { computeProductCosting } = await import('@/lib/costing-engine');
  const mergedGs = mergeSettingsWithInquiry(gs, inq);
  const exchangeRate = fxOrFallback(mergedGs?.exchange_rate);

  const items: RfqLineItem[] = [];
  let sortOrder = 0;

  for (const p of products) {
    const rawCogsRows = cogs.filter((c: any) => c.product_id === p.id && c.cogs_type === 'Raw Piece' && c.include === 'Yes');
    if (mode === 'raw_piece' && rawCogsRows.length === 0 && !opts.includeAll) continue;


    const pCogs = cogs.filter((c: any) => c.product_id === p.id);
    const productNuCogs = allNu.filter((n: any) => n.product_id === p.id);
    const productOh = allOh.filter((o: any) => o.product_id === p.id);
    const productType = productTypes.find((pt: any) => pt.id === p.product_type_id) || null;
    const cbmRow = allCbm.find((c: any) => c.product_id === p.id) || null;
    const shipItem = allShipItems.find((s: any) => s.product_id === p.id);

    const engineResult = computeProductCosting({
      product: p,
      cogsItems: pCogs,
      nonUnitCogs: productNuCogs,
      overheadItems: productOh,
      shippingItems: shipItem ? [shipItem] : [],
      cbmRow,
      productType,
      boxData,
      chemicalPrices: chemPrices,
      shippingTypes: shipTypes,
      laborEmployees: employees,
      globalSettings: gs,
      inquiryOverrides: inq,
      locations,
      difficulties,
      rawMaterialCosts,
      shipmentPool,
    });
    const summary = engineResult.summary;
    const markupPercent = engineResult.markupPercent;

    // IMPORTANT: product_cost_per_unit_inr already includes the CURRENT raw piece cost.
    // To back-solve a target raw piece price, subtract raw piece out of the total first
    // (costExcludingRawPiece), THEN compute the budget against the target. Do not subtract
    // product_cost_per_unit_inr directly against maxTotalCostInr — that double-counts
    // today's raw piece price and silently produces wrong (usually understated) targets.
    const currentRawPieceCostPerUnit = rawCogsRows.reduce((sum: number, item: any) => {
      const c = calc.calcCogsItemCost({
        include: item.include,
        components_per_product: item.components_per_product || 0,
        unit_cost_inr: item.unit_cost_inr || 0,
        waste_factor: item.waste_factor || 0,
      });
      return sum + c.unit_cost;
    }, 0);
    // Costs held fixed while back-solving:
    //  - raw_piece mode: everything except the raw piece rows
    //  - finishing_packing mode: only shipping (the whole finished product ex-shipping is the budget)
    const heldCostPerUnit = (mode === 'finishing_packing' || mode === 'outsourced')
      ? engineResult.shippingPerUnit
      : summary.product_cost_per_unit_inr - currentRawPieceCostPerUnit;

    const targetUsd = p.target_price_usd || 0;
    const maxTotalCostInr = targetUsd > 0 ? (targetUsd / (1 + markupPercent)) * exchangeRate : 0;
    const budget = targetUsd > 0 ? maxTotalCostInr - heldCostPerUnit : 0;

    const estCost = budget > 0 ? +budget.toFixed(2) : undefined;
    const discountPercent = discount * 100;
    const targetPrice = (estCost && estCost > 0)
      ? Math.round((budget * (1 - discountPercent / 100)) / 10) * 10
      : undefined;

    const dims = (p.width_inch && p.depth_inch && p.height_inch)
      ? `${p.width_inch} × ${p.depth_inch} × ${p.height_inch} inches`
      : undefined;

    const label = mode === 'outsourced'
      ? 'Ex-factory outsourced product'
      : mode === 'finishing_packing' ? 'Finished product (ex-shipping)' : 'Raw piece';

    items.push({
      product_id: p.id,
      product_name: p.name,
      product_photo_url: p.photo_url || undefined,
      item_name: p.name,
      description: `${label}${dims ? ` — ${dims}` : ''}${p.finishing_difficulty ? `, ${p.finishing_difficulty} finish` : ''}`,
      dimensions: dims,
      quantity: p.quantity || 0,
      units: 'pc',
      estimated_cost: estCost,
      target_price: targetPrice,
      notes: p.notes || undefined,
      sort_order: sortOrder++,
    });
  }

  const title = mode === 'outsourced'
    ? `Outsourced Ex-Factory RFQ — ${project.name}`
    : mode === 'finishing_packing'
      ? `Finishing & Packing RFQ — ${project.name}`
      : `Raw Piece RFQ — ${project.name}`;
  return { title, items, discount };
}
