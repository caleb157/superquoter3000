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
 */
export function computeWeightedPipeline(
  products: Array<Pick<Product, 'id' | 'name' | 'quantity' | 'design_stage' | 'quote_stage' | 'sample_stage' | 'customer_rfq_id'>>,
  inquiryStatusById: Record<string, string>,
  pricing: Record<string, { unit_cost_usd: number; unit_price_usd: number }>,
) {
  let total = 0;
  let profit = 0;
  let counted = 0;
  let skippedNoCost = 0;
  let skippedNoQty = 0;
  const contributors: Array<{ name: string; qty: number; cost: number; weight: number; value: number; inquiryId: string | null }> = [];
  for (const p of products) {
    const inqStatus = p.customer_rfq_id ? inquiryStatusById[p.customer_rfq_id] : null;
    if (inqStatus !== 'active' && inqStatus !== 'po') continue;
    const w = productWeight(p, inqStatus);
    if (w === 0) continue;
    const qty = p.quantity ?? 0;
    if (qty === 0) { skippedNoQty += 1; continue; }
    const cost = pricing[p.id]?.unit_cost_usd ?? 0;
    if (cost === 0) { skippedNoCost += 1; continue; }
    const price = pricing[p.id]?.unit_price_usd ?? 0;
    const value = qty * cost * w;
    total += value;
    profit += qty * Math.max(0, price - cost) * w;
    counted += 1;
    contributors.push({ name: p.name, qty, cost, weight: w, value, inquiryId: p.customer_rfq_id });
  }
  contributors.sort((a, b) => b.value - a.value);
  return { total, profit, counted, skippedNoCost, skippedNoQty, contributors };
}

