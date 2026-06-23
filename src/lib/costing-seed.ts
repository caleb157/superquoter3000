// Headless costing orchestration — seed, compute, and persist a product's costing
// without opening the costing tab UI. Shares the same pure engine as product-pricing.ts
// and ProductCostingTab so results are identical.
import { supabase } from '@/integrations/supabase/client';
import { computeProductCosting, type CostingEngineResult } from '@/lib/costing-engine';

type PackagingType = 'no_packaging' | 'ic_only' | 'ic_mc' | 'corrugate_bubble' | 'bulk_pack';

const packagingIncludeForType = (pkg: string, componentName: string): boolean => {
  const name = (componentName || '').toLowerCase();
  if (pkg === 'no_packaging') return false;
  if (name.includes('ic box') || name.includes('inner carton') || name === 'ic') return pkg === 'ic_only' || pkg === 'ic_mc';
  if (name.includes('mc box') || name.includes('master carton') || name.includes('outer carton')) return pkg === 'ic_mc' || pkg === 'bulk_pack';
  if (name === 'corrugate wrap' || name === 'bubble wrap') return pkg === 'corrugate_bubble';
  if (name.includes('foam') || name.includes('bulk pack')) return pkg === 'bulk_pack';
  return false;
};

/**
 * Ensures a product has its default auto-calc COGS rows. Inserts only missing ones.
 * Idempotent: safe to call repeatedly. Returns true if any rows were inserted.
 *
 * Mirrors the row definitions used by ProductCostingTab's recalculate-all path and
 * the DB trigger trg_seed_product_defaults; the trigger covers most cases on
 * INSERT, this is the safety net for products that pre-date the trigger or had
 * default rows manually deleted.
 */
