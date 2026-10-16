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
  hqSku?: string;          // the HQ product's own SKU, used to build the Odoo SKU from a prefix
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
  /** The product is already in Odoo: no product is created, the new BOM attaches to `existing`. */
  exists: boolean;
  existing: OdooProduct | null;
  /** Finished units one BOM makes (Odoo's BOM quantity); line quantities are multiplied by it. */
  bomUnits: number;
  /** HQ product photo, sent as the new Odoo product's image. */
  imageUrl: string | null;
  /** Value on Odoo's single global "variant" attribute (e.g. "Chestnut/Black"); blank = "Standard". */
  variant: string;
  /** Customer SKU, sent as the Odoo variant tag. */
  customerSku: string;
};

export const DEFAULT_COMPANY = 'Parable Ventures Private Limited';
export const FINISHED_CATEGORY = 'All / Saleable / Final Product';
const RAW_TRACKED = 'All / Expenses / Raw Materials AVCO Automatic';
const RAW_UNTRACKED = 'All / Expenses / Non-Inventory Raw Material AVCO';

type Defaults = { status: LineStatus; prefix: string; category: string; tracked: boolean; uom: string };

/** Starting values for a new component, by HQ cost category (read from how Odoo's existing products are set up). */
export const CATEGORY_DEFAULTS: Record<string, Defaults> = {
  // Raw pieces are made for one product; their SKU prefix is picked on the Send to Odoo page.
  'Raw Piece': { status: 'new', prefix: '', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Wood': { status: 'new', prefix: 'TMB', category: RAW_TRACKED, tracked: true, uom: 'cu ft' },
  'Finishing Materials': { status: 'new', prefix: 'CHM', category: RAW_TRACKED, tracked: true, uom: 'L' },
  'Inserts + Instructions': { status: 'new', prefix: 'PPR', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Handles + Knobs': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Handles/Latches': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Feet/Buffers': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Other Hardware': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Hardware': { status: 'new', prefix: 'HRD', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Accessories': { status: 'new', prefix: 'ACC', category: RAW_UNTRACKED, tracked: false, uom: 'Units' },
  'Packaging': { status: 'new', prefix: 'PMC', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Components': { status: 'new', prefix: '', category: RAW_TRACKED, tracked: true, uom: 'Units' },
  'Other': { status: 'new', prefix: '', category: RAW_UNTRACKED, tracked: false, uom: 'Units' },
  'Subcontracting': { status: 'skip', prefix: 'SUB', category: 'All / Expenses / Subcontracting Services (AVCO)', tracked: false, uom: 'Units' },
  'Outsourced Product': { status: 'skip', prefix: '', category: RAW_TRACKED, tracked: true, uom: 'Units' },
};
/**
 * Category and tracking per SKU prefix, as Caleb's live Odoo products use them. Typing a prefix on a
 * new item picks these; the row stays editable because a few items are exceptions.
 */
export const PREFIX_RULES: Record<string, { category: string; tracked: boolean }> = {
  ...Object.fromEntries(['PIC', 'PMC', 'CHM', 'TMB', 'MDF', 'HRD', 'PLY', 'CTY', 'THR', 'TTW'].map(p => [p, { category: RAW_TRACKED, tracked: true }])),
  ...Object.fromEntries(['SCR', 'BLT', 'LBL', 'ACC', 'FCR', 'PKS'].map(p => [p, { category: RAW_UNTRACKED, tracked: false }])),
  SUB: { category: 'All / Expenses / Subcontracting Services (AVCO)', tracked: false },
  INH: { category: 'All / Expenses / In-House Per Piece Work', tracked: false },
  ADH: { category: 'Glue and Adhesives (Standard Cost)', tracked: false },
  SND: { category: 'All / Expenses / Sandpaper (Standard Cost)', tracked: false },
  TAP: { category: 'Tape and Wrapping (Standard Cost)', tracked: false },
  CON: { category: 'All / Expenses / Consumable Chemicals', tracked: false },
};

/** Track Inventory that goes with an Odoo category: only Raw Materials AVCO Automatic and Final Product are tracked. */
export function trackedForCategory(category: string): boolean | null {
  const c = (category || '').trim().toLowerCase();
  if (!c) return null;
  if (c === RAW_TRACKED.toLowerCase() || c === FINISHED_CATEGORY.toLowerCase()) return true;
  return Object.values(PREFIX_RULES).some(r => r.category.toLowerCase() === c) ? false : null;
}

/** The leading SKU prefix ("PIC-AT2817" → PIC), or ''. */
export const skuPrefix = (sku: string) => /^([A-Za-z0-9]{2,6})-/.exec((sku || '').trim())?.[1].toUpperCase() ?? '';

/**
 * Applies an edit to a new item and keeps it consistent: a new SKU prefix picks its category and
 * tracking, a new category picks its tracking. A tracking tick is always taken as given.
 */
export function editNewItem(item: NewItem, patch: Partial<NewItem>): NewItem {
  const next = { ...item, ...patch };
  if (patch.sku !== undefined && patch.category === undefined && patch.tracked === undefined) {
    const p = skuPrefix(patch.sku);
    const rule = p && p !== skuPrefix(item.sku) ? PREFIX_RULES[p] : undefined;
    if (rule) return { ...next, category: rule.category, tracked: rule.tracked };
  }
  if (patch.category !== undefined && patch.tracked === undefined) {
    const t = trackedForCategory(patch.category);
    if (t != null) next.tracked = t;
  }
  return next;
}

/** Name-based SKU prefix for lines whose cost category covers several kinds of Odoo item. */
function prefixByName(cogsType: string, name: string): string | null {
  const n = name.toLowerCase();
  if (cogsType === 'Packaging') {
    if (/foam\s*corner/.test(n)) return 'FCR';
    if (/\btape\b|stretch|wrap/.test(n)) return 'TAP';
    if (/label|sticker/.test(n)) return 'LBL';
    if (/inner|\bic\b|\bpic\b/.test(n)) return 'PIC';
    if (/master|\bmc\b|\bpmc\b|carton|box/.test(n)) return 'PMC';
    return 'PKS';
  }
  if (/fevicol|glue|adhesive/.test(n)) return 'ADH';
  if (/sand\s*paper|emery/.test(n)) return 'SND';
  if (/thinner|cleaning oil/.test(n)) return 'CON';
  if (/screw/.test(n)) return 'SCR';
  return null;
}

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
/** units = finished units per BOM: the per-unit quantity is multiplied by it. qtyOverride is per unit. */
export function bomQty(l: DraftLine, units = 1): { qty: number; uom: string; ok: boolean } {
  const uom = l.status === 'match' ? (l.match?.uom || '') : l.newItem.uom;
  const n = units > 0 ? units : 1;
  if (l.qtyOverride != null) return { qty: round(l.qtyOverride * n), uom, ok: true };
  const c = convertQty(l.hqQty, l.hqUnit, uom);
  return { ...c, qty: round(c.qty * n), uom };
}

/** The cogs_items fields a draft line reads (the engine's resolved rows carry them all). */
export type CogsRow = {
  id: string; include?: string | null; cogs_type?: string | null; component_name?: string | null;
  components_per_product?: number | null; waste_factor?: number | null; unit_cost_inr?: number | null;
  units?: string | null; vendor_name?: string | null; sort_order?: number | null;
};

/** Cost categories whose items belong to one product only: never shared or pre-matched across products. */
export const PRODUCT_SPECIFIC = ['Raw Piece'];

/**
 * One draft line per included costing row with a quantity; links pre-match lines seen before.
 * With productId, product-specific items (raw pieces) get a key of their own per product.
 */
export function buildDraftLines(rows: CogsRow[], links: Map<string, OdooProduct>, productId?: string): DraftLine[] {
  return rows
    .filter(r => r.include !== 'No' && lineQty(r) > 0 && (r.component_name || '').trim())
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(r => {
      const cogsType = r.cogs_type || 'Other';
      const hqName = String(r.component_name).trim();
      const base = defaultsFor(cogsType);
      const byName = prefixByName(cogsType, hqName);
      const d = byName ? { ...base, prefix: byName, ...PREFIX_RULES[byName] } : base;
      const key = productId && PRODUCT_SPECIFIC.includes(cogsType) ? `${linkKey(cogsType, hqName)}|${productId}` : linkKey(cogsType, hqName);
      const linked = links.get(key) ?? null;
      const hqQty = lineQty(r);
      const hqUnit = String(r.units || '').trim();
      const never = NEVER_BOM.includes(hqName.toLowerCase());
      // Cost per Odoo unit for a new item = HQ cost per HQ unit, converted.
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
          sku: '',
          category: d.category,
          tracked: d.tracked,
          uom: hqUnit && unitInfo(hqUnit) ? canonicalUnit(hqUnit, d.uom) : d.uom,
          purchaseUom: '',
          cost: null, // Odoo costs new raw materials itself from purchase orders
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

export function defaultFinished(product: { name?: string | null; sku?: string | null; weight_kg?: number | null; photo_url?: string | null } | null | undefined, extra: { volumeM3?: number | null } = {}): FinishedDraft {
  const hqSku = (product?.sku || '').trim();
  const name = (product?.name || '').trim();
  // The HQ SKU is the customer's; the Odoo SKU is PREFIX-BASE-SUFFIX, with a suggested 4-character base.
  const base = itemCode(hqSku, name).slice(0, 4);
  return {
    name,
    hqSku,
    sku: base ? `-${base}-` : '',
    code: '',
    category: FINISHED_CATEGORY,
    tracked: true,
    uom: 'Units',
    salePrice: null,
    hsn: '',
    weightKg: Number(product?.weight_kg) > 0 ? Number(product.weight_kg) : null,
    volumeM3: extra.volumeM3 && extra.volumeM3 > 0 ? round(extra.volumeM3, 4) : null,
    route: '',
    company: DEFAULT_COMPANY,
    exists: false,
    existing: null,
    bomUnits: 1,
    imageUrl: (product?.photo_url || '').trim() || null,
    variant: '',
    customerSku: hqSku,
  };
}

export const displayName = (sku: string, name: string) => (sku ? `[${sku.trim()}] ${name.trim()}` : name.trim());

// ---------- Checks ----------

export type Issue = { level: 'error' | 'warn'; where: string; msg: string };

/** existing: SKUs (upper-cased) that already exist in Odoo, from the live lookup. */
export function checkDraft(f: FinishedDraft, lines: DraftLine[], existing: Set<string> | null): Issue[] {
  const out: Issue[] = [];
  const has = (sku: string) => !!existing && existing.has(sku.trim().toUpperCase());
  if (f.exists) {
    if (!f.existing) out.push({ level: 'error', where: 'Finished product', msg: 'Pick the Odoo product the BOM is for.' });
  } else {
    if (!f.name.trim()) out.push({ level: 'error', where: 'Finished product', msg: 'Name is missing.' });
    if (!isFullSku(f.sku)) out.push({ level: 'error', where: 'Finished product', msg: 'SKU needs a prefix, a base and a suffix (e.g. CCT-WSS2016-CHST).' });
    else if (has(f.sku)) out.push({ level: 'error', where: 'Finished product', msg: `${f.sku} is already in Odoo. Tick "Already in Odoo" and pick it instead.` });
    if (!f.category.trim()) out.push({ level: 'error', where: 'Finished product', msg: 'Category is missing.' });
  }
  if (!(f.bomUnits > 0)) out.push({ level: 'error', where: 'BOM', msg: 'Units per BOM must be more than 0.' });

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
    if (!sku || /-$/.test(sku)) out.push({ level: 'error', where, msg: 'Type the new item\'s SKU, or pick an existing Odoo product.' });
    else if ((skus.get(sku.toUpperCase()) ?? 0) > 1) out.push({ level: 'error', where, msg: `SKU ${sku} is used on more than one line.` });
    else if (has(sku)) out.push({ level: 'error', where, msg: `SKU ${sku} already exists in Odoo. Match it instead of creating it.` });
    if (sku && !f.exists && f.sku.trim() && sku.toUpperCase() === f.sku.trim().toUpperCase()) out.push({ level: 'error', where, msg: 'SKU is the same as the finished product.' });
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
    'list_price', 'l10n_in_hsn_code', 'weight', 'volume'];
  const rows: (string | number | null)[][] = [header];
  const inOdoo = (sku: string) => !!existing && existing.has(sku.trim().toUpperCase());
  if (!f.exists && f.sku.trim() && !inOdoo(f.sku)) {
    rows.push([f.name.trim(), f.sku.trim(), 'Goods', tf(f.tracked), f.category, f.uom, f.uom, 'True', 'False',
      f.salePrice, f.hsn || null, f.weightKg, f.volumeM3]);
  }
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.status !== 'new') continue;
    const n = l.newItem;
    const sku = n.sku.trim();
    if (!sku || seen.has(sku.toUpperCase()) || inOdoo(sku)) continue;
    seen.add(sku.toUpperCase());
    rows.push([n.name.trim(), sku, 'Goods', tf(n.tracked), n.category, n.uom, n.purchaseUom || n.uom, 'False', 'True',
      null, n.hsn || null, null, null]);
  }
  return rows;
}

/** mrp.bom import rows in the layout of Odoo's own BOM export: header fields on the first row only. */
export function bomSheet(f: FinishedDraft, lines: DraftLine[]): (string | number | null)[][] {
  const header = ['product_tmpl_id', 'code', 'type', 'product_qty',
    'bom_line_ids/product_id', 'bom_line_ids/product_qty', 'bom_line_ids/product_uom_id'];
  const rows: (string | number | null)[][] = [header];
  const live = lines.filter(l => l.status !== 'skip');
  live.forEach((l, i) => {
    const comp = l.status === 'match' && l.match ? l.match.display_name || displayName(l.match.sku, l.match.name) : displayName(l.newItem.sku, l.newItem.name);
    const q = bomQty(l, f.bomUnits);
    const head = i === 0
      ? [finishedRef(f), f.code || null, 'Manufacture this product', f.bomUnits > 0 ? f.bomUnits : 1]
      : [null, null, null, null];
    rows.push([...head, comp, q.qty, q.uom || null]);
  });
  return rows;
}

/** How the BOM file names the finished product: the picked Odoo product, or the new one. */
const finishedRef = (f: FinishedDraft) =>
  f.exists && f.existing ? (f.existing.display_name || displayName(f.existing.sku, f.existing.name)) : displayName(f.sku, f.name);

export const fileStem = (f: FinishedDraft) => ((f.exists ? f.existing?.sku : '') || f.sku.trim() || f.name.trim() || 'product').replace(/[^A-Za-z0-9._-]+/g, '-');

// ---------- Direct send (odoo-bom-push) ----------

export type PushMode = 'full' | 'product' | 'components';
export type PushPayload = {
  mode: PushMode;
  hqProductId: string | null;
  code: string | null;
  bomUnits: number;
  existingProductId: number | null;
  existingSku: string | null;
  imageUrl: string | null;
  finished: Record<string, unknown> | null;
  components: Record<string, unknown>[];
  lines: { productId: number | null; sku: string | null; qty: number; uom: string }[];
};

/** What the odoo-bom-push function receives: the same draft the files are made from. */
export function pushPayload(hqProductId: string | null, f: FinishedDraft, lines: DraftLine[], existing: Set<string> | null, mode: PushMode = 'full'): PushPayload {
  const inOdoo = (sku: string) => !!existing && existing.has(sku.trim().toUpperCase());
  const seen = new Set<string>();
  const components = lines
    .filter(l => l.status === 'new' && l.newItem.sku.trim() && !inOdoo(l.newItem.sku))
    .filter(l => { const k = l.newItem.sku.trim().toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(l => ({
      sku: l.newItem.sku.trim(), name: l.newItem.name.trim(), category: l.newItem.category, tracked: l.newItem.tracked,
      uom: l.newItem.uom, purchaseUom: l.newItem.purchaseUom || null, hsn: l.newItem.hsn || null,
    }));
  const units = f.bomUnits > 0 ? f.bomUnits : 1;
  return {
    mode,
    hqProductId,
    code: f.code || null,
    bomUnits: units,
    existingProductId: f.exists ? f.existing?.id ?? null : null,
    existingSku: f.exists ? f.existing?.sku || null : null,
    imageUrl: f.exists ? null : f.imageUrl,
    finished: f.exists ? null : {
      sku: f.sku.trim(), name: f.name.trim(), category: f.category, tracked: f.tracked, uom: f.uom, purchaseUom: null,
      salePrice: f.salePrice, hsn: f.hsn || null, weightKg: f.weightKg, volumeM3: f.volumeM3,
      variant: f.variant?.trim() || null, customerSku: f.customerSku?.trim() || null,
    },
    components,
    lines: lines.filter(l => l.status !== 'skip').map(l => {
      const q = bomQty(l, units);
      return l.status === 'match' && l.match
        ? { productId: l.match.id, sku: l.match.sku || null, qty: q.qty, uom: q.uom }
        : { productId: null, sku: l.newItem.sku.trim(), qty: q.qty, uom: q.uom };
    }),
  };
}

// ---------- Several products at once (inquiry → Send to Odoo) ----------

/** One decision per HQ item (link key), shared by every product that uses it. */
export type SharedItem = Pick<DraftLine, 'status' | 'match' | 'newItem'>;
export type ProductDraft = { productId: string; finished: FinishedDraft; lines: DraftLine[] };

/** First occurrence of each HQ item across the products, in order: the row the shared table shows. */
export function sharedItems(drafts: ProductDraft[]): { key: string; first: DraftLine; usedIn: number }[] {
  const out = new Map<string, { key: string; first: DraftLine; usedIn: number }>();
  for (const d of drafts) {
    for (const key of new Set(d.lines.map(l => l.key))) {
      const first = d.lines.find(l => l.key === key)!;
      const hit = out.get(key);
      if (hit) hit.usedIn += 1;
      else out.set(key, { key, first, usedIn: 1 });
    }
  }
  return [...out.values()];
}

/** A product's lines with the shared decisions applied; quantities stay the product's own. */
export function applyShared(lines: DraftLine[], shared: Map<string, SharedItem>): DraftLine[] {
  return lines.map(l => {
    const s = shared.get(l.key);
    return s ? { ...l, status: s.status, match: s.match, newItem: s.newItem, qtyOverride: null } : l;
  });
}

/** Checks across products: one SKU used for two different items, or for two finished products. */
export function checkAcross(drafts: ProductDraft[]): Issue[] {
  const out: Issue[] = [];
  const bySku = new Map<string, Set<string>>();
  const note = (sku: string, who: string) => {
    const k = sku.trim().toUpperCase();
    if (!k || /-$/.test(k)) return;
    if (!bySku.has(k)) bySku.set(k, new Set());
    bySku.get(k)!.add(who);
  };
  for (const d of drafts) {
    note(d.finished.sku, `product:${d.productId}`);
    for (const l of d.lines) if (l.status === 'new') note(l.newItem.sku, `item:${l.key}`);
  }
  for (const [sku, who] of bySku) {
    if (who.size > 1) out.push({ level: 'error', where: sku, msg: `SKU ${sku} is used for ${who.size} different products or items.` });
  }
  return out;
}

/** One products file for several products: header once, each SKU once. */
export function combinedProductsSheet(drafts: ProductDraft[], existing: Set<string> | null): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    const s = productsSheet(d.finished, d.lines, existing);
    if (!rows.length) rows.push(s[0]);
    for (const r of s.slice(1)) {
      const sku = String(r[1] ?? '').toUpperCase();
      if (seen.has(sku)) continue;
      seen.add(sku);
      rows.push(r);
    }
  }
  return rows;
}

/** One BOM file for several products: each BOM's header fields sit on its first line, as in Odoo's export. */
export function combinedBomSheet(drafts: ProductDraft[]): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  for (const d of drafts) {
    const s = bomSheet(d.finished, d.lines);
    if (!rows.length) rows.push(s[0]);
    rows.push(...s.slice(1));
  }
  return rows;
}

// ---------- SKU prefixes ----------

const alnum = (s: string) => (s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');

/** The item part of a SKU: the HQ SKU without separators (AT-3335 → AT3335), else the initials of the name. */
export function itemCode(hqSku: string | null | undefined, name: string): string {
  const fromSku = alnum(hqSku || '');
  if (fromSku) return fromSku;
  const words = (name || '').split(/[^A-Za-z0-9]+/).filter(w => w && !/^(of|and|the|with|for|set)$/i.test(w));
  return words.slice(0, 4).map(w => (/^\d+$/.test(w) ? w : w[0])).join('').toUpperCase();
}

/** Finished product SKU from a prefix: PREFIX-ITEMCODE (kept as is when the HQ SKU already starts with the prefix). */
export function finishedSkuFor(prefix: string, hqSku: string | null | undefined, name: string): string {
  const p = alnum(prefix);
  if (!p) return (hqSku || '').trim();
  const own = (hqSku || '').trim().toUpperCase();
  if (own.startsWith(`${p}-`)) return own;
  const code = itemCode(hqSku, name);
  return code ? `${p}-${code}` : `${p}-`;
}

/** Raw piece SKU: PREFIX + the finished SKU's item part (CCT-AT3335 → RAW-AT3335); -2, -3 for further raw pieces. */
export function rawPieceSkuFor(prefix: string, finishedSku: string, n = 1): string {
  const p = alnum(prefix);
  if (!p) return '';
  const rest = finishedSku.trim().toUpperCase().split('-').slice(1).join('-');
  const base = rest ? `${p}-${rest}` : `${p}-`;
  return n > 1 && rest ? `${base}-${n}` : base;
}

/** A SKU nobody has typed yet: empty, unfinished ("TMB-"), or one made from the previous prefix. */
export function isFillableSku(sku: string, prevPrefix?: string | null): boolean {
  const s = (sku || '').trim().toUpperCase();
  if (!s || s.endsWith('-')) return true;
  const p = alnum(prevPrefix || '');
  return !!p && s.startsWith(`${p}-`);
}

export type Prefixes = { product: string; raw: string };

/**
 * Fills the finished SKU and the raw piece SKUs from the prefixes, leaving any SKU someone typed
 * (anything not empty, unfinished or made from the previous prefixes) as it is.
 */
export function applyPrefixes(f: FinishedDraft, lines: DraftLine[], next: Prefixes, prev: Prefixes | null): { finished: FinishedDraft; lines: DraftLine[] } {
  let finished = f;
  const parts = splitSku(f.sku);
  const p = alnum(next.product);
  if (p && (!parts.prefix || parts.prefix.toUpperCase() === alnum(prev?.product || ''))) {
    const sku = joinSku({ ...parts, prefix: p, base: parts.base || itemCode(f.hqSku, f.name).slice(0, 4) });
    finished = { ...f, sku };
  }
  let n = 0;
  const out = lines.map(l => {
    if (!PRODUCT_SPECIFIC.includes(l.cogsType) || l.status !== 'new') return l;
    n += 1;
    if (!next.raw.trim()) return l;
    const wasFromPrev = prev && (isFillableSku(l.newItem.sku, prev.raw) || l.newItem.sku === rawPieceSkuFor(prev.raw, f.sku, n));
    if (!isFillableSku(l.newItem.sku) && !wasFromPrev) return l;
    return { ...l, newItem: { ...l.newItem, sku: rawPieceSkuFor(next.raw, finished.sku, n) } };
  });
  return { finished, lines: out };
}

const LAST_PREFIXES = 'odoo-sku-prefixes';
/** The prefixes used last (per browser), so the raw piece prefix carries over to the next product. */
export function readLastPrefixes(): Prefixes {
  try { const v = JSON.parse(localStorage.getItem(LAST_PREFIXES) || 'null'); return { product: v?.product || '', raw: v?.raw || '' }; } catch { return { product: '', raw: '' }; }
}
export function writeLastPrefixes(p: Prefixes) {
  try { localStorage.setItem(LAST_PREFIXES, JSON.stringify(p)); } catch { /* per-browser convenience only */ }
}

// ---------- Finished SKU: PREFIX-BASE-SUFFIX ----------

export type SkuParts = { prefix: string; base: string; suffix: string };

/** Splits at the first two dashes; the suffix keeps any further characters (CHST_SMALL). */
export function splitSku(sku: string): SkuParts {
  const [prefix = '', base = '', ...rest] = (sku || '').split('-');
  return { prefix, base, suffix: rest.join('-') };
}
export const joinSku = (p: SkuParts) => `${p.prefix}-${p.base}-${p.suffix}`;

/** A finished SKU needs all three parts: CCT-WSS2016-CHST, CCT-WSS2016-CHST_SMALL. */
export function isFullSku(sku: string): boolean {
  return /^[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9_]+$/.test((sku || '').trim());
}

// ---------- Cartons (PIC / PMC) ----------

export type CartonSize = { w: number; d: number; h: number } | null;

/**
 * Suggested name and SKU for a new inner (PIC) or master (PMC) carton, from its estimated outside size:
 * "Inner Carton for Tray / 103 x 41 x 13 inch / 5 ply", PIC-<base>-10341 (first two sides, decimals dropped).
 * A missing size or ply is left out, and the SKU stays blank without a size or base.
 */
export function cartonItem(kind: 'PIC' | 'PMC', productName: string, base: string, size: CartonSize, ply: string | null): { name: string; sku: string } {
  const label = kind === 'PIC' ? 'Inner Carton' : 'Master Carton';
  const ok = !!size && size.w > 0 && size.d > 0 && size.h > 0;
  const t = (n: number) => String(Math.trunc(n));
  const parts = [`${label} for ${productName.trim()}`];
  if (ok) parts.push(`${t(size!.w)} x ${t(size!.d)} x ${t(size!.h)} inch`);
  if (ply && ply.trim()) parts.push(ply.trim());
  const b = (base || '').trim().toUpperCase();
  return { name: parts.join(' / '), sku: ok && b ? `${kind}-${b}-${t(size!.w)}${t(size!.d)}` : '' };
}

/** Which carton a costing line is, by name (IC Box → PIC, MC Box → PMC), or null. */
export function cartonKind(cogsType: string, name: string): 'PIC' | 'PMC' | null {
  if (cogsType !== 'Packaging') return null;
  const p = prefixByName(cogsType, name);
  return p === 'PIC' || p === 'PMC' ? p : null;
}

// ---------- Final products only (inquiry → Send to Odoo) ----------

/** Problems that stop a finished product from being created on its own (no BOM yet). */
export function checkFinishedOnly(f: FinishedDraft, existing: Set<string> | null): Issue[] {
  const out: Issue[] = [];
  if (!f.name.trim()) out.push({ level: 'error', where: 'Product', msg: 'Name is missing.' });
  if (!isFullSku(f.sku)) out.push({ level: 'error', where: 'Product', msg: 'SKU needs a prefix, a base and a suffix (e.g. CCT-WSS2016-CHST).' });
  else if (existing?.has(f.sku.trim().toUpperCase())) out.push({ level: 'error', where: 'Product', msg: `${f.sku} is already in Odoo.` });
  if (!f.category.trim()) out.push({ level: 'error', where: 'Product', msg: 'Category is missing.' });
  return out;
}

export const DKT_VENDOR = 'Parable Ventures Pvt Ltd';
export const DKT_CATEGORY = 'Goods / Goods AVCO Dropship';

/** The DKT-side Odoo import (no API there): name (customer SKU), vendor, category, type. */
export function dktProductsSheet(rows: { name: string; customerSku?: string | null }[]): string[][] {
  return [
    ['Name', 'Vendor', 'Product Category', 'Product Type'],
    ...rows.map(r => {
      const c = (r.customerSku || '').trim();
      return [c ? `${r.name.trim()} (${c})` : r.name.trim(), DKT_VENDOR, DKT_CATEGORY, 'Goods'];
    }),
  ];
}
