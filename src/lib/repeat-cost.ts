// Repeat product cost check: compares a product's PDHQ costing with what a past Odoo
// manufacturing order of the same product actually cost (odoo-repeat-cost function),
// shows where they differ most, and builds the edits that line PDHQ up with the past.
//
// Odoo side: component quantities and values as consumed on the MO, hours per work order.
// Hours are costed at today's PDHQ labour rates and indirect overhead, so the two sides
// differ only where the product itself was made differently. Odoo's production cost has
// no shipping, so PDHQ's shipping is carried on both sides.
//
// Nothing from Odoo is stored except the link (products.repeat_odoo) and the operation →
// labour type mapping (global_settings.odoo_operation_labor_map).
import { supabase } from '@/integrations/supabase/client';
import * as calc from '@/lib/calculations';
import { mergeSettingsWithInquiry } from '@/lib/inquiry-overrides';
import { withLiveDirectRates } from '@/lib/live-rates';
import { LABOR_COLS } from '@/lib/costing-intake';
import {
  BUCKETS, addCogsLine, chain, isDomesticFreight, lineValue, patchCogsLine,
  type Bundle, type Mutation, type WorkspaceRow,
} from '@/lib/costing-workspace';

const db = supabase as any;

// ---------- Odoo data (odoo-repeat-cost) ----------

export type OdooSaleLine = {
  sale_line_id: number; order: string; customer: string; product_id: number; sku: string; name: string;
  quantity: number; price_unit: number; currency: string; date: string | null; state: string;
};
export type OdooComponent = {
  odoo_product_id: number; sku: string; name: string; category: string; uom: string;
  planned: number; used: number; value: number;
};
export type OdooLabour = { operation: string; hours: number; expected_hours: number; cost: number };
export type OdooMo = { id: number; name: string; origin: string; planned: number; produced: number; date: string | null; linked: boolean };
export type OdooPastCost = {
  product: { id: number; sku: string; name: string; standard_price: number };
  sale: { sale_line_id: number; order: string; customer: string; quantity: number; price_unit: number; currency: string; odoo_cost_unit: number } | null;
  mos: OdooMo[];
  mo: (OdooMo & { finished_value: number; value_estimated: boolean }) | null;
  components: OdooComponent[];
  labour: OdooLabour[];
};

/** What the product keeps: which Odoo product (and sales order line / MO) it repeats. */
export type RepeatLink = { odoo_product_id: number; sale_line_id: number | null; mo_id: number | null; label: string };

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('odoo-repeat-cost', { body });
  const res = data as (T & { error?: unknown }) | null;
  if (error) {
    let msg = error?.message || 'Odoo request failed';
    try { msg = (await (error as { context?: Response }).context?.json())?.error || msg; } catch { /* keep generic */ }
    throw new Error(/Failed to send|FunctionsFetchError|not found/i.test(msg)
      ? 'The Odoo cost check is not available yet (the odoo-repeat-cost function has not been deployed).'
      : msg);
  }
  if (res?.error) throw new Error(String(res.error));
  return res as T;
}

export const searchOdooSaleProducts = (search: string) =>
  invoke<{ lines: OdooSaleLine[] }>({ action: 'search', search: search.trim() || null, limit: 25 }).then(r => r.lines ?? []);
export const loadOdooOperations = () => invoke<{ operations: string[] }>({ action: 'operations' }).then(r => r.operations ?? []);
export const loadOdooPastCost = (link: RepeatLink, moId?: number | null) =>
  invoke<OdooPastCost>({ action: 'cost', product_id: link.odoo_product_id, sale_line_id: link.sale_line_id, mo_id: moId ?? link.mo_id ?? null });

export const saleLineLabel = (l: OdooSaleLine) => [l.order, l.sku || l.name, l.customer].filter(Boolean).join(' · ');

export async function saveRepeatLink(productId: string, link: RepeatLink | null) {
  const { error } = await db.from('products').update({ repeat_odoo: link }).eq('id', productId);
  if (error) throw new Error(error.message);
}