export async function seedDefaultCostingRows(productId: string): Promise<boolean> {
  const [prodRes, cogsRes, ohRes, defaultChemsRes] = await Promise.all([
    (supabase as any).from('products').select('id, packaging_type, source_location_id, product_type_id').eq('id', productId).maybeSingle(),
    (supabase as any).from('cogs_items').select('id, cogs_type, component_name, chemical_price_id, sort_order').eq('product_id', productId),
    (supabase as any).from('overhead_items').select('id, labor_type, sort_order').eq('product_id', productId),
    Promise.resolve({ data: null as any }),
  ]);
  const product = prodRes.data;
  if (!product) return false;
  const cogs = (cogsRes.data || []) as any[];
  const oh = (ohRes.data || []) as any[];

  // Load default chemicals for the product type (if any)
  let defaultChems: any[] = [];
  if (product.product_type_id) {
    const { data } = await (supabase as any)
      .from('product_type_default_chemicals')
      .select('chemical_price_id, chemical_price:chemical_prices(id, name, category, unit_type, price_per_unit_inr, price_per_litre_inr)')
      .eq('product_type_id', product.product_type_id);
    defaultChems = (data || []) as any[];
  }

  const hasCogs = (matcher: (n: string) => boolean) =>
    cogs.some((i) => matcher((i.component_name || '').toLowerCase()));
  const hasOh = (lt: string) => oh.some((i) => i.labor_type === lt);
  const existingChemIds = new Set(cogs.map((i: any) => i.chemical_price_id).filter(Boolean));
  const existingCats = new Set(
    cogs
      .filter((i: any) => i.cogs_type === 'Finishing Materials')
      .map((i: any) => {
        const n = (i.component_name || '').toLowerCase();
        if (n.includes('color') || n.includes('stain')) return 'Color';
        if (n.includes('sealer')) return 'Sealer';
        if (n.includes('lacquer')) return 'Lacquer';
        if (n.includes('wax')) return 'Wax';
        return null;
      })
      .filter(Boolean) as string[]
  );

  const pkgType = (product.packaging_type || 'ic_mc') as PackagingType;
  const baseSort = cogs.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0) + 1;
  let s = baseSort;
  const cogsToInsert: any[] = [];

  // Default chemicals from product_type_default_chemicals (chemical_price_id set)
  for (const d of defaultChems) {
    const chem = d.chemical_price;
    if (!chem) continue;
    if (existingChemIds.has(chem.id)) continue;
    if (existingCats.has(chem.category)) continue;
    cogsToInsert.push({
      product_id: productId,
      cogs_type: 'Finishing Materials',
      component_name: chem.name,
      chemical_price_id: chem.id,
      is_auto_calculated: true,
      include: 'Yes',
      units: chem.unit_type || 'L',
      components_per_product: 0,
      unit_cost_inr: Number(chem.price_per_unit_inr ?? chem.price_per_litre_inr ?? 0),
      sort_order: s++,
    });
    existingCats.add(chem.category);
  }

  // Generic finishing material fallbacks (only when not already covered)
  if (!hasCogs((n) => n.includes('color') || n.includes('stain')) && !existingCats.has('Color')) {
    cogsToInsert.push({ product_id: productId, cogs_type: 'Finishing Materials', component_name: 'Color', is_auto_calculated: true, include: 'Yes', sort_order: s++ });
  }
  if (!hasCogs((n) => n.includes('sealer')) && !existingCats.has('Sealer')) {
    cogsToInsert.push({ product_id: productId, cogs_type: 'Finishing Materials', component_name: 'Sealer', is_auto_calculated: true, include: 'Yes', sort_order: s++ });
  }
  if (!hasCogs((n) => n.includes('lacquer')) && !existingCats.has('Lacquer')) {
    cogsToInsert.push({ product_id: productId, cogs_type: 'Finishing Materials', component_name: 'Lacquer', is_auto_calculated: true, include: 'Yes', sort_order: s++ });
  }

  // Packaging rows
  if (!hasCogs((n) => n.includes('ic box') || n.includes('inner carton') || n === 'ic')) {
    cogsToInsert.push({
      product_id: productId, cogs_type: 'Packaging', component_name: 'IC Box',
      is_auto_calculated: true, waste_factor: 0.05,
      include: packagingIncludeForType(pkgType, 'IC Box') ? 'Yes' : 'No', sort_order: s++,
    });
  }
  if (!hasCogs((n) => n.includes('mc box') || n.includes('master carton') || n.includes('outer carton'))) {
    cogsToInsert.push({
      product_id: productId, cogs_type: 'Packaging', component_name: 'MC Box',
      is_auto_calculated: true,
      include: packagingIncludeForType(pkgType, 'MC Box') ? 'Yes' : 'No', sort_order: s++,
    });
  }
  if (pkgType === 'corrugate_bubble') {
    if (!hasCogs((n) => n === 'corrugate wrap')) {
      cogsToInsert.push({ product_id: productId, cogs_type: 'Packaging', component_name: 'Corrugate Wrap', units: 'KG', is_auto_calculated: true, include: 'Yes', sort_order: s++ });
    }
    if (!hasCogs((n) => n === 'bubble wrap')) {
      cogsToInsert.push({ product_id: productId, cogs_type: 'Packaging', component_name: 'Bubble Wrap', units: 'KG', is_auto_calculated: true, include: 'Yes', sort_order: s++ });
    }
  }
  if (pkgType === 'bulk_pack') {
    if (!hasCogs((n) => n.includes('foam') || n.includes('bulk pack'))) {
      cogsToInsert.push({
        product_id: productId, cogs_type: 'Packaging', component_name: 'Bulk Foam',
        units: 'sq in', is_auto_calculated: true, include: 'Yes', sort_order: s++,
      });
    }
  }

  // External-sourcing freight
  if (product.source_location_id && !hasCogs((n) => n.includes('domestic freight'))) {
    cogsToInsert.push({
      product_id: productId, cogs_type: 'Subcontracting',
      component_name: 'Domestic Freight (External Sourcing)', units: 'CBM',
      is_auto_calculated: true, include: 'Yes', sort_order: s++,
    });
  }

  // Overhead rows
  const ohToInsert: any[] = [];
  let os = oh.reduce((m, i) => Math.max(m, i.sort_order ?? 0), 0) + 1;
  if (!hasOh('Finishing')) {
    ohToInsert.push({ product_id: productId, labor_type: 'Finishing', is_auto_estimated: true, include: 'Yes', sort_order: os++ });
  }
  if (!hasOh('Packaging')) {
    ohToInsert.push({ product_id: productId, labor_type: 'Packaging', is_auto_estimated: true, include: 'Yes', sort_order: os++ });
  }

  // Auto Transport non_unit_cogs (if missing)
  const { data: nuExisting } = await (supabase as any).from('non_unit_cogs').select('id').eq('product_id', productId).limit(1);
  const needsAutoTransport = !nuExisting || nuExisting.length === 0;

  // CBM row (if missing)
  const { data: cbmExisting } = await (supabase as any).from('cbm_estimates').select('id').eq('product_id', productId).maybeSingle();
  const needsCbm = !cbmExisting;

  let inserted = false;
  if (cogsToInsert.length) {
    const { error } = await (supabase as any).from('cogs_items').insert(cogsToInsert);
    if (!error) inserted = true;
  }
  if (ohToInsert.length) {
    const { error } = await (supabase as any).from('overhead_items').insert(ohToInsert);
    if (!error) inserted = true;
  }
  if (needsAutoTransport) {
    await (supabase as any).from('non_unit_cogs').insert({
      product_id: productId, name: 'Auto Transport',
      total_quantity: 1, cost_each_inr: 0, include: 'Yes', sort_order: 0,
    });
    inserted = true;
  }
  if (needsCbm) {
    const { data: gs } = await (supabase as any).from('global_settings').select('mc_height_buffer_inch').limit(1).single();
    await (supabase as any).from('cbm_estimates').insert({
      product_id: productId, mc_height_buffer_inch: gs?.mc_height_buffer_inch ?? 2.5,
    });
    inserted = true;
  }
  return inserted;
}

