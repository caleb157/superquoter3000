// RFQ Generation Logic — aggregates inquiry data into RFQ line items
import { supabase } from '@/integrations/supabase/client';
import * as calc from '@/lib/calculations';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';

interface RfqLineItem {
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
async function fetchInquiryContext(inquiryId: string) {
  const productsRes = await supabase.from('products').select('*').eq('customer_rfq_id', inquiryId).order('sort_order');
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
    customer_name: customer?.name || customer?.company || null,
    customer_logo_url: null as string | null,
  };

  return { products, cbm, cogs, settings: null as any, project, chemPrices, discount };
}

// ---------- Box RFQ ----------
export async function generateBoxRfq(inquiryId: string): Promise<{ title: string; items: RfqLineItem[]; discount: number }> {
  const { products, cbm, project, discount } = await fetchInquiryContext(inquiryId);
  const items: RfqLineItem[] = [];
  let sortOrder = 0;

  const boxGroups: Record<string, {
    boxType: string; dims: string; quantity: number; estCost: number;
    products: { name: string; qty: number; perBox: number; photoUrl?: string }[];
    width: number; depth: number; height: number;
  }> = {};

  for (const p of products) {
    const c = cbm.find((x: any) => x.product_id === p.id);
    if (!c) continue;
    const qty = p.quantity || 0;

    if (c.ic_width && c.ic_depth && c.ic_height) {
      const icType = c.ic_type || '5 ply';
      const perIc = c.products_per_ic || 1;
      const icQty = Math.ceil(qty / perIc);
      const dims = `${Number(c.ic_width).toFixed(1)} × ${Number(c.ic_depth).toFixed(1)} × ${Number(c.ic_height).toFixed(1)}`;
      const key = `IC|${icType}|${dims}`;
      if (!boxGroups[key]) {
        boxGroups[key] = { boxType: `${icType} IC Box`, dims: `${dims} inches`, quantity: 0, estCost: c.ic_cost_estimate || 0, products: [], width: c.ic_width, depth: c.ic_depth, height: c.ic_height };
      }
      boxGroups[key].quantity += icQty;
      boxGroups[key].products.push({ name: p.name, qty: icQty, perBox: perIc, photoUrl: p.photo_url });
    }

    if (c.include_mc && c.mc_width && c.mc_depth && c.mc_height) {
      const mcType = c.mc_type || '7 ply';
      const perMc = c.products_per_mc || 1;
      const mcQty = Math.ceil(qty / perMc);
      const dims = `${Number(c.mc_width).toFixed(1)} × ${Number(c.mc_depth).toFixed(1)} × ${Number(c.mc_height).toFixed(1)}`;
      const key = `MC|${mcType}|${dims}`;
      if (!boxGroups[key]) {
        boxGroups[key] = { boxType: `${mcType} MC Box`, dims: `${dims} inches`, quantity: 0, estCost: c.mc_cost_estimate || 0, products: [], width: c.mc_width, depth: c.mc_depth, height: c.mc_height };
      }
      boxGroups[key].quantity += mcQty;
      boxGroups[key].products.push({ name: p.name, qty: mcQty, perBox: perMc, photoUrl: p.photo_url });
    }
  }

  for (const [, g] of Object.entries(boxGroups)) {
    const desc = g.products.map(p => `${p.name}`).join(', ');
    const notes = g.products.map(p => `${p.name}: ${p.perBox}/box × ${p.qty} boxes`).join('\n');
    items.push({
      item_name: g.boxType,
      description: desc,
      dimensions: g.dims,
      quantity: g.quantity,
      units: 'pc',
      estimated_cost: g.estCost,
      target_price: g.estCost ? +(g.estCost * (1 - discount)).toFixed(2) : undefined,
      product_photo_url: g.products[0]?.photoUrl || undefined,
      notes,
      sort_order: sortOrder++,
    });
  }

  // Phase 7: inquiry-level settings TBD — no inquiry logo override yet, so skip the logo line.
  if (project.customer_logo_url) {
    items.push({
      item_name: 'Logo Print Setup',
      description: `Customer logo printing on IC boxes — ${project.customer_name || 'Customer'}`,
      quantity: 1,
      units: 'lot',
      notes: 'See attached logo',
      sort_order: sortOrder++,
    });
  }

  return { title: `Box RFQ — ${project.name}`, items, discount };
}