// ---------- Operation → labour type ----------

export const LABOR_TYPES = LABOR_COLS.map(c => c.laborType);
export const SKIP_OPERATION = 'skip';
export type OperationMap = Record<string, string>;

/**
 * Auto-mapping by the operation's wording, used until an operation is set in Settings.
 * Odoo has a few hundred product-specific names ("Finish KK", "Package Bean Vial"…); the
 * verb tells the type. First match wins, so the order matters (Caleb, 2026-10-21):
 * laser work is a subcontracting COGS line, not labour, and General Work Order stays out;
 * "Assemble & Pack" is packing; rework counts as finishing for now.
 */
export const OPERATION_RULES: [RegExp, string][] = [
  [/\blaser\b/i, SKIP_OPERATION],
  [/^general work order$/i, SKIP_OPERATION],
  [/^assemble\s*(&|and)\s*pack|^assembly\s*(&|and)\s*pack/i, 'Packaging'],
  [/\brework\b/i, 'Finishing'],
  [/\bmarket\b/i, 'Market'],
  [/\b(finish|finishing|sand|sanding|spray|char|powder\s*coat)\b/i, 'Finishing'],
  [/^(assemble|assembly)\b/i, 'Assembly'],
  [/^(pack|package|packaging)\b/i, 'Packaging'],
  [/^qc\b/i, 'QC'],
  [/\b(manufacture|manufacturing|make|cut|cnc|drill|lathe|bend|carve)\b/i, 'Manufacturing'],
];

/** What the rules make of an operation: a labour type, SKIP_OPERATION, or null when no rule matches. */
export function autoLaborType(operation: string): string | null {
  const name = operation.trim();
  if (LABOR_TYPES.includes(name)) return name;
  return OPERATION_RULES.find(([re]) => re.test(name))?.[1] ?? null;
}

/** The PDHQ labour type an Odoo operation's hours count as, or null (left out, or nothing matches). */
export function laborTypeFor(operation: string, map: OperationMap | null | undefined): string | null {
  const v = map?.[operation] ?? autoLaborType(operation);
  return v && v !== SKIP_OPERATION ? v : null;
}
/** False only when neither Settings nor a rule says what an operation is (flagged on the Past cost tab). */
export const isOperationMapped = (operation: string, map: OperationMap | null | undefined) =>
  (map?.[operation] ?? autoLaborType(operation)) != null;

export async function loadOperationMap(): Promise<OperationMap> {
  const { data, error } = await db.from('global_settings').select('id, odoo_operation_labor_map').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.odoo_operation_labor_map as OperationMap) || {};
}
export async function saveOperationMap(map: OperationMap) {
  const { data, error } = await db.from('global_settings').select('id').limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error('No global settings row');
  const res = await db.from('global_settings').update({ odoo_operation_labor_map: map }).eq('id', data.id);
  if (res.error) throw new Error(res.error.message);
}

// ---------- Odoo component → PDHQ COGS category ----------

const PREFIX_TYPES: [string[], string][] = [
  [['RAW', 'RWP'], 'Raw Piece'],
  [['TMB', 'WOD', 'PLY', 'MDF'], 'Wood'],
  [['CHM', 'RMS', 'SND', 'PNT', 'WAX'], 'Finishing Materials'],
  [['SUB'], 'Subcontracting'],
  [['LCH'], 'Handles/Latches'],
  [['HDL', 'KNB'], 'Handles + Knobs'],
  [['FET', 'BUF'], 'Feet/Buffers'],
  [['HNG', 'SCR', 'HRD', 'NAL', 'MAG'], 'Other Hardware'],
  [['PPR', 'INS'], 'Inserts + Instructions'],
  [['PIC', 'PMC', 'EPE', 'LBL', 'PKS', 'PKG', 'TAP'], 'Packaging'],
];