/**
 * Persists the engine's resolved auto-calc values back to cogs_items
 * and writes calculated_unit_price_usd / calculated_unit_cost_usd to the product.
 * Compare-before-write to avoid redundant writes.
 */
export async function persistResolvedCosting(
  productId: string,
  product: any,
  cogsItems: any[],
  nonUnitCogs: any[],
  engineResult: CostingEngineResult,
): Promise<void> {
  const writes: Promise<any>[] = [];

  // Per-row resolved cogs writes (auto-calc rows only)
  const resolvedById = new Map<string, any>();
  for (const r of engineResult.resolvedCogsRows) resolvedById.set(r.id, r);

  for (const orig of cogsItems) {
    if (!orig.is_auto_calculated) continue;
    const resolved = resolvedById.get(orig.id);
    if (!resolved) continue;
    const update: any = {};
    const eq = (a: any, b: any, eps = 0.0001) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < eps;
    if (!eq(orig.components_per_product, resolved.components_per_product)) {
      update.components_per_product = Number(resolved.components_per_product) || 0;
    }
    if (!eq(orig.unit_cost_inr, resolved.unit_cost_inr, 0.01)) {
      update.unit_cost_inr = Number(resolved.unit_cost_inr) || 0;
    }
    if (resolved.units && resolved.units !== orig.units) update.units = resolved.units;
    if (resolved.include && resolved.include !== orig.include) update.include = resolved.include;
    if (Object.keys(update).length > 0) {
      writes.push((supabase as any).from('cogs_items').update(update).eq('id', orig.id));
    }
  }

  // Auto Transport non_unit_cogs writeback
  const transport = nonUnitCogs.find((i) => i.name === 'Auto Transport');
  if (transport && !transport.manual_override) {
    const qty = product.quantity || 100;
    const totalCbm = +(engineResult.finalUnitCbm * qty).toFixed(4);
    const rate = engineResult.summary ? (engineResult.summary as any).__rate ?? null : null;
    // We can compute the rate the same way the engine does — from globalSettings — but the
    // engine already used it; reuse via its resolved view: cost_each_inr is what the engine
    // multiplied. We don't expose rate directly, so recompute from non_unit_cogs in-memory
    // override (engine does this same compute). To stay simple, only write quantity when
    // dimensions are known; leave cost_each_inr alone here (Step 7b in the tab handles it).
    if (Math.abs((transport.total_quantity || 0) - totalCbm) > 0.0001 && engineResult.finalUnitCbm > 0) {
      writes.push(
        (supabase as any).from('non_unit_cogs').update({ total_quantity: totalCbm }).eq('id', transport.id),
      );
    }
    void rate;
  }

  // Product-level price/cost
  const priceUsd = Number.isFinite(engineResult.summary.unit_price_usd)
    ? +engineResult.summary.unit_price_usd.toFixed(4) : null;
  const costUsd = Number.isFinite(engineResult.summary.product_cost_per_unit_usd)
    ? +engineResult.summary.product_cost_per_unit_usd.toFixed(4) : null;
  const storedPrice = product.calculated_unit_price_usd == null ? null : Number(product.calculated_unit_price_usd);
  const storedCost = product.calculated_unit_cost_usd == null ? null : Number(product.calculated_unit_cost_usd);
  if (priceUsd !== storedPrice || costUsd !== storedCost) {
    writes.push(
      (supabase as any).from('products').update({
        calculated_unit_price_usd: priceUsd,
        calculated_unit_cost_usd: costUsd,
      }).eq('id', productId),
    );
  }

  await Promise.all(writes);
}

export type SharedRefData = {
  boxData: any[];
  chemicalPrices: any[];
  shippingTypes: any[];
  employees: any[];
  globalSettings: any;
  productTypes: any[];
  locations: any[];
  difficulties: any[];
  rawMaterialCosts: any[];
};

