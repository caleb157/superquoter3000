import type { Tables } from '@/integrations/supabase/types';

export type Product = Tables<'products'>;
export type Inquiry = Tables<'customer_rfqs'>;

export function productWeight(
  p: Pick<Product, 'design_stage' | 'quote_stage' | 'sample_stage'>,
  inquiryStatus?: string | null,
): number {
  if (inquiryStatus === 'complete' || inquiryStatus === 'cancelled') return 0;
  if (inquiryStatus === 'po') return 1.0;
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

export type StageBucket =
  | 'not_started'
  | 'need_design'
  | 'designed'
  | 'quoting'
  | 'ready_for_quote'
  | 'quoted'
  | 'sampling'
  | 'sampled'
  | 'po';

export function furthestStageBucket(
  p: Pick<Product, 'design_stage' | 'quote_stage' | 'sample_stage'>,
  inquiryStatus?: string | null,
): StageBucket {
  if (inquiryStatus === 'po') return 'po';
  if (p.sample_stage === 'sampled') return 'sampled';
  if (p.sample_stage === 'sampling') return 'sampling';
  if (p.quote_stage === 'quoted') return 'quoted';
  if (p.quote_stage === 'ready_for_quote') return 'ready_for_quote';
  if (p.quote_stage === 'quoting') return 'quoting';
  if (p.design_stage === 'designed') return 'designed';
  if (p.design_stage === 'need_design') return 'need_design';
  return 'not_started';
}

/**
 * Returns ALL stage buckets a product currently belongs to (a product can be
 * simultaneously Designed, Quoting, Sampling, etc.). Used by the Dashboard
 * stage tiles and the Products page stage filter so a product shows up in
 * every applicable column rather than only its furthest stage.
 */
export function productStageBuckets(
  p: Pick<Product, 'design_stage' | 'quote_stage' | 'sample_stage'>,
  inquiryStatus?: string | null,
): StageBucket[] {
  const buckets: StageBucket[] = [];
  if (inquiryStatus === 'po') buckets.push('po');
  if (p.sample_stage === 'sampled') buckets.push('sampled');
  if (p.sample_stage === 'sampling') buckets.push('sampling');
  if (p.quote_stage === 'quoted') buckets.push('quoted');
  if (p.quote_stage === 'ready_for_quote') buckets.push('ready_for_quote');
  if (p.quote_stage === 'quoting') buckets.push('quoting');
  if (p.design_stage === 'designed') buckets.push('designed');
  if (p.design_stage === 'need_design') buckets.push('need_design');
  if (buckets.length === 0) buckets.push('not_started');
  return buckets;
}

export const STAGE_BUCKET_LABELS: Record<StageBucket, string> = {
  not_started: 'Not Started',
  need_design: 'Need Design',
  designed: 'Designed',
  quoting: 'Quoting',
  ready_for_quote: 'Ready for Quote',
  quoted: 'Quoted',
  sampling: 'Sampling',
  sampled: 'Sampled',
  po: 'PO',
};

export const STAGE_BUCKET_ORDER: StageBucket[] = [
  'not_started',
  'need_design',
  'designed',
  'quoting',
  'ready_for_quote',
  'quoted',
  'sampling',
  'sampled',
  'po',
];

export const STAGE_BUCKET_COLOR: Record<StageBucket, string> = {
  not_started: 'bg-muted text-muted-foreground',
  need_design: 'bg-amber-200 text-amber-950 dark:bg-amber-400/90 dark:text-amber-950',
  designed: 'bg-blue-200 text-blue-950 dark:bg-blue-400/90 dark:text-blue-950',
  quoting: 'bg-amber-200 text-amber-950 dark:bg-amber-400/90 dark:text-amber-950',
  ready_for_quote: 'bg-blue-200 text-blue-950 dark:bg-blue-400/90 dark:text-blue-950',
  quoted: 'bg-purple-200 text-purple-950 dark:bg-purple-400/90 dark:text-purple-950',
  sampling: 'bg-amber-200 text-amber-950 dark:bg-amber-400/90 dark:text-amber-950',
  sampled: 'bg-teal-200 text-teal-950 dark:bg-teal-400/90 dark:text-teal-950',
  po: 'bg-emerald-300 text-emerald-950 dark:bg-emerald-400/90 dark:text-emerald-950',
};

/**
 * Shared weighted-pipeline calculation. Used by both Dashboard and Analytics
 * so the number is identical everywhere.
 *
 * If an inquiry has a projection row with projected_fob_revenue_usd, that
 * inquiry's contribution = projected_fob_revenue × effective_certainty
 * (certainty_override if set, else average product stage weight).
 * Otherwise, falls back to the legacy product-level cost × qty × stage_weight.
 */
type ProjectionRow = {
  inquiry_id: string;
  projected_fob_revenue_usd: number | null;
  project_gpm: number | null;
  certainty_override: number | null;
};

export function computeWeightedPipeline(
  products: Array<Pick<Product, 'id' | 'name' | 'quantity' | 'design_stage' | 'quote_stage' | 'sample_stage' | 'customer_rfq_id'>>,
  inquiryStatusById: Record<string, string>,
  pricing: Record<string, { unit_cost_usd: number; unit_price_usd: number }>,
  projectionsByInquiry: Record<string, ProjectionRow> = {},
) {
  let total = 0;
  let profit = 0;
  let counted = 0;
  let skippedNoPrice = 0;
  let skippedNoQty = 0;
  const contributors: Array<{ name: string; qty: number; cost: number; price: number; weight: number; value: number; inquiryId: string | null }> = [];

  const productsByInquiry: Record<string, typeof products> = {};
  for (const p of products) {
    if (p.customer_rfq_id) (productsByInquiry[p.customer_rfq_id] ||= []).push(p);
  }

  const inquiriesUsingProjection = new Set<string>();

  for (const [inqId, inqProducts] of Object.entries(productsByInquiry)) {
    const inqStatus = inquiryStatusById[inqId];
    if (inqStatus !== 'active' && inqStatus !== 'po' && inqStatus !== 'projected_po') continue;
    const proj = projectionsByInquiry[inqId];
    // The stored projection FOB/GPM are authoritative only when PO/complete.
    // Otherwise we compute live from the products via the loop below.
    const useStored = inqStatus === 'po' && proj && proj.projected_fob_revenue_usd != null;
    if (useStored) {
      const certainty = proj.certainty_override != null ? Number(proj.certainty_override) : 1.0;
      if (certainty <= 0) continue;
      const rev = Number(proj.projected_fob_revenue_usd);
      const value = rev * certainty;
      const gpm = proj.project_gpm != null ? Number(proj.project_gpm) : 0;
      total += value;
      profit += rev * gpm * certainty;
      counted += 1;
      contributors.push({
        name: `Inquiry ${inqId.slice(0, 8)} (PO snapshot)`,
        qty: 1,
        cost: rev * (1 - gpm),
        price: rev,
        weight: certainty,
        value,
        inquiryId: inqId,
      });
      inquiriesUsingProjection.add(inqId);
      continue;
    }
    // Projected POs: weight whole inquiry by override or 0.5, using live FOB
    // (sum of qty × price across all products regardless of product stage).
    if (inqStatus === 'projected_po') {
      const certainty = proj?.certainty_override != null ? Number(proj.certainty_override) : 0.5;
      if (certainty <= 0) { inquiriesUsingProjection.add(inqId); continue; }
      let rev = 0, cost = 0;
      for (const p of inqProducts) {
        const qty = p.quantity ?? 0;
        const price = pricing[p.id]?.unit_price_usd ?? 0;
        const c = pricing[p.id]?.unit_cost_usd ?? 0;
        rev += qty * price;
        cost += qty * c;
      }
      if (rev <= 0) { inquiriesUsingProjection.add(inqId); continue; }
      const value = rev * certainty;
      total += value;
      profit += Math.max(0, rev - cost) * certainty;
      counted += 1;
      contributors.push({
        name: `Inquiry ${inqId.slice(0, 8)} (projected PO live)`,
        qty: 1,
        cost,
        price: rev,
        weight: certainty,
        value,
        inquiryId: inqId,
      });
      inquiriesUsingProjection.add(inqId);
    }
  }


  for (const p of products) {
    if (p.customer_rfq_id && inquiriesUsingProjection.has(p.customer_rfq_id)) continue;
    const inqStatus = p.customer_rfq_id ? inquiryStatusById[p.customer_rfq_id] : null;
    if (inqStatus !== 'active' && inqStatus !== 'po' && inqStatus !== 'projected_po') continue;
    const w = productWeight(p, inqStatus);
    if (w === 0) continue;
    const qty = p.quantity ?? 0;
    if (qty === 0) { skippedNoQty += 1; continue; }
    const price = pricing[p.id]?.unit_price_usd ?? 0;
    if (price === 0) { skippedNoPrice += 1; continue; }
    const cost = pricing[p.id]?.unit_cost_usd ?? 0;
    const value = qty * price * w;
    total += value;
    profit += qty * Math.max(0, price - cost) * w;
    counted += 1;
    contributors.push({ name: p.name, qty, cost, price, weight: w, value, inquiryId: p.customer_rfq_id });
  }
  contributors.sort((a, b) => b.value - a.value);
  return { total, profit, counted, skippedNoPrice, skippedNoQty, contributors };
}