/** "OLD EPE-PF02-ALLS" → "EPE": the SKU prefix, ignoring Odoo's OLD marker for retired items. */
export const skuPrefix = (sku: string) => (sku || '').replace(/^OLD\s+/i, '').split('-')[0].trim().toUpperCase();

/** PDHQ COGS category for an Odoo component: SKU prefix first, then the Odoo product category. */
export function cogsTypeForOdoo(c: Pick<OdooComponent, 'sku' | 'category' | 'name'>): string {
  const pre = skuPrefix(c.sku);
  const hit = PREFIX_TYPES.find(([ps]) => ps.includes(pre));
  if (hit) return hit[1];
  const cat = `${c.category} ${c.name}`.toLowerCase();
  if (/raw piece/.test(cat)) return 'Raw Piece';
  if (/pack|carton|label|tape/.test(cat)) return 'Packaging';
  if (/subcontract/.test(cat)) return 'Subcontracting';
  if (/chemical|lacquer|sealer|colou?r|sandpaper/.test(cat)) return 'Finishing Materials';
  if (/timber|wood/.test(cat)) return 'Wood';
  if (/hardware|hinge|screw/.test(cat)) return 'Other Hardware';
  return 'Other';
}

export const bucketOf = (cogsType: string) =>
  BUCKETS.find(b => (b.types as readonly string[]).includes(cogsType)) ?? BUCKETS.find(b => b.key === 'other')!;

// ---------- Matching Odoo components to PDHQ COGS lines ----------

/** Where an Odoo component goes when applied: an existing PDHQ line, a new line, or nowhere. */
export type Target = string | 'new' | 'skip';

const words = (s: string) => new Set((s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !/^\d+$/.test(w)));
const isInner = (s: string) => /inner carton|\bic box\b|^ic$/.test(s);
const isMaster = (s: string) => /master carton|\bmc box\b|outer carton/.test(s);
const isCartonLabel = (s: string) => isInner(s) || isMaster(s);

/** How alike an Odoo component and a PDHQ line look (0 = not at all). */
export function matchScore(c: OdooComponent, line: any, lineLabel: string): number {
  if (bucketOf(cogsTypeForOdoo(c)).key !== bucketOf(line.cogs_type).key) return 0;
  const pre = skuPrefix(c.sku);
  const lbl = lineLabel.toLowerCase();
  if ((pre === 'PIC' || isInner(c.name.toLowerCase())) && isInner(lbl)) return 10;
  if ((pre === 'PMC' || isMaster(c.name.toLowerCase())) && isMaster(lbl)) return 10;
  const a = words(`${c.name} ${c.sku}`);
  let n = 0;
  for (const w of words(lbl)) if (a.has(w)) n++;
  return n;
}

/** PDHQ lines a past cost can line up against: the product's lines, without domestic freight (a shipping cost). */
export const comparableLines = (b: Bundle, productId: string) =>
  b.cogs.filter(c => c.product_id === productId && !isDomesticFreight(c));

/** A PDHQ line's name as shown, with the linked chemical's name for finishing rows. */
export function lineLabel(b: Bundle, line: any): string {
  const chem = line.chemical_price_id ? b.chemicalPrices.find((x: any) => x.id === line.chemical_price_id) : null;
  return [line.component_name, chem?.name, line.vendor_name].filter(Boolean).join(' · ');
}

/**
 * Suggested target for every Odoo component: the best-scoring PDHQ line in the same cost
 * group, each line used once (highest scores first); a group with one Odoo component and one
 * PDHQ line pairs them even without shared words. Everything else becomes a new line.
 */
