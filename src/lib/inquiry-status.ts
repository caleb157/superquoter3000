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
  active: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  paused: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  projected_po: 'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  po: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  complete: 'bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300',
  cancelled: 'bg-gray-200 text-gray-600 dark:bg-gray-500/20 dark:text-gray-300',
};

export function statusLabel(s: string | null | undefined): string {
  if (!s) return '';
  return INQUIRY_STATUS_LABEL[s] ?? s;
}