async function loadSharedRefs(): Promise<SharedRefData> {
  const [bd, cp, st, emp, gs, pt, loc, diff, raw] = await Promise.all([
    supabase.from('box_data').select('*').limit(100000),
    supabase.from('chemical_prices').select('*').limit(100000),
    supabase.from('shipping_types').select('*').limit(100000),
    supabase.from('labor_employees').select('*').limit(100000),
    supabase.from('global_settings').select('*').limit(1).single(),
    supabase.from('product_types').select('*').limit(100000),
    (supabase as any).from('local_transport_locations').select('id, name, cost_per_cbm_inr').limit(100000),
    (supabase as any).from('finishing_difficulty').select('name, adjustment_factor').limit(100000),
    (supabase as any).from('raw_material_costs').select('id, name, cost, unit_type, active').limit(100000),
  ]);
  return {
    boxData: (bd.data || []) as any[],
    chemicalPrices: (cp.data || []) as any[],
    shippingTypes: (st.data || []) as any[],
    employees: (emp.data || []) as any[],
    globalSettings: gs.data as any,
    productTypes: (pt.data || []) as any[],
    locations: ((loc as any).data || []) as any[],
    difficulties: ((diff as any).data || []) as any[],
    rawMaterialCosts: ((raw as any).data || []) as any[],
  };
}

/**
 * Headlessly bring a product's costing fully up to date:
 * seed missing rows, compute via the engine, persist values + price.
 * Returns the computed unit price (USD), or null if it couldn't compute.
 */
export async function recostProduct(productId: string, sharedRefs?: SharedRefData): Promise<number | null> {
  await seedDefaultCostingRows(productId);

  const refs = sharedRefs || (await loadSharedRefs());

  const [prodRes, cogsRes, nuRes, ohRes, shipRes, cbmRes] = await Promise.all([
    supabase.from('products').select('*').eq('id', productId).single(),
    supabase.from('cogs_items').select('*').eq('product_id', productId).order('sort_order'),
    supabase.from('non_unit_cogs').select('*').eq('product_id', productId).order('sort_order'),
    supabase.from('overhead_items').select('*').eq('product_id', productId).order('sort_order'),
    supabase.from('shipping_items').select('*').eq('product_id', productId),
    supabase.from('cbm_estimates').select('*').eq('product_id', productId).maybeSingle(),
  ]);
  const product = prodRes.data as any;
  if (!product) return null;

  let inquiryOverrides: any = null;
  if (product.customer_rfq_id) {
    const { data } = await (supabase as any).from('customer_rfqs').select('*').eq('id', product.customer_rfq_id).maybeSingle();
    inquiryOverrides = data;
  }

  const productType = refs.productTypes.find((pt: any) => pt.id === product.product_type_id) || null;

  const result = computeProductCosting({
    product,
    cogsItems: (cogsRes.data || []) as any[],
    nonUnitCogs: (nuRes.data || []) as any[],
    overheadItems: (ohRes.data || []) as any[],
    shippingItems: (shipRes.data || []) as any[],
    cbmRow: (cbmRes.data || null) as any,
    productType,
    boxData: refs.boxData,
    chemicalPrices: refs.chemicalPrices,
    shippingTypes: refs.shippingTypes,
    laborEmployees: refs.employees,
    globalSettings: refs.globalSettings,
    inquiryOverrides,
    locations: refs.locations,
    difficulties: refs.difficulties,
    rawMaterialCosts: refs.rawMaterialCosts,
  });

  await persistResolvedCosting(
    productId,
    product,
    (cogsRes.data || []) as any[],
    (nuRes.data || []) as any[],
    result,
  );

  return Number.isFinite(result.summary.unit_price_usd) ? result.summary.unit_price_usd : null;
}

/**
 * Recost every product in an inquiry with a small concurrency window.
 */
export async function recostInquiry(
  inquiryId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { data: products } = await supabase
    .from('products')
    .select('id')
    .eq('customer_rfq_id', inquiryId);
  const ids = ((products || []) as any[]).map((p) => p.id);
  if (ids.length === 0) {
    onProgress?.(0, 0);
    return;
  }
  const refs = await loadSharedRefs();
  let done = 0;
  const concurrency = 3;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (cursor < ids.length) {
        const i = cursor++;
        try {
          await recostProduct(ids[i], refs);
        } catch (e) {
          console.error('recostProduct failed for', ids[i], e);
        }
        done++;
        onProgress?.(done, ids.length);
      }
    }),
  );
}
