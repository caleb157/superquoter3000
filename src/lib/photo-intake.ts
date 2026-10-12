// Photo intake: photo + outer W × D × H → a draft product in the costing workspace.
//
// The estimate-product function asks Claude for a draft costing (type, % wood, finishing
// difficulty, raw piece ₹, man-hours, bought-in lines). This module writes that draft as
// Costing Intake inputs on a new product, so the costing engine derives every other number
// exactly as it does for an imported sheet. The estimate itself is kept on
// products.photo_estimate and the product shows as "estimated" until someone marks it checked.
import { supabase } from '@/integrations/supabase/client';
import { COST_COLS, SLOTS, applyIntakeToProduct, type IntakeRow } from '@/lib/costing-intake';

const db = supabase as any;

export type DimUnit = 'in' | 'cm' | 'mm';
const IN_PER: Record<DimUnit, number> = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4 };

/** Shape of the estimate-product function's answer. */
export type ProductEstimate = {
  name: string;
  summary: string;
  product_type: string;
  percent_wood: number;
  finishing_difficulty: string;
  materials: string;
  weight_kg: number;
  raw_piece_inr: number;
  raw_piece_basis: string;
  mh_manufacturing: number;
  mh_assembly: number;
  line_items: { cogs_type: string; name: string; qty: number; unit_inr: number }[];
  assumptions: string[];
  confidence: 'low' | 'medium' | 'high';
  model?: string;
  references_used?: number;
};

export type PhotoEstimateRecord = {
  summary: string;
  materials: string;
  raw_piece_basis: string;
  assumptions: string[];
  confidence: ProductEstimate['confidence'];
  model: string | null;
  references_used: number;
  estimated_at: string;
  inputs: { width: number; depth: number; height: number; unit: DimUnit; notes: string };
  checked_at: string | null;
};

export type IntakeInput = {
  width: number; depth: number; height: number; unit: DimUnit;
  name?: string; notes?: string; quantity?: number;
};

/** True while a product's photo estimate has not been marked checked. */
export const isPhotoEstimated = (p: any) => !!p?.photo_estimate && !p.photo_estimate.checked_at;

const toInch = (n: number, unit: DimUnit) => Math.round(n * IN_PER[unit] * 100) / 100;
const pos = (n: any) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? v : 0; };

/** Turn an estimate into one Costing Intake row (raw inputs only; the engine derives the rest). */
export function estimateToIntakeRow(est: ProductEstimate, input: IntakeInput): IntakeRow {
  const row: IntakeRow = {
    _row: 1,
    name: (input.name?.trim() || est.name?.trim() || 'Untitled product').slice(0, 200),
    width_inch: toInch(input.width, input.unit),
    depth_inch: toInch(input.depth, input.unit),
    height_inch: toInch(input.height, input.unit),
  };
  if (est.product_type) row.product_type = est.product_type;
  if (est.finishing_difficulty) row.finishing_difficulty = est.finishing_difficulty;
  const wood = Number(est.percent_wood);
  if (Number.isFinite(wood)) row.percent_wood = Math.min(1, Math.max(0, wood / 100));
  if (pos(est.weight_kg)) row.weight_kg = Math.round(pos(est.weight_kg) * 10) / 10;
  if (pos(est.raw_piece_inr)) row.raw_piece_inr = Math.round(pos(est.raw_piece_inr));
  if (Number.isFinite(Number(est.mh_manufacturing))) row.mh_manufacturing = Math.round(pos(est.mh_manufacturing) * 100) / 100;
  if (pos(est.mh_assembly)) row.mh_assembly = Math.round(pos(est.mh_assembly) * 100) / 100;

  // Each bought-in line takes the next free named slot of its category; extras roll into that
  // category's ₹ total so nothing is dropped.
  const used = new Set<string>();
  for (const li of est.line_items ?? []) {
    const unit = pos(li.unit_inr);
    if (!unit) continue;
    const qty = pos(li.qty) || 1;
    const slot = SLOTS.find(s => s.cogsType === li.cogs_type && !used.has(s.nameKey));
    if (slot) {
      used.add(slot.nameKey);
      row[slot.nameKey] = (li.name || slot.label).slice(0, 120);
      row[slot.qtyKey] = qty;
      row[slot.costKey] = Math.round(unit);
      continue;
    }
    const col = COST_COLS.find(c => c.cogsType === li.cogs_type) ?? COST_COLS.find(c => c.cogsType === 'Other')!;
    row[col.key] = Math.round((row[col.key] ?? 0) + unit * qty);
  }
  return row;
}

