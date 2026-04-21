import type { Tables } from '@/integrations/supabase/types';

export type Product = Tables<'products'>;
export type Inquiry = Tables<'customer_rfqs'>;

export function productWeight(
  p: Pick<Product, 'design_stage' | 'quote_stage' | 'sample_stage'>,
  inquiryStatus?: string | null,
): number {
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
  | 'sample_sent'
  | 'po';

export function furthestStageBucket(
  p: Pick<Product, 'design_stage' | 'quote_stage' | 'sample_stage'>,
  inquiryStatus?: string | null,
): StageBucket {
  if (inquiryStatus === 'po') return 'po';
  if (p.sample_stage === 'sample_sent') return 'sample_sent';
  if (p.sample_stage === 'sampling') return 'sampling';
  if (p.quote_stage === 'quoted') return 'quoted';
  if (p.quote_stage === 'ready_for_quote') return 'ready_for_quote';
  if (p.quote_stage === 'quoting') return 'quoting';
  if (p.design_stage === 'designed') return 'designed';
  if (p.design_stage === 'need_design') return 'need_design';
  return 'not_started';
}

export const STAGE_BUCKET_LABELS: Record<StageBucket, string> = {
  not_started: 'Not Started',
  need_design: 'Need Design',
  designed: 'Designed',
  quoting: 'Quoting',
  ready_for_quote: 'Ready for Quote',
  quoted: 'Quoted',
  sampling: 'Sampling',
  sample_sent: 'Sample Sent',
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
  'sample_sent',
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
  sample_sent: 'bg-blue-200 text-blue-950 dark:bg-blue-400/90 dark:text-blue-950',
  po: 'bg-emerald-300 text-emerald-950 dark:bg-emerald-400/90 dark:text-emerald-950',
};
