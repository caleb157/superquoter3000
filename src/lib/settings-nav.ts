// Settings navigation: five groups, plus the words each section answers to so the
// search box can jump to a setting by name (e.g. "exchange rate" finds Live rates).

export type SectionId =
  | 'task-automations' | 'general' | 'live-rates' | 'entities' | 'quote-terms' | 'team' | 'projections'
  | 'employees'
  | 'product-types' | 'wood' | 'chemicals' | 'hardware'
  | 'shipping' | 'fob-rates' | 'box-data' | 'wrapping'
  | 'currencies' | 'finishing-difficulty'
  | 'raw-materials' | 'cogs-categories'
  | 'local-transport' | 'container-types' | 'data-export';

export type NavItem = { id: SectionId; label: string; keywords: string[] };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Company',
    items: [
      { id: 'general', label: 'General', keywords: ['auto transport', 'slow quote', 'slow sample', 'threshold', 'below moq', 'surcharge'] },
      { id: 'live-rates', label: 'Live rates', keywords: ['live', 'odoo', 'trax', 'exchange rate', 'inr usd', 'fully burdened', 'indirect overhead', 'man-hour', 'direct wages'] },
      { id: 'entities', label: 'Company entities', keywords: ['entity', 'parable ventures', 'dkt', 'logo', 'address', 'bank', 'gst'] },
      { id: 'quote-terms', label: 'Quote Terms', keywords: ['terms and policies', 'clauses', 'validity', 'lead time', 'changelog', 'quote pdf'] },
      { id: 'currencies', label: 'Currencies', keywords: ['currency', 'import rate', 'export rate', 'fx', 'gbp', 'eur', 'aud'] },
      { id: 'team', label: 'Team', keywords: ['users', 'members', 'roles', 'admin', 'access', 'assignee'] },
      { id: 'projections', label: 'Projections', keywords: ['certainty', 'repeat order', 'deposit', 'inter-entity', 'cash flow'] },
      { id: 'task-automations', label: 'Task automations', keywords: ['tasks', 'odoo', 'webhook', 'rules', 'lead'] },
    ],
  },
  {
    label: 'Costing rates',
    items: [
      { id: 'product-types', label: 'Product types', keywords: ['finishing', 'color', 'sealer', 'lacquer', 'wax', 'ic add', 'man-hours per cbm', 'percent wood', 'default chemicals'] },
      { id: 'wood', label: 'Wood prices', keywords: ['timber', 'cft', 'teak', 'mango', 'acacia', 'sheesham'] },
      { id: 'chemicals', label: 'Chemicals', keywords: ['finishing chemicals', 'color', 'stain', 'sealer', 'lacquer', 'wax', 'paint', 'price per litre'] },
      { id: 'hardware', label: 'Hardware', keywords: ['fittings', 'screws', 'hinges', 'accessories'] },
      { id: 'raw-materials', label: 'Raw material costs', keywords: ['iron', 'metal', 'steel', 'raw piece', 'material price'] },
      { id: 'cogs-categories', label: 'COGS categories', keywords: ['cost categories', 'cogs type'] },
    ],
  },
  {
    label: 'Labor',
    items: [
      { id: 'employees', label: 'Employees', keywords: ['labor rates', 'hourly rate', 'wages', 'designations', 'finishing rate', 'packaging rate'] },
      { id: 'finishing-difficulty', label: 'Finishing difficulty', keywords: ['easy', 'medium', 'hard', 'rupees per running inch', 'ri', 'difficulty factor'] },
    ],
  },
  {
    label: 'Logistics',
    items: [
      { id: 'shipping', label: 'Shipping', keywords: ['shipping types', 'cbm', 'kg', 'freight', 'fob fcl', 'fob lcl'] },
      { id: 'fob-rates', label: 'FOB rates', keywords: ['fob', 'container', 'fcl', 'lcl', 'icd', 'jodhpur', 'fumigation', 'wildlife', 'trucking'] },
      { id: 'local-transport', label: 'Local transport', keywords: ['domestic freight', 'source location', 'external sourcing', 'cost per cbm'] },
      { id: 'container-types', label: 'Container types', keywords: ['20ft', '40ft', 'hc', 'container size', 'usable volume'] },
      { id: 'box-data', label: 'Box prices', keywords: ['cartons', 'ply', 'inner carton', 'master carton', 'od', 'cost per sq in'] },
      { id: 'wrapping', label: 'Wrapping', keywords: ['corrugate', 'bubble wrap', 'mc height buffer', 'packaging'] },
    ],
  },
  {
    label: 'Data',
    items: [
      { id: 'data-export', label: 'Data export', keywords: ['backup', 'download', 'excel', 'xlsx', 'csv'] },
    ],
  },
];

export const ALL_SECTIONS: NavItem[] = NAV_GROUPS.flatMap(g => g.items);
export const VALID_SECTIONS: SectionId[] = ALL_SECTIONS.map(i => i.id);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9₹%]+/g, ' ').trim();

/** Groups filtered to sections whose name, group or keywords contain every word typed. */
export function searchSettings(query: string): NavGroup[] {
  const words = norm(query).split(' ').filter(Boolean);
  if (words.length === 0) return NAV_GROUPS;
  return NAV_GROUPS
    .map(g => ({
      ...g,
      items: g.items.filter(i => {
        const hay = norm([i.label, g.label, ...i.keywords].join(' '));
        return words.every(w => hay.includes(w));
      }),
    }))
    .filter(g => g.items.length > 0);
}