export function suggestTargets(b: Bundle, productId: string, comps: OdooComponent[]): Record<number, Target> {
  const lines = comparableLines(b, productId).filter(l => l.include !== 'No');
  const pairs: { pid: number; lid: string; s: number }[] = [];
  for (const c of comps) for (const l of lines) {
    const s = matchScore(c, l, lineLabel(b, l));
    if (s > 0) pairs.push({ pid: c.odoo_product_id, lid: l.id, s });
  }
  pairs.sort((x, y) => y.s - x.s);
  const out: Record<number, Target> = {};
  const usedLines = new Set<string>();
  for (const p of pairs) {
    if (out[p.pid] || usedLines.has(p.lid)) continue;
    out[p.pid] = p.lid; usedLines.add(p.lid);
  }
  // Lone pairs within a cost category.
  for (const c of comps) {
    if (out[c.odoo_product_id]) continue;
    const t = cogsTypeForOdoo(c);
    const sameComps = comps.filter(x => cogsTypeForOdoo(x) === t && !out[x.odoo_product_id]);
    // Carton lines are only ever paired with cartons (above), never with whatever packaging is left over.
    const sameLines = lines.filter(l => l.cogs_type === t && !usedLines.has(l.id) && !isCartonLabel(lineLabel(b, l).toLowerCase()));
    if (sameComps.length === 1 && sameLines.length === 1) { out[c.odoo_product_id] = sameLines[0].id; usedLines.add(sameLines[0].id); }
  }
  for (const c of comps) if (!out[c.odoo_product_id]) out[c.odoo_product_id] = 'new';
  return out;
}

// ---------- Comparison ----------

export type CogsPair = {
  key: string;
  bucket: string;
  /** The PDHQ line (null when the Odoo component would be added as a new line). */
  line: any | null;
  label: string;
  comps: OdooComponent[];
  pdhq: number;   // ₹/unit
  odoo: number;   // ₹/unit
  skipped: boolean;
};
export type LabourPair = {
  laborType: string; operations: string[]; rate: number;
  pdhqHours: number; odooHours: number; pdhq: number; odoo: number;
  /** Booked by Odoo for these hours (Odoo's own employee rates), per unit. */
  odooBooked: number;
  rowId: string | null;
};
export type Step = { label: string; pdhq: number; odoo: number };
export type Variance = { label: string; step: string; diff: number; note: string };

export type Comparison = {
  produced: number;
  cogs: { bucket: string; label: string; pairs: CogsPair[] }[];
  labour: LabourPair[];
  unmappedOps: OdooLabour[];
  indirectPerHour: number;
  steps: { cogs: Step; labour: Step; indirect: Step; shipping: Step; capital: Step; total: Step };
  /** Unit price in INR: PDHQ's, and the sales order's (null when its currency can't be converted). */
  price: { pdhqInr: number; soInr: number | null };
  variances: Variance[];
};

/** Effective PDHQ hours per unit of a labour row: auto rows follow the engine's estimate. */
export function effectiveHours(row: WorkspaceRow, oh: any): number {
  if (oh.include === 'No') return 0;
  if (oh.is_auto_estimated) {
    if (oh.labor_type === 'Finishing' && row.r.autoLabor.finishingMh > 0) return row.r.autoLabor.finishingMh;
    if (oh.labor_type === 'Packaging' && row.r.autoLabor.packagingMh > 0) return row.r.autoLabor.packagingMh;
  }
  return Number(oh.man_hours_per_unit) || 0;
}

/** Converts a sales order unit price to INR at the PDHQ exchange rate (INR or USD only). */
export function soPriceInr(price: number, currency: string, fx: number): number | null {
  const c = (currency || '').toUpperCase();
  if (c === 'INR') return price;
  if (c === 'USD' && fx > 0) return price * fx;
  return null;
}