// ---------- Chemical RFQ ----------
export async function generateChemicalRfq(inquiryId: string): Promise<{ title: string; items: RfqLineItem[]; discount: number }> {
  const { products, cogs, project, chemPrices, discount } = await fetchInquiryContext(inquiryId);
  const items: RfqLineItem[] = [];
  let sortOrder = 0;

  const chemCogs = cogs.filter((c: any) => c.cogs_type === 'Finishing Materials' && c.include === 'Yes');
  const chemGroups: Record<string, {
    name: string; totalQty: number; unitCost: number;
    breakdown: { productName: string; perUnit: number; qty: number; total: number }[];
  }> = {};

  for (const item of chemCogs) {
    const product = products.find((p: any) => p.id === item.product_id);
    if (!product) continue;
    const name = item.component_name || 'Chemical';
    const perUnit = item.components_per_product || 0;
    const pQty = product.quantity || 0;
    const total = perUnit * pQty;

    if (!chemGroups[name]) {
      const chemPrice = chemPrices.find((cp: any) => cp.name.toLowerCase() === name.toLowerCase());
      chemGroups[name] = { name, totalQty: 0, unitCost: chemPrice?.price_per_litre_inr || item.unit_cost_inr || 0, breakdown: [] };
    }
    chemGroups[name].totalQty += total;
    chemGroups[name].breakdown.push({ productName: product.name, perUnit, qty: pQty, total });
  }

  for (const [, g] of Object.entries(chemGroups)) {
    const notes = g.breakdown.map(b => `${b.productName}: ${b.perUnit}L × ${b.qty} = ${b.total.toFixed(1)}L`).join('\n');
    items.push({
      item_name: g.name,
      description: `Total finishing chemical requirement for ${project.name}`,
      quantity: +g.totalQty.toFixed(2),
      units: 'L',
      estimated_cost: g.unitCost,
      target_price: g.unitCost ? +(g.unitCost * (1 - discount)).toFixed(2) : undefined,
      notes,
      sort_order: sortOrder++,
    });
  }

  return { title: `Chemical RFQ — ${project.name}`, items, discount };
}

// ---------- Hardware RFQ ----------
export async function generateHardwareRfq(inquiryId: string): Promise<{ title: string; items: RfqLineItem[]; discount: number }> {
  const { products, cogs, project, discount } = await fetchInquiryContext(inquiryId);
  const items: RfqLineItem[] = [];
  let sortOrder = 0;

  const hwCogs = cogs.filter((c: any) =>
    c.cogs_type === 'Hardware' &&
    c.include === 'Yes' &&
    c.component_name &&
    c.component_name.trim() !== '' &&
    !c.component_name.match(/^Hardware \d+$/i) &&
    !c.component_name.match(/^Accessory \d+$/i) &&
    (c.components_per_product || 0) > 0
  );

  const hwGroups: Record<string, {
    name: string; units: string; totalQty: number; unitCost: number;
    breakdown: { productName: string; perUnit: number; qty: number; total: number }[];
  }> = {};

  for (const item of hwCogs) {
    const product = products.find((p: any) => p.id === item.product_id);
    if (!product) continue;
    const name = item.component_name;
    const perUnit = item.components_per_product || 0;
    const pQty = product.quantity || 0;
    const total = perUnit * pQty;

    if (!hwGroups[name]) {
      hwGroups[name] = { name, units: item.units || 'pc', totalQty: 0, unitCost: item.unit_cost_inr || 0, breakdown: [] };
    }
    hwGroups[name].totalQty += total;
    hwGroups[name].breakdown.push({ productName: product.name, perUnit, qty: pQty, total });
  }

  for (const [, g] of Object.entries(hwGroups)) {
    const desc = g.breakdown.map(b => `${b.productName}: ${b.perUnit} ${g.units}/unit × ${b.qty} = ${b.total} ${g.units}`).join('\n');
    items.push({
      item_name: `${g.name} (${g.units})`,
      description: desc,
      quantity: g.totalQty,
      units: g.units,
      estimated_cost: g.unitCost,
      target_price: g.unitCost ? +(g.unitCost * (1 - discount)).toFixed(2) : undefined,
      notes: `Total: ${g.totalQty} ${g.units}`,
      sort_order: sortOrder++,
    });
  }

  return { title: `Hardware RFQ — ${project.name}`, items, discount };
}

