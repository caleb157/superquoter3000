// Send to Odoo (phase 1): turns a product's costed lines into two Odoo import files,
// products.xlsx (the new finished product + any new components) and bom.xlsx (the BOM in
// the layout of Odoo's own mrp.bom export). Nothing is written to Odoo: you import the files.
//
// Quantities come from the costing engine's resolved COGS rows (waste included, the same
// qty ÷ (1 − waste) the cost uses) and are converted to the matched Odoo product's unit,
// including Odoo pack-fraction units such as "1/20th of a Pack".

export type OdooProduct = {
  id: number | null;      // product.product id (null when typed by hand without the live lookup)
  sku: string;
  name: string;
  display_name: string;   // "[SKU] Name", what the BOM file references
  uom: string;
  category?: string;
  tracked?: boolean;
};

export type LineStatus = 'match' | 'new' | 'skip';

export type NewItem = {
  name: string;
  sku: string;
  category: string;
  tracked: boolean;
  uom: string;
  purchaseUom: string;
  cost: number | null;    // ₹ per unit of `uom`
  hsn: string;
};

export type DraftLine = {
  lineId: string;          // cogs_items.id
  key: string;             // link key: cogs type + name
  cogsType: string;
  hqName: string;
  hqQty: number;           // per finished unit, waste included
  hqUnit: string;
  hqCostPerUnit: number;   // ₹ per HQ unit
  vendor: string;
  status: LineStatus;
  match: OdooProduct | null;
  newItem: NewItem;
  qtyOverride: number | null; // quantity in the Odoo unit, typed by hand
};

export type FinishedDraft = {
  name: string;
  sku: string;
  code: string;            // BOM reference, e.g. "RADC Dark"
  category: string;
  tracked: boolean;
  uom: string;
  salePrice: number | null;
  hsn: string;
  weightKg: number | null;
  volumeM3: number | null;
  route: string;
  company: string;
};

export const DEFAULT_COMPANY = 'Parable Ventures Private Limited';
export const FINISHED_CATEGORY = 'All / Saleable / Final Product';
const RAW_TRACKED = 'All / Expenses / Raw Materials AVCO Automatic';
const RAW_UNTRACKED = 'All / Expenses / Non-Inventory Raw Material AVCO';

type Defaults = { status: LineStatus; prefix: string; category: string; tracked: boolean; uom: string };