export function compare(b: Bundle, row: WorkspaceRow, past: OdooPastCost, targets: Record<number, Target>, opMap: OperationMap): Comparison {
  const produced = past.mo?.produced || 0;
  const per = (v: number) => (produced > 0 ? v / produced : 0);
  const p = row.p;
  const noPackaging = p.packaging_type === 'no_packaging';
  const resolved = new Map((row.r.resolvedCogsRows as any[]).map(l => [l.id, l]));
  const lineValueOf = (l: any) => {
    const r = resolved.get(l.id) ?? l;
    if (noPackaging && r.cogs_type === 'Packaging') return 0;
    return lineValue(r);
  };

  // COGS pairs, one per PDHQ line (with every Odoo component sent to it) or per new/skipped component.
  const lines = comparableLines(b, p.id);
  const pairs: CogsPair[] = [];
  const byLine = new Map<string, CogsPair>();
  for (const c of past.components) {
    const t = targets[c.odoo_product_id] ?? 'new';
    const line = t !== 'new' && t !== 'skip' ? lines.find(l => l.id === t) ?? null : null;
    if (line) {
      const pair = byLine.get(line.id) ?? { key: line.id, bucket: bucketOf(line.cogs_type).key, line, label: lineLabel(b, line), comps: [], pdhq: lineValueOf(line), odoo: 0, skipped: false };
      pair.comps.push(c); pair.odoo += per(c.value);
      if (!byLine.has(line.id)) { byLine.set(line.id, pair); pairs.push(pair); }
    } else {
      pairs.push({ key: `odoo:${c.odoo_product_id}`, bucket: bucketOf(cogsTypeForOdoo(c)).key, line: null, label: c.name, comps: [c], pdhq: 0, odoo: per(c.value), skipped: t === 'skip' });
    }
  }
  for (const l of lines) {
    if (byLine.has(l.id) || l.include === 'No') continue;
    const v = lineValueOf(l);
    if (v <= 0) continue;
    pairs.push({ key: l.id, bucket: bucketOf(l.cogs_type).key, line: l, label: lineLabel(b, l), comps: [], pdhq: v, odoo: 0, skipped: false });
  }
  const cogs = BUCKETS
    .map(bk => ({ bucket: bk.key as string, label: bk.label as string, pairs: pairs.filter(x => x.bucket === bk.key).sort((a, z) => Math.max(z.pdhq, z.odoo) - Math.max(a.pdhq, a.odoo)) }))
    .filter(g => g.pairs.length);
  // Order-level PDHQ costs (non-unit COGS: auto transport, tooling…) have no Odoo counterpart on an MO: both sides carry them.
  const nonUnit = row.r.nonUnitCogsPerUnit || 0;

  // Labour at today's PDHQ rates.
  const settings = mergeSettingsWithInquiry(b.gs, b.inq);
  const employees = withLiveDirectRates(b.employees as any[], settings);
  const rateOf = (t: string) => calc.avgRateByDesignation(employees as any, t);
  const myOh = b.oh.filter(o => o.product_id === p.id);
  const odooByType = new Map<string, { ops: string[]; hours: number; booked: number }>();
  const unmappedOps: OdooLabour[] = [];
  for (const op of past.labour) {
    const t = laborTypeFor(op.operation, opMap);
    if (!t) { if (!isOperationMapped(op.operation, opMap) && op.hours > 0) unmappedOps.push(op); continue; }
    const cur = odooByType.get(t) ?? { ops: [], hours: 0, booked: 0 };
    cur.ops.push(op.operation); cur.hours += op.hours; cur.booked += op.cost;
    odooByType.set(t, cur);
  }
  const types = [...new Set([...LABOR_TYPES, ...myOh.map(o => o.labor_type), ...odooByType.keys()])];
  const labour: LabourPair[] = types.map(t => {
    const rows = myOh.filter(o => o.labor_type === t);
    const pdhqHours = rows.reduce((a, o) => a + (noPackaging && t === 'Packaging' ? 0 : effectiveHours(row, o)), 0);
    const o = odooByType.get(t);
    const rate = rateOf(t);
    const odooHours = per(o?.hours ?? 0);
    return { laborType: t, operations: o?.ops ?? [], rate, pdhqHours, odooHours, pdhq: pdhqHours * rate, odoo: odooHours * rate, odooBooked: per(o?.booked ?? 0), rowId: rows[0]?.id ?? null };
  }).filter(x => x.pdhqHours > 0 || x.odooHours > 0);

  const pdhqHours = labour.reduce((a, x) => a + x.pdhqHours, 0);
  const odooHours = labour.reduce((a, x) => a + x.odooHours, 0);
  const indirectPerHour = row.r.manHoursPerUnit > 0 ? row.r.indirectOhPerUnit / row.r.manHoursPerUnit : calc.calcIndirectOhPerManHour(settings as any);

  const sum = (xs: number[]) => xs.reduce((a, v) => a + v, 0);
  const cogsStep = { label: 'COGS', pdhq: sum(pairs.map(x => x.pdhq)) + nonUnit, odoo: sum(pairs.map(x => x.odoo)) + nonUnit };
  const labourStep = { label: 'Direct labour', pdhq: sum(labour.map(x => x.pdhq)), odoo: sum(labour.map(x => x.odoo)) };
  const indirectStep = { label: 'Indirect overhead', pdhq: pdhqHours * indirectPerHour, odoo: odooHours * indirectPerHour };
  const shipping = row.buckets.shipping;
  const shippingStep = { label: 'Shipping', pdhq: shipping, odoo: shipping };
  const f = row.r.capitalFactor || 0;
  const base = (k: 'pdhq' | 'odoo') => cogsStep[k] + labourStep[k] + indirectStep[k] + shippingStep[k];
  const capitalStep = { label: 'Cost of capital', pdhq: base('pdhq') * f, odoo: base('odoo') * f };
  const total = { label: 'Unit cost', pdhq: base('pdhq') * (1 + f), odoo: base('odoo') * (1 + f) };

  // Biggest gaps first: each COGS pair, each labour type (with its share of indirect overhead).
  const variances: Variance[] = [
    ...pairs.filter(x => !x.skipped).map(x => ({
      label: x.label, step: bucketOf(x.line?.cogs_type ?? cogsTypeForOdoo(x.comps[0])).label, diff: x.odoo - x.pdhq,
      note: !x.line ? 'Not in PDHQ costing' : !x.comps.length ? 'Not used in Odoo' : '',
    })),
    ...labour.map(x => ({
      label: `${x.laborType} labour`, step: 'Labour', diff: (x.odooHours - x.pdhqHours) * (x.rate + indirectPerHour),
      note: `${x.pdhqHours.toFixed(2)} → ${x.odooHours.toFixed(2)} h/unit`,
    })),
  ].filter(v => Math.abs(v.diff) >= 0.5).sort((a, z) => Math.abs(z.diff) - Math.abs(a.diff));

  const fx = row.r.exchangeRate || 0;
  return {
    produced, cogs, labour, unmappedOps, indirectPerHour,
    steps: { cogs: cogsStep, labour: labourStep, indirect: indirectStep, shipping: shippingStep, capital: capitalStep, total },
    price: { pdhqInr: row.priceInr, soInr: past.sale ? soPriceInr(past.sale.price_unit, past.sale.currency, fx) : null },
    variances,
  };
}

