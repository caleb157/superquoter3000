import type { Tables } from '@/integrations/supabase/types';

export type Product = Tables<'products'>;
export type Inquiry = Tables<'customer_rfqs'>;

export function productWeight(
  p: Pick<Product, 'design_stage' | 'quote_stage' | 'sample_stage'>,
  inquiryStatus?: string | null,
): number {
  if (inquiryStatus === 'complete' || inquiryStatus === 'cancelled' || inquiryStatus === 'po') return 0;
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
