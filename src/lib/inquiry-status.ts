// Canonical inquiry status constants — shared across Dashboard, InquiryDetail,
// CustomerDetail, and anywhere else status pills / dropdowns appear.

export const STATUS_OPTIONS: string[] = [
  'active',
  'paused',
  'projected_po',
  'po',
  'complete',
  'cancelled',
];

export type InquiryStatus = 'active' | 'paused' | 'projected_po' | 'po' | 'complete' | 'cancelled';

export const INQUIRY_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  paused: 'Paused',
  projected_po: 'Projected PO',
  po: 'PO',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

export const INQUIRY_STATUS_COLORS: Record<string, string> = {
  // Semantic tones: active=in progress (amber), projected_po=upcoming complete (emerald soft),
  // po=complete (emerald), paused=issue-lite (amber), complete=idle-done (graphite), cancelled=idle.
  active: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  paused: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  projected_po: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  po: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  complete: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground/70',
};

export function statusLabel(s: string | null | undefined): string {
  if (!s) return '';
  return INQUIRY_STATUS_LABEL[s] ?? s;
}