// ---------- Lining PDHQ up with the past ----------

const round = (v: number, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;

/**
 * Line patch that makes a PDHQ line cost what the Odoo components cost per unit. One component:
 * its quantity used per unit at its actual price. Several: one "set" at their combined cost.
 * Waste is cleared because Odoo's quantities are what was actually consumed, waste included.
 */
export function linePatchFor(comps: OdooComponent[], produced: number): Record<string, any> {
  if (comps.length === 1) {
    const c = comps[0];
    const qty = produced > 0 ? c.used / produced : 0;
    return { include: 'Yes', is_auto_calculated: false, waste_factor: 0, components_per_product: round(qty, 6), unit_cost_inr: c.used > 0 ? round(c.value / c.used) : 0, units: c.uom || null };
  }
  const value = comps.reduce((a, c) => a + c.value, 0);
  return { include: 'Yes', is_auto_calculated: false, waste_factor: 0, components_per_product: 1, unit_cost_inr: produced > 0 ? round(value / produced) : 0, units: 'set' };
}

/**
 * Makes one PDHQ line match Odoo: a matched line takes Odoo's cost, a PDHQ line Odoo didn't use
 * is excluded, and a component PDHQ doesn't have becomes a new line with id `newId` (so the
 * caller can point the component at it and a second apply updates it instead of adding another).
 */
export function applyCogsPair(b: Bundle, productId: string, pair: CogsPair, produced: number, newId?: string): Mutation | null {
  if (pair.skipped) return null;
  if (!pair.comps.length) return pair.line ? patchCogsLine(b, pair.line.id, { include: 'No' }) : null;
  const patch = linePatchFor(pair.comps, produced);
  if (pair.line) return patchCogsLine(b, pair.line.id, patch);
  const c = pair.comps[0];
  return addCogsLine(b, productId, cogsTypeForOdoo(c), { ...patch, component_name: c.name, ...(newId ? { id: newId } : {}) });
}

/** Fresh line ids for every pair that would add a line, keyed by Odoo product id. */
export function newLineIds(cmp: Comparison): Record<number, string> {
  const out: Record<number, string> = {};
  for (const g of cmp.cogs) for (const p of g.pairs) if (!p.line && !p.skipped && p.comps[0]) out[p.comps[0].odoo_product_id] = crypto.randomUUID();
  return out;
}

/** Sets a labour type's hours per unit to Odoo's, as a manual value (adds the row if the product has none). */
export function applyLabourPair(b: Bundle, productId: string, pair: LabourPair): Mutation {
  const hours = round(pair.odooHours);
  const rows = b.oh.filter(o => o.product_id === productId && o.labor_type === pair.laborType);
  if (!rows.length) {
    const maxSort = b.oh.filter(o => o.product_id === productId).reduce((m, o) => Math.max(m, o.sort_order ?? 0), 0);
    const row = { id: crypto.randomUUID(), product_id: productId, labor_type: pair.laborType, include: 'Yes', is_auto_estimated: false, man_hours_per_unit: hours, sort_order: maxSort + 1, created_at: new Date().toISOString() };
    return {
      next: { ...b, oh: [...b.oh, row] }, touched: [productId],
      commit: async () => { const r = await db.from('overhead_items').insert(row); if (r.error) throw new Error(r.error.message); },
    };
  }
  // The first row carries the hours; any duplicate rows of the same type are zeroed so they don't add on top.
  const patches = new Map(rows.map((r, i) => [r.id, i === 0 ? { include: 'Yes', is_auto_estimated: false, man_hours_per_unit: hours } : { is_auto_estimated: false, man_hours_per_unit: 0 }]));
  return {
    next: { ...b, oh: b.oh.map(o => (patches.has(o.id) ? { ...o, ...patches.get(o.id) } : o)) },
    touched: [productId],
    commit: async () => {
      for (const [id, patch] of patches) {
        const r = await db.from('overhead_items').update(patch).eq('id', id);
        if (r.error) throw new Error(r.error.message);
      }
    },
  };
}

/** Everything at once: every COGS pair (except skipped components) and every labour type. */
export function applyAll(b: Bundle, productId: string, cmp: Comparison, newIds: Record<number, string> = {}): Mutation {
  return chain(b, [
    ...cmp.cogs.flatMap(g => g.pairs).map(pair => (cur: Bundle) =>
      applyCogsPair(cur, productId, refreshPair(cur, pair), cmp.produced, pair.comps[0] ? newIds[pair.comps[0].odoo_product_id] : undefined)),
    ...cmp.labour.map(pair => (cur: Bundle) => applyLabourPair(cur, productId, pair)),
  ]);
}

/** A pair's PDHQ line as it is in `cur` (an earlier step of the same chain may have changed the bundle). */
const refreshPair = (cur: Bundle, pair: CogsPair): CogsPair =>
  pair.line ? { ...pair, line: cur.cogs.find(c => c.id === pair.line.id) ?? pair.line } : pair;