// ---------- Raw Piece RFQ ----------
export async function generateRawPieceRfq(inquiryId: string): Promise<{ title: string; items: RfqLineItem[]; discount: number }> {
  const { products, cogs, project, discount } = await fetchInquiryContext(inquiryId);

  const productIds = products.map((p: any) => p.id);
  const empty = { data: [] as any[] };
  const [ohRes, nuRes, shipItemsRes, shipTypesRes, empRes, gsRes, cbmRes, ptRes, inqRes] = await Promise.all([
    productIds.length ? supabase.from('overhead_items').select('*').in('product_id', productIds) : Promise.resolve(empty),
    productIds.length ? supabase.from('non_unit_cogs').select('*').in('product_id', productIds) : Promise.resolve(empty),
    productIds.length ? supabase.from('shipping_items').select('*').in('product_id', productIds) : Promise.resolve(empty),
    supabase.from('shipping_types').select('*'),
    supabase.from('labor_employees').select('*'),
    supabase.from('global_settings').select('*').limit(1).single(),
    productIds.length ? supabase.from('cbm_estimates').select('*').in('product_id', productIds) : Promise.resolve(empty),
    supabase.from('product_types').select('*'),
    (supabase as any).from('customer_rfqs').select('*').eq('id', inquiryId).maybeSingle(),
  ]);

  const allOh = ohRes.data || [];
  const allNu = nuRes.data || [];
  const allShipItems = shipItemsRes.data || [];
  const shipTypes = shipTypesRes.data || [];
  const employees = empRes.data || [];
  const inq = (inqRes as any).data || null;
  const gs = mergeSettingsWithInquiry(gsRes.data as any, inq);
  const allCbm = cbmRes.data || [];
  const productTypes = ptRes.data || [];

  const exchangeRate = gs?.exchange_rate || 90;

  const items: RfqLineItem[] = [];
  let sortOrder = 0;

  for (const p of products) {
    const rawCogsRows = cogs.filter((c: any) => c.product_id === p.id && c.cogs_type === 'Raw Piece' && c.include === 'Yes');
    if (rawCogsRows.length === 0) continue;

    const productCogs = cogs.filter((c: any) => c.product_id === p.id && c.include !== 'No');
    const cogsPerUnit = productCogs.reduce((sum: number, item: any) => {
      const c = calc.calcCogsItemCost({
        include: item.include, components_per_product: item.components_per_product || 0,
        unit_cost_inr: item.unit_cost_inr || 0, waste_factor: item.waste_factor || 0,
      });
      return sum + c.unit_cost;
    }, 0);

    const productNuCogs = allNu.filter((n: any) => n.product_id === p.id);
    const qty = p.quantity || 100;
    const nonUnitCogsPerUnit = calc.calcNonUnitCogsPerUnit(
      productNuCogs.map((i: any) => ({ include: i.include, total_quantity: i.total_quantity || 0, cost_each_inr: i.cost_each_inr || 0 })),
      qty
    );

    const productOh = allOh.filter((o: any) => o.product_id === p.id);

    const productType = productTypes.find((pt: any) => pt.id === p.product_type_id);
    const w = p.width_inch || 0;
    const d = p.depth_inch || 0;
    const h = p.height_inch || 0;
    const ri = calc.runningInches(w, d, h);
    const difficultyFactor = calc.getDifficultyFactor(p.finishing_difficulty || 'Medium');
    const cbmRow = allCbm.find((c: any) => c.product_id === p.id);
    const finalUnitCbm = cbmRow?.final_unit_cbm || 0;

    const avgFinishingRate = calc.avgRateByDesignation(employees, 'Finishing') || calc.avgRateByDesignation(employees, 'Sanding');
    const contractorRate = productType?.contractor_base_rate_per_ri || 0;
    const decrease = gs?.contractor_to_inhouse_decrease || 0;
    const finishingMh = calc.calcFinishingLaborMhPerUnit(contractorRate, decrease, difficultyFactor, avgFinishingRate, ri, p.percent_wood ?? 1);
    const packagingMh = calc.calcPackagingLaborMhPerUnit(productType?.packaging_mh_per_cbm || 0, finalUnitCbm);

    const ohItems = productOh.map((item: any) => {
      let mh = item.man_hours_per_unit || 0;
      if (item.is_auto_estimated) {
        if (item.labor_type === 'Finishing' && finishingMh > 0) mh = parseFloat(finishingMh.toFixed(4));
        else if (item.labor_type === 'Packaging' && packagingMh > 0) mh = parseFloat(packagingMh.toFixed(4));
      }
      return {
        include: item.include, labor_type: item.labor_type,
        man_hours_per_unit: mh,
        hourly_rate: calc.avgRateByDesignation(employees, item.labor_type),
      };
    });
    const directOhPerUnit = calc.calcTotalDirectOverheadPerUnit(ohItems, qty);
    const totalDirectMhPerUnit = calc.calcTotalDirectManHoursPerUnit(ohItems);
    const indirectOhPerMh = gs ? calc.calcIndirectOhPerManHour(gs) : 0;
    const indirectOhPerUnit = calc.calcIndirectOhPerUnit(totalDirectMhPerUnit, indirectOhPerMh);

    const shipItem = allShipItems.find((s: any) => s.product_id === p.id);
    const shipType = shipItem ? shipTypes.find((t: any) => t.id === shipItem.shipping_type_id) : null;
    const shippingPerUnit = shipType ? calc.calcShippingPerUnit({
      cost_inr: shipType.cost_inr, per_unit: shipType.per_unit as 'CBM' | 'KG',
      final_unit_cbm: finalUnitCbm, weight_kg: p.weight_kg || 0,
    }) : 0;

    // Phase 7: inquiry-level settings TBD — use the product's own markup.
    const markupPercent = p.markup_percent || 0.2;

    const summary = calc.calcProductCostSummary(
      cogsPerUnit, nonUnitCogsPerUnit, directOhPerUnit, indirectOhPerUnit,
      shippingPerUnit, markupPercent, exchangeRate, qty
    );

    const targetUsd = p.target_price_usd || 0;
    const maxTotalCostInr = targetUsd > 0 ? (targetUsd / (1 + markupPercent)) * exchangeRate : 0;
    const rawPieceBudgetLeft = targetUsd > 0 ? maxTotalCostInr - summary.product_cost_per_unit_inr : 0;

    const estCost = rawPieceBudgetLeft > 0 ? +rawPieceBudgetLeft.toFixed(2) : undefined;
    const discountPercent = discount * 100;
    const targetPrice = (estCost && estCost > 0)
      ? Math.round((rawPieceBudgetLeft * (1 - discountPercent / 100)) / 10) * 10
      : undefined;

    const dims = (p.width_inch && p.depth_inch && p.height_inch)
      ? `${p.width_inch} × ${p.depth_inch} × ${p.height_inch} inches`
      : undefined;

    items.push({
      product_id: p.id,
      product_name: p.name,
      product_photo_url: p.photo_url || undefined,
      item_name: p.name,
      description: `Raw piece${dims ? ` — ${dims}` : ''}${p.finishing_difficulty ? `, ${p.finishing_difficulty} finish` : ''}`,
      dimensions: dims,
      quantity: p.quantity || 0,
      units: 'pc',
      estimated_cost: estCost,
      target_price: targetPrice,
      notes: p.notes || undefined,
      sort_order: sortOrder++,
    });
  }

  return { title: `Raw Piece RFQ — ${project.name}`, items, discount };
}

// ---------- Create RFQ in database ----------
export async function createRfq(
  inquiryId: string,
  rfqType: string,
  title: string,
  lineItems: RfqLineItem[],
  discount: number,
  userId?: string,
): Promise<{ rfqId: string | null; error: string | null }> {
  const rfqNumber = await generateRfqNumber();

  const { data: rfq, error: rfqErr } = await (supabase as any)
    .from('vendor_rfqs')
    .insert({
      customer_rfq_id: inquiryId,
      rfq_number: rfqNumber,
      rfq_type: rfqType,
      title,
      discount_percent: discount,
      status: 'draft',
      created_by: userId || null,
    })
    .select('id')
    .single();

  if (rfqErr || !rfq) return { rfqId: null, error: rfqErr?.message || 'Failed to create Vendor RFQ' };

  if (lineItems.length > 0) {
    const rows = lineItems.map(item => ({
      vendor_rfq_id: rfq.id,
      ...item,
    }));
    const { error: itemErr } = await (supabase as any).from('vendor_rfq_line_items').insert(rows);
    if (itemErr) return { rfqId: rfq.id, error: itemErr.message };
  }

  return { rfqId: rfq.id, error: null };
}
