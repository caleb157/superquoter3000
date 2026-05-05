import { supabase } from '@/integrations/supabase/client';

// Columns to copy from the source product row (everything except identity, FK, stages, timestamps, completion flags).
export const PRODUCT_COPY_COLS = [
  'name', 'sku', 'photo_url', 'notes', 'notes_finishes', 'notes_vendors', 'notes_issues',
  'sort_order', 'markup_percent', 'target_price_usd', 'is_component', 'percent_wood',
  'finishing_difficulty', 'product_type_id', 'weight_kg', 'height_inch', 'depth_inch',
  'width_inch', 'moq', 'quantity', 'sourced_externally', 'packaging_type',
  'calculated_unit_cost_usd', 'calculated_unit_price_usd',
] as const;

const CHILD_TABLES = [
  'cogs_items',
  'non_unit_cogs',
  'overhead_items',
  'shipping_items',
  'cbm_estimates',
  'product_variants',
] as const;

/**
 * Clone a product (and all its costing/variant rows) into a target inquiry.
 * Returns the new product id, or null on failure.
 */
export async function cloneProductToInquiry(
  sourceId: string,
  targetInquiryId: string,
  nameOverride?: string,
): Promise<string | null> {
  const { data: source } = await supabase.from('products').select('*').eq('id', sourceId).maybeSingle();
  if (!source) return null;

  const insertPayload: Record<string, any> = { customer_rfq_id: targetInquiryId };
  for (const col of PRODUCT_COPY_COLS) {
    if ((source as any)[col] !== undefined) insertPayload[col] = (source as any)[col];
  }
  if (nameOverride && nameOverride.trim()) insertPayload.name = nameOverride.trim();
  insertPayload.design_stage = null;
  insertPayload.quote_stage = null;
  insertPayload.sample_stage = null;
  insertPayload.cogs_done = false;
  insertPayload.cbm_done = false;
  insertPayload.overhead_done = false;
  insertPayload.shipping_done = false;
  insertPayload.revenue_done = false;

  const { data: created, error } = await (supabase as any)
    .from('products')
    .insert(insertPayload)
    .select('id')
    .single();
  if (error || !created) return null;
  const newId = created.id as string;

  // Wipe trigger-seeded default rows so clones reflect the source exactly.
  await Promise.all([
    (supabase as any).from('cogs_items').delete().eq('product_id', newId),
    (supabase as any).from('non_unit_cogs').delete().eq('product_id', newId),
    (supabase as any).from('overhead_items').delete().eq('product_id', newId),
    (supabase as any).from('cbm_estimates').delete().eq('product_id', newId),
  ]);

  // Clone each child table, re-linking product_id to the new product.
  await Promise.all(CHILD_TABLES.map(async (table) => {
    const { data: rows } = await (supabase as any).from(table).select('*').eq('product_id', sourceId);
    if (!rows || rows.length === 0) return;
    const inserts = rows.map((r: any) => {
      const { id, created_at, updated_at, ...rest } = r;
      return { ...rest, product_id: newId };
    });
    const { error: insErr } = await (supabase as any).from(table).insert(inserts);
    if (insErr) console.warn(`Failed cloning ${table}:`, insErr.message);
  }));

  return newId;
}

const ASSEMBLY_COPY_COLS = [
  'name', 'sku', 'photo_url', 'quantity', 'moq', 'target_price_usd',
  'markup_percent', 'notes',
] as const;

/**
 * Clone any assemblies that reference one or more of `sourceProductIds` into the
 * target inquiry, re-linking each component to the freshly cloned product
 * (using `idMap`: source product id → new product id). Components referencing
 * products that were NOT cloned still link to the original product id, so the
 * assembly remains functional.
 *
 * Returns the number of assemblies cloned.
 */
export async function cloneAssembliesForProducts(
  sourceProductIds: string[],
  targetInquiryId: string,
  idMap: Record<string, string>,
): Promise<number> {
  if (sourceProductIds.length === 0) return 0;

  const { data: refs } = await (supabase as any)
    .from('assembly_components')
    .select('assembly_id')
    .in('product_id', sourceProductIds);
  const assemblyIds = Array.from(new Set((refs ?? []).map((r: any) => r.assembly_id as string)));
  if (assemblyIds.length === 0) return 0;

  const { data: assemblies } = await (supabase as any)
    .from('product_assemblies')
    .select('*')
    .in('id', assemblyIds);
  if (!assemblies || assemblies.length === 0) return 0;

  let cloned = 0;
  for (const a of assemblies) {
    const payload: Record<string, any> = { customer_rfq_id: targetInquiryId };
    for (const col of ASSEMBLY_COPY_COLS) {
      if (a[col] !== undefined) payload[col] = a[col];
    }
    const { data: newAsm, error } = await (supabase as any)
      .from('product_assemblies')
      .insert(payload)
      .select('id')
      .single();
    if (error || !newAsm) {
      console.warn('Failed cloning assembly:', error?.message);
      continue;
    }

    const { data: comps } = await (supabase as any)
      .from('assembly_components')
      .select('product_id, quantity_per_assembly, sort_order')
      .eq('assembly_id', a.id);
    if (comps && comps.length > 0) {
      const inserts = comps.map((c: any) => ({
        assembly_id: newAsm.id,
        product_id: idMap[c.product_id] ?? c.product_id,
        quantity_per_assembly: c.quantity_per_assembly,
        sort_order: c.sort_order,
      }));
      const { error: cErr } = await (supabase as any).from('assembly_components').insert(inserts);
      if (cErr) console.warn('Failed cloning assembly components:', cErr.message);
    }
    cloned++;
  }
  return cloned;
}

