// A task links to at most ONE thing (or nothing). New kinds can be added here
// without schema changes: association_type + association_id + association_label.

export type AssociationType = 'inquiry' | 'customer' | 'odoo_so' | 'odoo_mo' | 'complaint' | 'app_fix';

// An app fix is a needed change to this app itself; it links to nothing, the type is the tag.
export const APP_FIX: AssociationType = 'app_fix';

export const ASSOCIATION_TYPES: { value: AssociationType; label: string; short: string; idLabel: string; detailLabel?: string; idPlaceholder?: string; detailPlaceholder?: string }[] = [
  { value: 'inquiry', label: 'Inquiry', short: 'Inquiry', idLabel: 'Inquiry' },
  { value: 'customer', label: 'Customer', short: 'Customer', idLabel: 'Customer' },
  { value: 'odoo_so', label: 'Sales order (Odoo)', short: 'SO', idLabel: 'SO number', detailLabel: 'Customer / reference', idPlaceholder: 'S00108', detailPlaceholder: 'West Elm · Dining Table Fall Drop' },
  { value: 'odoo_mo', label: 'Manufacturing order (Odoo)', short: 'MO', idLabel: 'MO number', detailLabel: 'SKU', idPlaceholder: 'WH/MO/00225', detailPlaceholder: 'TBL-ACACIA-84' },
  { value: 'complaint', label: 'Customer complaint', short: 'Complaint', idLabel: 'Complaint' },
  { value: 'app_fix', label: 'App fix (change to this app)', short: 'App fix', idLabel: '' },
];

export function associationMeta(t: string | null | undefined) {
  return ASSOCIATION_TYPES.find(a => a.value === t) ?? null;
}

/** How a complaint reads on a linked task: "2026-10-12 · West Elm · Chipped legs on arrival". */
export function complaintLabel(c: { date_logged: string; issue_summary: string }, customer: string | null | undefined) {
  const issue = c.issue_summary.length > 60 ? c.issue_summary.slice(0, 57).trimEnd() + '…' : c.issue_summary;
  return [c.date_logged, customer, issue].filter(Boolean).join(' · ');
}