/** Starting values for a new component, by HQ cost category (read from how Odoo's existing products are set up). */
export const CATEGORY_DEFAULTS: Record<string, Defaults> = {
  'Raw Piece': { status: 'new', prefix: 'PIC', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Wood': { status: 'new', prefix: 'TMB', category: RAW_TRACKED, tracked: true, uom: 'cu ft' },
  'Finishing Materials': { status: 'new', prefix: 'CHM', category: RAW_TRACKED, tracked: true, uom: 'L' },
  'Inserts + Instructions': { status: 'new', prefix: 'PPR', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Handles + Knobs': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Handles/Latches': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Feet/Buffers': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Other Hardware': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Hardware': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Accessories': { status: 'new', prefix: 'ACC', category: RAW_UNTRACKED, tracked: false, uom: 'Units' },
  'Packaging': { status: 'new', prefix: 'PBX', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Components': { status: 'new', prefix: '', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Other': { status: 'new', prefix: '', category: RAW_UNTRACKED, tracked: false, uom: 'Units' },
  'Subcontracting': { status: 'skip', prefix: 'SUB', category: 'All / Expenses / Subcontracting Services (AVCO)', tracked: false, uom: 'Units' },
  'Outsourced Product': { status: 'skip', prefix: '', category: RAW_TRACKED, tracked: true, uom: 'Units' },
};
const FALLBACK_DEFAULTS: Defaults = { status: 'new', prefix: '', category: RAW_TRACKED, tracked: true, uom: 'Units' };
export const defaultsFor = (cogsType: string): Defaults => CATEGORY_DEFAULTS[cogsType] ?? FALLBACK_DEFAULTS;

/** Lines that are never BOM lines (a cost, not a material). */
const NEVER_BOM = ['domestic freight (external sourcing)'];

export const linkKey = (cogsType: string, name: string) =>
  `${(cogsType || '').trim().toLowerCase()}|${(name || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;

const round = (n: number, dp = 4) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Quantity per finished unit as the engine costs it: qty ÷ (1 − waste). */
export function lineQty(row: { components_per_product?: number | null; waste_factor?: number | null }): number {
  const q = Number(row.components_per_product) || 0;
  const w = Number(row.waste_factor) || 0;
  return w > 0 && w < 1 ? q / (1 - w) : q;
}

// ---------- Units ----------

type UnitInfo = { family: string; factor: number };

const UNIT_ALIASES: Record<string, UnitInfo> = {};
const add = (family: string, factor: number, names: string[]) => names.forEach(n => { UNIT_ALIASES[n] = { family, factor }; });
add('count', 1, ['units', 'unit', 'pc', 'pcs', 'piece', 'pieces', 'nos', 'no', 'no.', 'each', 'ea', 'set', 'sets', 'pair']);
add('count', 12, ['dozen', 'dozens']);
add('liquid', 1, ['l', 'litre', 'litres', 'liter', 'liters', 'ltr', 'ltrs']);
add('liquid', 0.001, ['ml', 'millilitre', 'milliliter']);
add('mass', 1, ['kg', 'kgs', 'kilogram', 'kilograms']);
add('mass', 0.001, ['g', 'gm', 'gms', 'gram', 'grams']);
add('mass', 1000, ['t', 'ton', 'tonne']);
add('wood', 1, ['cu ft', 'cft', 'cuft', 'ft³', 'ft3', 'cubic feet', 'cubic foot']);
add('wood', 35.3147, ['cu m', 'cbm', 'm³', 'm3', 'cubic meter', 'cubic metre']);
add('area', 1, ['ft²', 'sq ft', 'sqft', 'ft2', 'square feet']);
add('area', 10.7639, ['m²', 'sq m', 'sqm', 'm2']);
add('area', 1 / 144, ['in²', 'sq in', 'sqin', 'in2']);
add('length', 1, ['m', 'meter', 'metre', 'meters', 'metres', 'mtr']);
add('length', 0.3048, ['ft', 'feet', 'foot']);
add('length', 0.0254, ['in', 'inch', 'inches']);
add('length', 0.01, ['cm']);
add('length', 0.001, ['mm']);

/** Family and size of a unit, relative to the family's base (Units, L, kg, cu ft, ft², m). */
export function unitInfo(unit: string): UnitInfo | null {
  const u = (unit || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!u) return null;
  if (UNIT_ALIASES[u]) return UNIT_ALIASES[u];
  // Odoo pack-fraction units: "1/20th of a Pack" = one twentieth of a unit.
  const frac = /^1\s*\/\s*(\d+)/.exec(u);
  if (frac && Number(frac[1]) > 0) return { family: 'count', factor: 1 / Number(frac[1]) };
  // "Pack of 20", "Box of 12".
  const pack = /(?:pack|box|carton|bundle|set)\s+of\s+(\d+)/.exec(u);
  if (pack && Number(pack[1]) > 0) return { family: 'count', factor: Number(pack[1]) };
  return null;
}

/** HQ quantity in the Odoo unit, or ok=false when the units can't be converted (quantity left as is). */
export function convertQty(qty: number, fromUnit: string, toUnit: string): { qty: number; ok: boolean } {
  const from = unitInfo(fromUnit || 'Units');
  const to = unitInfo(toUnit || 'Units');
  if ((fromUnit || '').trim().toLowerCase() === (toUnit || '').trim().toLowerCase()) return { qty: round(qty), ok: true };
  if (!from || !to || from.family !== to.family) return { qty: round(qty), ok: false };
  return { qty: round((qty * from.factor) / to.factor), ok: true };
}

// ---------- Draft ----------

/** The Odoo unit and quantity a line will carry in the BOM file. */
export function bomQty(l: DraftLine): { qty: number; uom: string; ok: boolean } {
  const uom = l.status === 'match' ? (l.match?.uom || '') : l.newItem.uom;
  if (l.qtyOverride != null) return { qty: l.qtyOverride, uom, ok: true };
  const c = convertQty(l.hqQty, l.hqUnit, uom);
  return { ...c, uom };
}

/** The cogs_items fields a draft line reads (the engine's resolved rows carry them all). */
export type CogsRow = {
  id: string; include?: string | null; cogs_type?: string | null; component_name?: string | null;
  components_per_product?: number | null; waste_factor?: number | null; unit_cost_inr?: number | null;
  units?: string | null; vendor_name?: string | null; sort_order?: number | null;
};

/** One draft line per included costing row with a quantity; links pre-match lines seen before. */
export function buildDraftLines(rows: CogsRow[], links: Map<string, OdooProduct>): DraftLine[] {
  return rows
    .filter(r => r.include !== 'No' && lineQty(r) > 0 && (r.component_name || '').trim())
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(r => {
      const cogsType = r.cogs_type || 'Other';
      const hqName = String(r.component_name).trim();
      const d = defaultsFor(cogsType);
      const key = linkKey(cogsType, hqName);
      const linked = links.get(key) ?? null;
      const hqQty = lineQty(r);
      const hqUnit = String(r.units || '').trim();
      const never = NEVER_BOM.includes(hqName.toLowerCase());
      // Cost per Odoo unit for a new item = HQ cost per HQ unit, converted.
      const conv = convertQty(1, d.uom, hqUnit || d.uom);
      const unitCost = Number(r.unit_cost_inr) || 0;
      return {
        lineId: r.id,
        key,
        cogsType,
        hqName,
        hqQty,
        hqUnit,
        hqCostPerUnit: unitCost,
        vendor: (r.vendor_name || '').trim(),
        status: never ? 'skip' : linked ? 'match' : d.status,
        match: linked,
        newItem: {
          name: hqName,
          sku: d.prefix ? `${d.prefix}-` : '',
          category: d.category,
          tracked: d.tracked,
          uom: hqUnit && unitInfo(hqUnit) ? canonicalUnit(hqUnit, d.uom) : d.uom,
          purchaseUom: '',
          cost: unitCost > 0 ? round(unitCost * (conv.ok ? conv.qty : 1), 2) : null,
          hsn: '',
        },
        qtyOverride: null,
      } as DraftLine;
    });
}

/** Odoo's own spelling of an HQ unit (pc → Units, cft → cu ft), or the category default. */
function canonicalUnit(hqUnit: string, fallback: string): string {
  const i = unitInfo(hqUnit);
  if (!i) return fallback;
  const base: Record<string, string> = { count: 'Units', liquid: 'L', mass: 'kg', wood: 'cu ft', area: 'ft²', length: 'm' };
  if (i.factor === 1) return base[i.family] ?? fallback;
  const named: Record<string, string> = { 'liquid:0.001': 'mL', 'mass:0.001': 'g', 'wood:35.3147': 'cu m', 'area:10.7639': 'm²', 'length:0.0254': 'in', 'length:0.3048': 'ft', 'length:0.01': 'cm', 'length:0.001': 'mm' };
  return named[`${i.family}:${i.factor}`] ?? fallback;
}

export function defaultFinished(product: { name?: string | null; sku?: string | null; weight_kg?: number | null } | null | undefined, extra: { volumeM3?: number | null } = {}): FinishedDraft {
  const sku = (product?.sku || '').trim();
  return {
    name: (product?.name || '').trim(),
    sku,
    code: sku,
    category: FINISHED_CATEGORY,
    tracked: true,
    uom: 'Units',
    salePrice: null,
    hsn: '',
    weightKg: Number(product?.weight_kg) > 0 ? Number(product.weight_kg) : null,
    volumeM3: extra.volumeM3 && extra.volumeM3 > 0 ? round(extra.volumeM3, 4) : null,
    route: 'Manufacture',
    company: DEFAULT_COMPANY,
  };
}

export const displayName = (sku: string, name: string) => (sku ? `[${sku.trim()}] ${name.trim()}` : name.trim());

// ---------- Checks ----------

export type Issue = { level: 'error' | 'warn'; where: string; msg: string };

/** existing: SKUs (upper-cased) that already exist in Odoo, from the live lookup. */
export function checkDraft(f: FinishedDraft, lines: DraftLine[], existing: Set<string> | null): Issue[] {
  const out: Issue[] = [];
  const has = (sku: string) => !!existing && existing.has(sku.trim().toUpperCase());
  if (!f.name.trim()) out.push({ level: 'error', where: 'Finished product', msg: 'Name is missing.' });
  if (!f.sku.trim()) out.push({ level: 'error', where: 'Finished product', msg: 'SKU is missing.' });
  else if (has(f.sku)) out.push({ level: 'warn', where: 'Finished product', msg: `${f.sku} is already in Odoo, so it is left out of the products file and the BOM attaches to it.` });
  if (!f.category.trim()) out.push({ level: 'error', where: 'Finished product', msg: 'Category is missing.' });

  const skus = new Map<string, number>();
  for (const l of lines) {
    if (l.status === 'new' && l.newItem.sku.trim()) {
      const k = l.newItem.sku.trim().toUpperCase();
      skus.set(k, (skus.get(k) ?? 0) + 1);
    }
  }
  for (const l of lines) {
    const where = l.hqName;
    if (l.status === 'skip') continue;
    if (l.status === 'match') {
      if (!l.match) out.push({ level: 'error', where, msg: 'Pick the Odoo product, or mark it new or skip.' });
      else if (!bomQty(l).ok) out.push({ level: 'warn', where, msg: `Can't convert ${l.hqUnit || 'HQ units'} to ${l.match.uom || 'the Odoo unit'}; type the quantity in ${l.match.uom || 'the Odoo unit'}.` });
      continue;
    }
    const n = l.newItem;
    const sku = n.sku.trim();
    if (!n.name.trim()) out.push({ level: 'error', where, msg: 'New item name is missing.' });
    if (!sku || /-$/.test(sku)) out.push({ level: 'error', where, msg: 'New item SKU is missing or unfinished.' });
    else if ((skus.get(sku.toUpperCase()) ?? 0) > 1) out.push({ level: 'error', where, msg: `SKU ${sku} is used on more than one line.` });
    else if (has(sku)) out.push({ level: 'error', where, msg: `SKU ${sku} already exists in Odoo. Match it instead of creating it.` });
    if (sku && f.sku.trim() && sku.toUpperCase() === f.sku.trim().toUpperCase()) out.push({ level: 'error', where, msg: 'SKU is the same as the finished product.' });
    if (!n.category.trim()) out.push({ level: 'error', where, msg: 'Category is missing.' });
    if (!n.uom.trim()) out.push({ level: 'error', where, msg: 'Unit is missing.' });
    else if (!bomQty(l).ok) out.push({ level: 'warn', where, msg: `Can't convert ${l.hqUnit} to ${n.uom}; type the quantity in ${n.uom}.` });
    const raw = /raw materials avco automatic/i.test(n.category);
    const nonInv = /non-inventory/i.test(n.category);
    if (raw && !n.tracked) out.push({ level: 'warn', where, msg: 'Not tracked, but the category is a tracked raw material category.' });
    if (nonInv && n.tracked) out.push({ level: 'warn', where, msg: 'Tracked, but the category is Non-Inventory.' });
  }
  if (!lines.some(l => l.status !== 'skip')) out.push({ level: 'error', where: 'BOM', msg: 'The BOM has no lines.' });
  return out;
}

