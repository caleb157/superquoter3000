// A task links to at most ONE thing (or nothing). New kinds can be added here
// without schema changes: association_type + association_id + association_label.

export type AssociationType = 'inquiry' | 'customer' | 'odoo_so' | 'odoo_mo';

export const ASSOCIATION_TYPES: { value: AssociationType; label: string; short: string; idLabel: string; detailLabel?: string; idPlaceholder?: string; detailPlaceholder?: string }[] = [
  { value: 'inquiry', label: 'Inquiry', short: 'Inquiry', idLabel: 'Inquiry' },
  { value: 'customer', label: 'Customer', short: 'Customer', idLabel: 'Customer' },
  { value: 'odoo_so', label: 'Sales order (Odoo)', short: 'SO', idLabel: 'SO number', detailLabel: 'Customer / reference', idPlaceholder: 'S00108', detailPlaceholder: 'West Elm · Dining Table Fall Drop' },
  { value: 'odoo_mo', label: 'Manufacturing order (Odoo)', short: 'MO', idLabel: 'MO number', detailLabel: 'SKU', idPlaceholder: 'WH/MO/00225', detailPlaceholder: 'TBL-ACACIA-84' },
];

export function associationMeta(t: string | null | undefined) {
  return ASSOCIATION_TYPES.find(a => a.value === t) ?? null;
}
