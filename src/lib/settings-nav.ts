// Settings navigation: five groups, plus the words each section answers to so the
// search box can jump to a setting by name (e.g. "exchange rate" finds General, where Live rates sit).

export type SectionId =
  | 'task-automations' | 'general' | 'entities' | 'quote-terms' | 'projections'
  | 'product-types' | 'chemicals' | 'hardware'
  | 'shipping' | 'fob-rates' | 'box-data'
  | 'finishing-difficulty'
  | 'raw-materials' | 'cogs-categories'
  | 'local-transport' | 'container-types' | 'data-export';

export type NavItem = { id: SectionId; label: string; keywords: string[] };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Company',
    items: [
      { id: 'general', label: 'General', keywords: [
        // Live rates, Currencies, Team and Employees all sit on the General page.
        'live rates', 'odoo', 'trax', 'exchange rate', 'inr usd', 'fully burdened', 'indirect overhead', 'man-hour', 'direct wages',
        'currencies', 'currency', 'import rate', 'export rate', 'fx', 'gbp', 'eur', 'aud',
        'team', 'users', 'members', 'roles', 'admin', 'access', 'assignee',
        'employees', 'labor rates', 'hourly rate', 'wages', 'designations', 'finishing rate', 'packaging rate',
      ] },
      { id: 'entities', label: 'Company entities', keywords: ['entity', 'parable ventures', 'dkt', 'logo', 'address', 'bank', 'gst'] },
      { id: 'quote-terms', label: 'Quote Terms', keywords: ['terms and policies', 'clauses', 'validity', 'lead time', 'changelog', 'quote pdf'] },
      { id: 'projections', label: 'Projections', keywords: ['certainty', 'repeat order', 'deposit', 'inter-entity', 'cash flow'] },
      { id: 'task-automations', label: 'Task automations', keywords: ['tasks', 'odoo', 'webhook', 'rules', 'lead'] },
    ],
  },
  {
    label: 'Costing rates',
    items: [
      { id: 'product-types', label: 'Product types', keywords: ['finishing', 'color', 'sealer', 'lacquer', 'wax', 'ic add', 'man-hours per cbm', 'percent wood', 'default chemicals'] },
      { id: 'chemicals', label: 'Chemicals', keywords: ['finishing chemicals', 'color', 'stain', 'sealer', 'lacquer', 'wax', 'paint', 'price per litre'] },
      { id: 'hardware', label: 'Hardware', keywords: ['fittings', 'screws', 'hinges', 'accessories'] },
      { id: 'raw-materials', label: 'Raw material costs', keywords: ['iron', 'metal', 'steel', 'raw piece', 'material price'] },
      { id: 'cogs-categories', label: 'COGS categories', keywords: ['cost categories', 'cogs type'] },
      { id: 'box-data', label: 'Box prices', keywords: ['cartons', 'ply', 'inner carton', 'master carton', 'od', 'cost per sq in', 'mc height buffer', 'packaging'] },
    ],
  },
  {
    label: 'Labor',
    items: [
      { id: 'finishing-difficulty', label: 'Finishing difficulty', keywords: ['easy', 'medium', 'hard', 'rupees per running inch', 'ri', 'difficulty factor'] },
    ],
  },
  {
    label: 'Logistics',
    items: [
      { id: 'shipping', label: 'Shipping', keywords: ['shipping types', 'cbm', 'kg', 'freight', 'fob fcl', 'fob lcl', 'auto transport', 'default shipping'] },
      { id: 'fob-rates', label: 'FOB rates', keywords: ['fob', 'container', 'fcl', 'lcl', 'icd', 'jodhpur', 'fumigation', 'wildlife', 'trucking'] },
      { id: 'local-transport', label: 'Local transport', keywords: ['domestic freight', 'source location', 'external sourcing', 'cost per cbm'] },
      { id: 'container-types', label: 'Container types', keywords: ['20ft', '40ft', 'hc', 'container size', 'usable volume'] },
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

/** Old section links that now live as a part of another page: #live-rates opens General at Live rates. */
export const MERGED_SECTIONS: Record<string, SectionId> = {
  'live-rates': 'general', currencies: 'general', team: 'general', employees: 'general',
};

/** The page and (for a merged section) the part to scroll to for a URL hash, or null if unknown. */
export function resolveSettingsHash(hash: string): { section: SectionId; anchor: string | null } | null {
  const h = hash.replace('#', '');
  if ((VALID_SECTIONS as string[]).includes(h)) return { section: h as SectionId, anchor: null };
  if (MERGED_SECTIONS[h]) return { section: MERGED_SECTIONS[h], anchor: h };
  return null;
}

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