// ---------- Files ----------

const tf = (b: boolean) => (b ? 'True' : 'False');

/** product.template import rows (technical field names, which Odoo's import matches automatically). */
export function productsSheet(f: FinishedDraft, lines: DraftLine[], existing: Set<string> | null): (string | number | null)[][] {
  const header = ['name', 'default_code', 'type', 'is_storable', 'categ_id', 'uom_id', 'uom_po_id', 'sale_ok', 'purchase_ok',
    'list_price', 'standard_price', 'route_ids', 'l10n_in_hsn_code', 'weight', 'volume', 'company_id'];
  const rows: (string | number | null)[][] = [header];
  const inOdoo = (sku: string) => !!existing && existing.has(sku.trim().toUpperCase());
  if (f.sku.trim() && !inOdoo(f.sku)) {
    rows.push([f.name.trim(), f.sku.trim(), 'Goods', tf(f.tracked), f.category, f.uom, f.uom, 'True', 'False',
      f.salePrice, null, f.route || null, f.hsn || null, f.weightKg, f.volumeM3, f.company || null]);
  }
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.status !== 'new') continue;
    const n = l.newItem;
    const sku = n.sku.trim();
    if (!sku || seen.has(sku.toUpperCase()) || inOdoo(sku)) continue;
    seen.add(sku.toUpperCase());
    rows.push([n.name.trim(), sku, 'Goods', tf(n.tracked), n.category, n.uom, n.purchaseUom || n.uom, 'False', 'True',
      null, n.cost, 'Buy', n.hsn || null, null, null, f.company || null]);
  }
  return rows;
}

