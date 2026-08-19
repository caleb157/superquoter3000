// Shared PD checklist item definitions + applicability rules.
// Used by the per-inquiry PD View and the global PD Dashboard.

export type PdItemKey =
  | 'finishing_panel_wood'
  | 'finishing_panel_metal'
  | 'ic_size'
  | 'mc_size'
  | 'packaging'
  | 'inserts_instructions'
  | 'handles_knobs'
  | 'feet_buffers'
  | 'handles_latches'
  | 'other_hardware'
  | 'accessories'
  | 'qc_sheet'
  | 'final_product_photo';

export type PdItemDef = {
  key: PdItemKey;
  label: string;
  group: string;
  /** COGS category name this item depends on; item is greyed out when the product has no such rows. */
  cogsCategory?: string;
  /** Greyed out unless the product's packaging_type is 'ic_mc'. */
  requiresIcMc?: boolean;
  /** Greyed out when the product is 0% wood. */
  requiresWood?: boolean;
  /** Greyed out when the product is 100% wood (no metal). */
  requiresMetal?: boolean;
};

export const PD_ITEMS: PdItemDef[] = [
  { key: 'finishing_panel_wood',  label: 'Finishing Panel — Wood',   group: 'Finishing', requiresWood: true },
  { key: 'finishing_panel_metal', label: 'Finishing Panel — Metal',  group: 'Finishing', requiresMetal: true },
  { key: 'ic_size',               label: 'IC SIZE',                  group: 'Packaging' },
  { key: 'mc_size',               label: 'MC SIZE',                  group: 'Packaging', requiresIcMc: true },
  { key: 'packaging',             label: 'Packaging',                group: 'Packaging' },
  { key: 'inserts_instructions',  label: 'Inserts/Instructions',     group: 'Packaging', cogsCategory: 'Inserts + Instructions' },
  { key: 'handles_knobs',         label: 'Handles/Knobs',            group: 'Hardware',  cogsCategory: 'Handles + Knobs' },
  { key: 'feet_buffers',          label: 'Feet/Buffers',             group: 'Hardware',  cogsCategory: 'Feet/Buffers' },
  { key: 'handles_latches',       label: 'Hinges/Latches',           group: 'Hardware',  cogsCategory: 'Handles/Latches' },
  { key: 'other_hardware',        label: 'Other Hardware',           group: 'Hardware',  cogsCategory: 'Other Hardware' },
  { key: 'accessories',           label: 'Accessories',              group: 'Accessories', cogsCategory: 'Accessories' },
  { key: 'qc_sheet',              label: 'QC Sheet',                 group: 'QC' },
  { key: 'final_product_photo',   label: 'Final Product Photo',      group: 'QC' },
];

/** Legacy COGS rows still typed 'Hardware' count towards "Other Hardware". */
export const PD_LEGACY_CATEGORY_ALIAS: Record<string, string> = { Hardware: 'Other Hardware' };

export type PdProductShape = {
  id: string;
  packaging_type: string | null;
  percent_wood: number | null;
};

export function pdIsDisabled(
  p: PdProductShape,
  item: PdItemDef,
  cogsCats: Record<string, Set<string>>,
): boolean {
  if (item.requiresWood) return p.percent_wood === 0;
  if (item.requiresMetal) return p.percent_wood === 1;
  if (item.requiresIcMc) return (p.packaging_type || 'ic_mc') !== 'ic_mc';
  if (item.cogsCategory) return !cogsCats[p.id]?.has(item.cogsCategory);
  return false;
}

export function pdDisabledReason(p: PdProductShape, item: PdItemDef): string {
  if (item.requiresWood) return 'No wood on this product (0% wood).';
  if (item.requiresMetal) return 'No metal on this product (100% wood).';
  if (item.requiresIcMc) return `No master carton — packaging is "${p.packaging_type || 'ic_mc'}".`;
  if (item.cogsCategory) return `No "${item.cogsCategory}" COGS rows on this product.`;
  return '';
}
