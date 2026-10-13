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
  active: 'bg-warning/15 text-warning',
  paused: 'bg-destructive/15 text-destructive',
  projected_po: 'bg-success/10 text-success',
  po: 'bg-success/15 text-success',
  complete: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground/70',
};

export function statusLabel(s: string | null | undefined): string {
  if (!s) return '';
  return INQUIRY_STATUS_LABEL[s] ?? s;
}