/** mrp.bom import rows in the layout of Odoo's own BOM export: header fields on the first row only. */
export function bomSheet(f: FinishedDraft, lines: DraftLine[]): (string | number | null)[][] {
  const header = ['company_id', 'product_tmpl_id', 'code', 'type', 'product_qty',
    'bom_line_ids/product_id', 'bom_line_ids/product_qty', 'bom_line_ids/product_uom_id'];
  const rows: (string | number | null)[][] = [header];
  const live = lines.filter(l => l.status !== 'skip');
  live.forEach((l, i) => {
    const comp = l.status === 'match' && l.match ? l.match.display_name || displayName(l.match.sku, l.match.name) : displayName(l.newItem.sku, l.newItem.name);
    const q = bomQty(l);
    const head = i === 0
      ? [f.company || null, displayName(f.sku, f.name), f.code || null, 'Manufacture this product', 1]
      : [null, null, null, null, null];
    rows.push([...head, comp, q.qty, q.uom || null]);
  });
  return rows;
}

export const fileStem = (f: FinishedDraft) => (f.sku.trim() || f.name.trim() || 'product').replace(/[^A-Za-z0-9._-]+/g, '-');

// ---------- Direct send (odoo-bom-push) ----------

export type PushPayload = {
  hqProductId: string | null;
  company: string | null;
  code: string | null;
  finished: Record<string, unknown>;
  components: Record<string, unknown>[];
  lines: { productId: number | null; sku: string | null; qty: number; uom: string }[];
};

