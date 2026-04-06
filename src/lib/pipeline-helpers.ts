import type { Tables } from '@/integrations/supabase/types';

export type PipelineItem = Tables<'pipeline_items'>;

export type PipelineStage =
  | 'needs_design'
  | 'needs_photo'
  | 'needs_quote'
  | 'needs_sample'
  | 'sample_in_progress'
  | 'needs_followup'
  | 'done';

export function getStage(item: PipelineItem): PipelineStage {
  if (item.status === 'done') return 'done';
  if (!item.design_done) return 'needs_design';
  if (!item.photo_done) return 'needs_photo';
  if (item.rfq_date && !item.initial_quote_date) return 'needs_quote';
  if (item.initial_quote_date && !item.sample_request_date) return 'needs_sample';
  if (item.sample_request_date && !item.final_sample_date) return 'sample_in_progress';
  if (item.initial_quote_date) {
    const days = daysSince(item.rfq_date);
    if (days !== null && days > 21) return 'needs_followup';
  }
  return 'needs_sample'; // fallback
}

export function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / 86400000);
}

export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a);
  const db = new Date(b);
  return Math.floor((db.getTime() - da.getTime()) / 86400000);
}

export const STAGE_LABELS: Record<PipelineStage, string> = {
  needs_design: 'Design Needed',
  needs_photo: 'Awaiting Photo',
  needs_quote: 'Awaiting Quote',
  needs_sample: 'Awaiting Sample Request',
  sample_in_progress: 'Sample in Progress',
  needs_followup: 'Follow-up Needed',
  done: 'Done',
};

export const STAGE_COLORS: Record<PipelineStage, string> = {
  needs_design: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  needs_photo: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  needs_quote: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  needs_sample: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  sample_in_progress: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  needs_followup: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  done: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
};

export const STATUS_OPTIONS = ['active', 'paused', 'done', 'cancelled'] as const;
