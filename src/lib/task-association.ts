// A task links to at most ONE thing (or nothing). New kinds can be added here
// without schema changes: association_type + association_id + association_label.

export type AssociationType = 'inquiry' | 'customer' | 'project' | 'odoo_so' | 'odoo_mo' | 'app_fix';

// An app fix is a needed change to this app itself; it links to nothing, the type is the tag.
export const APP_FIX: AssociationType = 'app_fix';

// A project (projects table): association_id = project id, association_label = project name.
export const PROJECT: AssociationType = 'project';

export const ASSOCIATION_TYPES: { value: AssociationType; label: string; short: string; idLabel: string; detailLabel?: string; idPlaceholder?: string; detailPlaceholder?: string }[] = [
  { value: 'inquiry', label: 'Inquiry', short: 'Inquiry', idLabel: 'Inquiry' },
  { value: 'customer', label: 'Customer', short: 'Customer', idLabel: 'Customer' },
  { value: 'project', label: 'Project', short: 'Project', idLabel: 'Project' },
  { value: 'odoo_so', label: 'Sales order (Odoo)', short: 'SO', idLabel: 'SO number', detailLabel: 'Customer / reference', idPlaceholder: 'S00108', detailPlaceholder: 'West Elm · Dining Table Fall Drop' },
  { value: 'odoo_mo', label: 'Manufacturing order (Odoo)', short: 'MO', idLabel: 'MO number', detailLabel: 'SKU', idPlaceholder: 'WH/MO/00225', detailPlaceholder: 'TBL-ACACIA-84' },
  { value: 'app_fix', label: 'App fix (change to this app)', short: 'App fix', idLabel: '' },
];

export function associationMeta(t: string | null | undefined) {
  return ASSOCIATION_TYPES.find(a => a.value === t) ?? null;
}