/** What the odoo-bom-push function receives: the same draft the files are made from. */
export function pushPayload(hqProductId: string | null, f: FinishedDraft, lines: DraftLine[], existing: Set<string> | null): PushPayload {
  const inOdoo = (sku: string) => !!existing && existing.has(sku.trim().toUpperCase());
  const seen = new Set<string>();
  const components = lines
    .filter(l => l.status === 'new' && l.newItem.sku.trim() && !inOdoo(l.newItem.sku))
    .filter(l => { const k = l.newItem.sku.trim().toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(l => ({
      sku: l.newItem.sku.trim(), name: l.newItem.name.trim(), category: l.newItem.category, tracked: l.newItem.tracked,
      uom: l.newItem.uom, purchaseUom: l.newItem.purchaseUom || null, cost: l.newItem.cost, hsn: l.newItem.hsn || null, route: 'Buy',
    }));
  return {
    hqProductId,
    company: f.company || null,
    code: f.code || null,
    finished: {
      sku: f.sku.trim(), name: f.name.trim(), category: f.category, tracked: f.tracked, uom: f.uom, purchaseUom: null,
      salePrice: f.salePrice, hsn: f.hsn || null, weightKg: f.weightKg, volumeM3: f.volumeM3, route: f.route || null,
    },
    components,
    lines: lines.filter(l => l.status !== 'skip').map(l => {
      const q = bomQty(l);
      return l.status === 'match' && l.match
        ? { productId: l.match.id, sku: l.match.sku || null, qty: q.qty, uom: q.uom }
        : { productId: null, sku: l.newItem.sku.trim(), qty: q.qty, uom: q.uom };
    }),
  };
}