export function estimateRecord(est: ProductEstimate, input: IntakeInput, now = new Date()): PhotoEstimateRecord {
  return {
    summary: est.summary || '',
    materials: est.materials || '',
    raw_piece_basis: est.raw_piece_basis || '',
    assumptions: Array.isArray(est.assumptions) ? est.assumptions.slice(0, 20) : [],
    confidence: est.confidence || 'low',
    model: est.model ?? null,
    references_used: est.references_used ?? 0,
    estimated_at: now.toISOString(),
    inputs: { width: input.width, depth: input.depth, height: input.height, unit: input.unit, notes: input.notes?.trim() || '' },
    checked_at: null,
  };
}

// ---------- photos ----------

export type PreparedImage = { data: string; mediaType: string; preview: string };
const MAX_EDGE = 1568; // larger images are downscaled by the API anyway

/** Downscale to a JPEG data URL so phone photos upload quickly. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k); canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg', preview: url };
}

// ---------- run ----------

/** Readable message from a functions.invoke error. */
async function invokeError(error: any): Promise<string> {
  let msg = error?.message || 'Estimate failed';
  try { msg = (await error?.context?.json?.())?.error || msg; } catch { /* keep generic */ }
  return /Failed to send|FunctionsFetchError/i.test(msg)
    ? 'The photo estimator is not available yet (the estimate-product function has not been deployed).'
    : msg;
}

export async function estimateFromPhotos(images: PreparedImage[], input: IntakeInput): Promise<ProductEstimate> {
  const { data, error } = await supabase.functions.invoke('estimate-product', {
    body: {
      images: images.map(i => ({ data: i.data, media_type: i.mediaType })),
      width: input.width, depth: input.depth, height: input.height, unit: input.unit,
      name: input.name?.trim() || '', notes: input.notes?.trim() || '',
    },
  });
  if (error) throw new Error(await invokeError(error));
  return data as ProductEstimate;
}

/**
 * Create the product on the inquiry from an estimate: insert (the DB trigger seeds the default
 * costing rows), attach the first photo, write the intake inputs, then keep the estimate record.
 * Returns the new product id and any warnings (an unknown type name, a missing estimate column).
 */
export async function createProductFromEstimate(
  inquiryId: string, est: ProductEstimate, input: IntakeInput, photo: PreparedImage | null,
): Promise<{ id: string; warnings: string[] }> {
  const row = estimateToIntakeRow(est, input);
  const { data: last } = await db.from('products').select('sort_order').eq('customer_rfq_id', inquiryId)
    .order('sort_order', { ascending: false, nullsFirst: false }).limit(1);
  const { data: prod, error } = await db.from('products').insert({
    customer_rfq_id: inquiryId, name: row.name,
    width_inch: row.width_inch, depth_inch: row.depth_inch, height_inch: row.height_inch,
    quantity: input.quantity && input.quantity > 0 ? Math.round(input.quantity) : 100,
    sort_order: (last?.[0]?.sort_order ?? 0) + 1,
  }).select('id').single();
  if (error) throw new Error(error.message);
  const id = prod.id as string;
  const warnings: string[] = [];

  if (photo) {
    try {
      const blob = await (await fetch(photo.preview)).blob();
      const path = `${id}.jpg`;
      const { error: upErr } = await supabase.storage.from('product-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
      if (upErr) warnings.push(`Photo not saved: ${upErr.message}`);
      else {
        const { data: urlData } = supabase.storage.from('product-photos').getPublicUrl(path);
        await db.from('products').update({ photo_url: `${urlData.publicUrl}?t=${Date.now()}` }).eq('id', id);
      }
    } catch (e: any) { warnings.push(`Photo not saved: ${e?.message || e}`); }
  }

  // Before the costing inputs, so the recompute at the end of the intake sees the final product.
  const { error: recErr } = await db.from('products').update({ photo_estimate: estimateRecord(est, input) }).eq('id', id);
  if (recErr) warnings.push(/photo_estimate/.test(recErr.message)
    ? 'The "estimated" flag needs the photo_estimate column (database update pending).'
    : `Estimate note not saved: ${recErr.message}`);

  warnings.push(...await applyIntakeToProduct(id, row));
  return { id, warnings };
}
