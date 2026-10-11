// Costing Workspace data layer.
//
// One in-memory bundle per inquiry (products + every costing row + reference tables).
// Every number the workspace shows comes from computeProductCosting() over that bundle,
// so the workspace can never disagree with the costing sheet. Edits are applied to the
// bundle first (instant recompute) and then written to the database.
//
// Replaces the separate Pricing Grid (vendor quotes), Target Grid (target prices) and
// Bulk Costing Editor: they were three views over the same rows.

import { supabase } from '@/integrations/supabase/client';
import { computeProductCosting, type CostingEngineResult, type ShipmentPool } from '@/lib/costing-engine';
import { loadFobRates } from '@/lib/fob-rates';
import { persistResolvedCosting } from '@/lib/costing-seed';
import { solveForMarkup, solveForMaxCost } from '@/lib/target-price-solver';
import { HARDWARE_COGS_TYPES_WITH_LEGACY } from '@/lib/cogs-categories';
import { calcCogsItemCost } from '@/lib/calculations';

const db = supabase as any;

export type Bundle = {
  inq: any;
  customer: any | null;
  products: any[];
  cogs: any[];
  nu: any[];
  oh: any[];
  shipItems: any[];
  cbm: any[];
  shipTypes: any[];
  employees: any[];
  gs: any;
  productTypes: any[];
  chemicalPrices: any[];
  boxData: any[];
  difficulties: any[];
  locations: any[];
  rawMaterialCosts: any[];
};

// ---------- Cost buckets ----------

/** Per-unit cost buckets shown across the workspace, in costing-sheet order. */
export const BUCKETS = [
  { key: 'raw_piece', label: 'Raw piece', short: 'Raw', types: ['Raw Piece', 'COGS', 'Wood'], color: 'hsl(var(--cw-raw))' },
  { key: 'subcontract', label: 'Subcontract', short: 'Subc', types: ['Subcontracting'], color: 'hsl(var(--cw-subc))' },
  { key: 'outsourced', label: 'Outsourced', short: 'Outs', types: ['Outsourced Product'], color: 'hsl(var(--cw-outs))' },
  { key: 'hardware', label: 'Hardware', short: 'HW', types: [...HARDWARE_COGS_TYPES_WITH_LEGACY], color: 'hsl(var(--cw-hw))' },
  { key: 'finishing', label: 'Finishing', short: 'Fin', types: ['Finishing Materials'], color: 'hsl(var(--cw-fin))' },
  { key: 'packaging', label: 'Packaging', short: 'Pkg', types: ['Packaging'], color: 'hsl(var(--cw-pkg))' },
  { key: 'other', label: 'Other COGS', short: 'Other', types: ['Components', 'Other'], color: 'hsl(var(--cw-other))' },
  { key: 'labor', label: 'Labor & OH', short: 'Labor', types: [], color: 'hsl(var(--cw-labor))' },
  { key: 'shipping', label: 'Shipping', short: 'Ship', types: [], color: 'hsl(var(--cw-ship))' },
] as const;
export type BucketKey = typeof BUCKETS[number]['key'];

/** Buckets that are a sum of COGS lines, and so can be set directly from the grid. */
export const EDITABLE_BUCKETS: { key: string; label: string; types: string[] }[] = [
  { key: 'raw_piece', label: 'Raw piece', types: ['Raw Piece', 'COGS'] },
  { key: 'subcontract', label: 'Subcontract', types: ['Subcontracting'] },
  { key: 'hw_inserts', label: 'Inserts + Instr.', types: ['Inserts + Instructions'] },
  { key: 'hw_handles_knobs', label: 'Handles + Knobs', types: ['Handles + Knobs'] },
  { key: 'hw_feet', label: 'Feet / Buffers', types: ['Feet/Buffers'] },
  { key: 'hw_latches', label: 'Latches', types: ['Handles/Latches'] },
  { key: 'hw_other', label: 'Other hardware', types: ['Other Hardware', 'Hardware'] },
  { key: 'accessories', label: 'Accessories', types: ['Accessories'] },
  { key: 'finishing', label: 'Finishing', types: ['Finishing Materials'] },
  { key: 'packaging', label: 'Packaging', types: ['Packaging'] },
];

/** Per-unit INR of one COGS line — the engine's own formula (waste is a divisor: qty ÷ (1 − waste)). */
export const lineValue = (c: any) => calcCogsItemCost({
  include: c.include,
  components_per_product: Number(c.components_per_product) || 0,
  unit_cost_inr: Number(c.unit_cost_inr) || 0,
  waste_factor: Number(c.waste_factor) || 0,
} as any).unit_cost;

// ---------- Rows ----------

export type Quote = { slot: number; line: any | null; vendor: string; price: number; winner: boolean };

export type Flag = { field: string; kind: 'blank' | 'odd' | 'target'; msg: string };

export type WorkspaceRow = {
  p: any;
  cbmRow: any | null;
  r: CostingEngineResult;
  qty: number;
  /** Per-unit INR by display bucket (sums to unit cost minus capital). */
  buckets: Record<BucketKey, number>;
  /** Per-unit INR by editable bucket (finer hardware split). */
  editBuckets: Record<string, number>;
  quotes: Quote[];
  rawVendor: string;
  shippingName: string;
  costInr: number;
  priceInr: number;
  priceUsd: number;
  costUsd: number;
  markup: number;
  /** Net margin on price (price − cost) / price. */
  margin: number;
  /** Per-unit indirect (factory) overhead in the cost, with its share of cost of capital. */
  indirectInr: number;
  indirectUsd: number;
  /** Contribution rate: net margin with indirect overhead added back, (price − cost + indirect) / price. */
  contribution: number;
  targetUsd: number | null;
  gapUsd: number | null;
  gapPct: number | null;
  requiredMarkup: number | null;
  maxCostInr: number | null;
  flags: Flag[];
};

const RAW_TYPES = ['Raw Piece'];

function quotesFor(cogs: any[]): Quote[] {
  const raw = cogs
    .filter(c => RAW_TYPES.includes(c.cogs_type))
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  return raw.map((line, slot) => ({
    slot, line,
    vendor: (line.vendor_name || '').trim(),
    price: Number(line.unit_cost_inr) || 0,
    winner: line.include === 'Yes',
  }));
}

function runEngine(b: Bundle, p: any, pool: ShipmentPool | null): CostingEngineResult {
  return computeProductCosting({
    product: p,
    cogsItems: b.cogs.filter(c => c.product_id === p.id),
    nonUnitCogs: b.nu.filter(n => n.product_id === p.id),
    overheadItems: b.oh.filter(o => o.product_id === p.id),
    shippingItems: b.shipItems,
    cbmRow: b.cbm.find(c => c.product_id === p.id) || null,
    productType: b.productTypes.find(t => t.id === p.product_type_id) || null,
    boxData: b.boxData,
    chemicalPrices: b.chemicalPrices,
    shippingTypes: b.shipTypes,
    laborEmployees: b.employees,
    globalSettings: b.gs,
    inquiryOverrides: b.inq,
    locations: b.locations,
    difficulties: b.difficulties,
    rawMaterialCosts: b.rawMaterialCosts,
    shipmentPool: pool,
  });
}

/** Runs the engine for every product: pass 1 sizes the inquiry shipment, pass 2 prices FOB on it. */
export function computeResults(b: Bundle): Map<string, CostingEngineResult> {
  const pool: ShipmentPool = { lines: [] };
  for (const p of b.products) {
    const r = runEngine(b, p, null);
    const q = Number(p.quantity) || 0;
    pool.lines.push({ product_id: p.id, cbm: q * r.finalUnitCbm, cartons: q > 0 ? Math.ceil(q / (r.productsPerMc || 1)) : 0 });
  }
  const out = new Map<string, CostingEngineResult>();
  for (const p of b.products) out.set(p.id, runEngine(b, p, pool));
  return out;
}

export function buildRows(b: Bundle, results: Map<string, CostingEngineResult>): WorkspaceRow[] {
  const shipTypeById = new Map(b.shipTypes.map((s: any) => [s.id, s]));
  const rows = b.products.map(p => {
    const r = results.get(p.id)!;
    const myCogs = b.cogs.filter(c => c.product_id === p.id);
    const buckets = Object.fromEntries(BUCKETS.map(x => [x.key, 0])) as Record<BucketKey, number>;
    const editBuckets: Record<string, number> = Object.fromEntries(EDITABLE_BUCKETS.map(x => [x.key, 0]));
    for (const line of r.resolvedCogsRows as any[]) {
      if (line.include === 'No') continue;
      if (p.packaging_type === 'no_packaging' && line.cogs_type === 'Packaging') continue;
      const v = lineValue(line);
      const isOutsourcedLine = (line.component_name || '').toLowerCase() === 'outsourced product';
      const bk = isOutsourcedLine ? BUCKETS.find(x => x.key === 'outsourced')! : BUCKETS.find(x => (x.types as readonly string[]).includes(line.cogs_type));
      buckets[(bk?.key ?? 'other') as BucketKey] += v;
      const eb = EDITABLE_BUCKETS.find(x => x.types.includes(line.cogs_type));
      if (eb && !isOutsourcedLine) editBuckets[eb.key] += v;
    }
    // Legacy outsourced cost (product-level field) is added by the engine on top of COGS lines.
    const linesTotal = Object.values(buckets).reduce((a, v) => a + v, 0);
    const engineCogs = r.cogsPerUnit;
    if (engineCogs - linesTotal > 0.005) buckets.outsourced += engineCogs - linesTotal;
    buckets.other += r.nonUnitCogsPerUnit;
    buckets.labor = r.directOhPerUnit + r.indirectOhPerUnit;
    buckets.shipping = r.shippingPerUnit;

    const quotes = quotesFor(myCogs);
    const winner = quotes.find(q => q.winner);
    const shipItem = b.shipItems.find(s => s.product_id === p.id);
    const shipId = b.inq?.shipping_type_id_override || shipItem?.shipping_type_id || null;
    const costInr = r.summary.product_cost_per_unit_inr;
    const priceInr = r.summary.unit_price_inr;
    const fx = r.exchangeRate || 1;
    const targetUsd = Number(p.target_price_usd) > 0 ? Number(p.target_price_usd) : null;
    const priceUsd = r.summary.unit_price_usd;
    // Cost of capital is charged on the whole base cost, so the indirect share carries its part too.
    const indirectInr = (r.indirectOhPerUnit || 0) * (1 + (r.capitalFactor || 0));
    const ms = targetUsd ? solveForMarkup({ targetPriceUsd: targetUsd, currentCostInr: costInr, exchangeRate: fx, currentMarkup: r.markupPercent }) : null;
    const cs = targetUsd ? solveForMaxCost({ targetPriceUsd: targetUsd, currentCostInr: costInr, exchangeRate: fx, markupPercent: r.markupPercent, buckets: [] }) : null;
    return {
      p, r,
      cbmRow: b.cbm.find(c => c.product_id === p.id) || null,
      qty: Number(p.quantity) || 0,
      buckets, editBuckets, quotes,
      rawVendor: winner?.vendor || '',
      shippingName: shipId ? ((shipTypeById.get(shipId) as any)?.name || '—') : '—',
      costInr, priceInr, priceUsd,
      costUsd: r.summary.product_cost_per_unit_usd,
      markup: r.markupPercent,
      margin: priceInr > 0 ? (priceInr - costInr) / priceInr : 0,
      indirectInr,
      indirectUsd: indirectInr / fx,
      contribution: priceInr > 0 ? (priceInr - costInr + indirectInr) / priceInr : 0,
      targetUsd,
      gapUsd: targetUsd ? priceUsd - targetUsd : null,
      gapPct: targetUsd ? (priceUsd - targetUsd) / targetUsd : null,
      requiredMarkup: ms?.feasible ? ms.requiredMarkup : null,
      maxCostInr: cs?.feasible ? cs.maxCostInr : null,
      flags: [],
    } satisfies WorkspaceRow;
  });
  attachFlags(rows);
  return rows;
}

/** Audit flags: a cost most SKUs have but this one lacks, an odd-one-out setting, or over target. */
function attachFlags(rows: WorkspaceRow[]) {
  if (rows.length === 0) return;
  const majority = (n: number) => n > rows.length / 2;
  for (const eb of EDITABLE_BUCKETS) {
    const have = rows.filter(r => r.editBuckets[eb.key] > 0).length;
    if (!majority(have) || have === rows.length) continue;
    for (const r of rows) {
      if (r.r.isOutsourced || r.editBuckets[eb.key] > 0) continue;
      r.flags.push({ field: eb.key, kind: 'blank', msg: `No ${eb.label.toLowerCase()} cost — ${have} of ${rows.length} SKUs have one` });
    }
  }
  const categorical: [string, string, (r: WorkspaceRow) => string][] = [
    ['packaging_type', 'packaging', r => r.p.packaging_type || 'ic_mc'],
    ['shipping', 'shipping', r => r.shippingName],
    ['raw_vendor', 'raw vendor', r => r.rawVendor],
  ];
  for (const [field, label, get] of categorical) {
    const vals = rows.map(get).filter(v => v && v !== '—');
    if (vals.length < 3) continue;
    const counts = new Map<string, number>();
    vals.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    const [mode, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n === vals.length) continue;
    for (const r of rows) {
      const v = get(r);
      if (v && v !== '—' && v !== mode) r.flags.push({ field, kind: 'odd', msg: `Uses ${v} for ${label}; most SKUs use ${mode}` });
    }
  }
  for (const r of rows) {
    if (r.gapUsd != null && r.gapPct != null && r.gapUsd > 0.005) {
      r.flags.push({ field: 'target', kind: 'target', msg: `$${r.gapUsd.toFixed(2)} (${(r.gapPct * 100).toFixed(1)}%) over target` });
    }
  }
}

export type Totals = {
  skus: number; units: number; cbm: number; fobUsd: number; costUsd: number; margin: number;
  /** Indirect overhead absorbed by the order, and the contribution rate (net + indirect) / FOB. */
  indirectUsd: number; contribution: number;
  withTarget: number; overTarget: number; targetFobUsd: number; flagged: number;
};

export function totals(rows: WorkspaceRow[]): Totals {
  let units = 0, cbm = 0, fob = 0, cost = 0, indirect = 0, withTarget = 0, overTarget = 0, targetFob = 0, flagged = 0;
  for (const r of rows) {
    units += r.qty; cbm += r.r.finalUnitCbm * r.qty; fob += r.priceUsd * r.qty; cost += r.costUsd * r.qty; indirect += r.indirectUsd * r.qty;
    if (r.targetUsd) { withTarget++; targetFob += r.targetUsd * r.qty; if ((r.gapUsd ?? 0) > 0.005) overTarget++; }
    if (r.flags.some(f => f.kind !== 'target')) flagged++;
  }
  return { skus: rows.length, units, cbm, fobUsd: fob, costUsd: cost, margin: fob > 0 ? (fob - cost) / fob : 0,
    indirectUsd: indirect, contribution: fob > 0 ? (fob - cost + indirect) / fob : 0, withTarget, overTarget, targetFobUsd: targetFob, flagged };
}

// ---------- Loading ----------

export async function loadBundle(inquiryId: string): Promise<Bundle | null> {
  const { data: inq } = await db.from('customer_rfqs').select('*').eq('id', inquiryId).maybeSingle();
  if (!inq) return null;
  const [cust, prods] = await Promise.all([
    inq.customer_id ? db.from('customers').select('id, name, company').eq('id', inq.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('products').select('*').eq('customer_rfq_id', inquiryId).is('archived_at', null)
      .order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }).order('name', { ascending: true }),
  ]);
  const products = (prods.data as any[]) || [];
  const ids = products.length ? products.map(p => p.id) : ['00000000-0000-0000-0000-000000000000'];
  const [res] = await Promise.all([
    Promise.all([
      db.from('cogs_items').select('*').in('product_id', ids).limit(100000),
      db.from('non_unit_cogs').select('*').in('product_id', ids).limit(100000),
      db.from('overhead_items').select('*').in('product_id', ids).limit(100000),
      db.from('shipping_items').select('*').in('product_id', ids).limit(100000),
      db.from('shipping_types').select('*'),
      db.from('labor_employees').select('*'),
      db.from('global_settings').select('*').limit(1).maybeSingle(),
      db.from('cbm_estimates').select('*').in('product_id', ids).limit(100000),
      db.from('product_types').select('*').order('name'),
      db.from('chemical_prices').select('*'),
      db.from('box_data').select('*'),
      db.from('finishing_difficulty').select('name, adjustment_factor'),
      db.from('local_transport_locations').select('id, name, cost_per_cbm_inr'),
      db.from('raw_material_costs').select('*'),
    ]),
    loadFobRates(),
  ]);
  const d = res.map((x: any) => x.data || []);
  return {
    inq, customer: cust.data, products,
    cogs: d[0], nu: d[1], oh: d[2], shipItems: d[3], shipTypes: d[4], employees: d[5], gs: res[6].data || {},
    cbm: d[7], productTypes: d[8], chemicalPrices: d[9], boxData: d[10], difficulties: d[11], locations: d[12],
    rawMaterialCosts: d[13],
  };
}

// ---------- Mutations ----------
// Each returns the next bundle plus a commit() that writes it. The caller applies `next`
// immediately (so the engine recomputes) and runs commit() in the background.

export type Mutation = { next: Bundle; commit: () => Promise<void>; touched: string[] };
/** Applies a mutation built against the latest bundle (avoids stale closures between quick edits). */
export type Apply = (build: (b: Bundle) => Mutation | null) => void;

const check = (r: any) => { if (r?.error) throw new Error(r.error.message); return r; };
const uuid = () => crypto.randomUUID();

export function patchProducts(b: Bundle, patches: Record<string, Record<string, any>>): Mutation {
  const ids = Object.keys(patches);
  const next = { ...b, products: b.products.map(p => (patches[p.id] ? { ...p, ...patches[p.id] } : p)) };
  return {
    next, touched: ids,
    commit: async () => {
      // Group identical patches into one request each.
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        const k = JSON.stringify(patches[id]);
        groups.set(k, [...(groups.get(k) || []), id]);
      }
      await Promise.all([...groups].map(async ([k, gids]) => check(await db.from('products').update(JSON.parse(k)).in('id', gids))));
    },
  };
}

export const patchProductsSame = (b: Bundle, ids: string[], patch: Record<string, any>) =>
  patchProducts(b, Object.fromEntries(ids.map(id => [id, patch])));

export function patchCbm(b: Bundle, ids: string[], patch: Record<string, any>): Mutation {
  const existing = new Set(b.cbm.filter(c => ids.includes(c.product_id)).map(c => c.product_id));
  const inserts = ids.filter(id => !existing.has(id)).map(pid => ({ id: uuid(), product_id: pid, ...patch }));
  const next = {
    ...b,
    cbm: [...b.cbm.map(c => (ids.includes(c.product_id) ? { ...c, ...patch } : c)), ...inserts],
  };
  return {
    next, touched: ids,
    commit: async () => {
      if (existing.size) check(await db.from('cbm_estimates').update(patch).in('product_id', [...existing]));
      if (inserts.length) check(await db.from('cbm_estimates').insert(inserts));
    },
  };
}

function cogsMutation(b: Bundle, updates: { id: string; patch: any }[], inserts: any[], deletes: string[] = []): Mutation {
  const byId = new Map(updates.map(u => [u.id, u.patch]));
  const next = {
    ...b,
    cogs: [...b.cogs.filter(c => !deletes.includes(c.id)).map(c => (byId.has(c.id) ? { ...c, ...byId.get(c.id) } : c)), ...inserts],
  };
  const touched = [...new Set([
    ...b.cogs.filter(c => byId.has(c.id) || deletes.includes(c.id)).map(c => c.product_id),
    ...inserts.map(i => i.product_id),
  ])];
  return {
    next, touched,
    commit: async () => {
      const groups = new Map<string, string[]>();
      updates.forEach(u => { const k = JSON.stringify(u.patch); groups.set(k, [...(groups.get(k) || []), u.id]); });
      await Promise.all([...groups].map(async ([k, gids]) => check(await db.from('cogs_items').update(JSON.parse(k)).in('id', gids))));
      if (inserts.length) check(await db.from('cogs_items').insert(inserts));
      if (deletes.length) check(await db.from('cogs_items').delete().in('id', deletes));
    },
  };
}

export const patchCogsLine = (b: Bundle, id: string, patch: Record<string, any>) => cogsMutation(b, [{ id, patch }], []);
export const deleteCogsLine = (b: Bundle, id: string) => cogsMutation(b, [], [], [id]);
export function addCogsLine(b: Bundle, productId: string, cogsType: string, extra: Record<string, any> = {}): Mutation {
  const maxSort = b.cogs.filter(c => c.product_id === productId).reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
  return cogsMutation(b, [], [{
    id: uuid(), product_id: productId, cogs_type: cogsType, component_name: cogsType, include: 'Yes',
    components_per_product: 1, unit_cost_inr: 0, waste_factor: 0, is_auto_calculated: false, sort_order: maxSort + 1,
    vendor_name: null, units: null, chemical_price_id: null, created_at: new Date().toISOString(), ...extra,
  }]);
}

/**
 * Sets a bucket's per-unit total for many products. The first included line of the bucket
 * absorbs the difference (other lines stay as they are); a line is created if none exists.
 */
export function setBucketTotal(b: Bundle, ids: string[], bucketKey: string, valueInr: number): Mutation {
  const types = EDITABLE_BUCKETS.find(x => x.key === bucketKey)!.types;
  const updates: { id: string; patch: any }[] = [];
  const inserts: any[] = [];
  for (const pid of ids) {
    const lines = b.cogs
      .filter(c => c.product_id === pid && types.includes(c.cogs_type) && c.include === 'Yes' && (c.component_name || '').toLowerCase() !== 'outsourced product')
      .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0));
    const primary = lines.find(l => !l.is_auto_calculated) || lines[0];
    if (primary) {
      const others = lines.filter(l => l !== primary).reduce((a, c) => a + lineValue(c), 0);
      const qty = Number(primary.components_per_product) > 0 ? Number(primary.components_per_product) : 1;
      const waste = Math.min(Number(primary.waste_factor) || 0, 0.99);
      const unit = Math.max(0, ((valueInr - others) * (1 - waste)) / qty);
      updates.push({ id: primary.id, patch: { unit_cost_inr: Math.round(unit * 100) / 100, components_per_product: qty, ...(primary.is_auto_calculated ? { is_auto_calculated: false } : {}) } });
    } else if (valueInr > 0) {
      const maxSort = b.cogs.filter(c => c.product_id === pid).reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
      inserts.push({ id: uuid(), product_id: pid, cogs_type: types[0], component_name: types[0], unit_cost_inr: valueInr,
        components_per_product: 1, waste_factor: 0, include: 'Yes', is_auto_calculated: false, sort_order: maxSort + 1,
        created_at: new Date().toISOString() });
    }
  }
  return cogsMutation(b, updates, inserts);
}

/** Multiplies every included, manually-priced line of a bucket by (1 + pct). */
export function scaleBucket(b: Bundle, ids: string[], bucketKey: string, pct: number): Mutation {
  const types = EDITABLE_BUCKETS.find(x => x.key === bucketKey)!.types;
  const updates = b.cogs
    .filter(c => ids.includes(c.product_id) && types.includes(c.cogs_type) && c.include === 'Yes' && !c.is_auto_calculated)
    .map(c => ({ id: c.id, patch: { unit_cost_inr: Math.round((Number(c.unit_cost_inr) || 0) * (1 + pct) * 100) / 100 } }));
  // Patches differ per line, so they can't be grouped; cogsMutation sends one request per distinct value.
  return cogsMutation(b, updates, []);
}

// ----- Vendor quotes (raw piece slots, one winner) -----

export function setQuote(b: Bundle, productId: string, slot: number, patch: { vendor_name?: string | null; unit_cost_inr?: number }): Mutation {
  const quotes = quotesFor(b.cogs.filter(c => c.product_id === productId));
  const q = quotes[slot];
  if (q?.line) {
    const p: any = { ...patch };
    if (patch.unit_cost_inr != null && !(Number(q.line.components_per_product) > 0)) p.components_per_product = 1;
    return cogsMutation(b, [{ id: q.line.id, patch: p }], []);
  }
  const hasWinner = quotes.some(x => x.winner);
  return cogsMutation(b, [], [{
    id: uuid(), product_id: productId, cogs_type: 'Raw Piece', component_name: `Raw Piece ${slot + 1}`,
    include: hasWinner ? 'No' : 'Yes', sort_order: slot, waste_factor: 0, components_per_product: 1,
    unit_cost_inr: patch.unit_cost_inr ?? 0, vendor_name: patch.vendor_name ?? null, is_auto_calculated: false,
    created_at: new Date().toISOString(),
  }]);
}

export function chooseQuote(b: Bundle, productId: string, slot: number): Mutation {
  const quotes = quotesFor(b.cogs.filter(c => c.product_id === productId));
  const updates = quotes.filter(q => q.line).map(q => ({ id: q.line!.id, patch: { include: q.slot === slot ? 'Yes' : 'No' } }))
    .filter(u => b.cogs.find(c => c.id === u.id)?.include !== u.patch.include);
  return cogsMutation(b, updates, []);
}

/** For each product, picks the cheapest priced quote as the winner. */
export function chooseCheapestQuotes(b: Bundle, ids: string[]): Mutation {
  const updates: { id: string; patch: any }[] = [];
  for (const pid of ids) {
    const quotes = quotesFor(b.cogs.filter(c => c.product_id === pid)).filter(q => q.line);
    const priced = quotes.filter(q => q.price > 0);
    if (priced.length === 0) continue;
    const best = priced.reduce((a, q) => (q.price < a.price ? q : a));
    for (const q of quotes) {
      const want = q.slot === best.slot ? 'Yes' : 'No';
      if (q.line!.include !== want) updates.push({ id: q.line!.id, patch: { include: want } });
    }
  }
  return cogsMutation(b, updates, []);
}

export function setRawVendor(b: Bundle, ids: string[], vendor: string): Mutation {
  const v = vendor.trim() || null;
  const updates: { id: string; patch: any }[] = [];
  const inserts: any[] = [];
  for (const pid of ids) {
    const winner = quotesFor(b.cogs.filter(c => c.product_id === pid)).find(q => q.winner);
    if (winner?.line) updates.push({ id: winner.line.id, patch: { vendor_name: v } });
    else if (v) inserts.push({ id: uuid(), product_id: pid, cogs_type: 'Raw Piece', component_name: 'Raw Piece 1', vendor_name: v,
      unit_cost_inr: 0, components_per_product: 1, waste_factor: 0, include: 'Yes', is_auto_calculated: false, sort_order: 0,
      created_at: new Date().toISOString() });
  }
  return cogsMutation(b, updates, inserts);
}

// ----- Labor -----

export function patchOverhead(b: Bundle, id: string, patch: Record<string, any>): Mutation {
  const row = b.oh.find(o => o.id === id);
  return {
    next: { ...b, oh: b.oh.map(o => (o.id === id ? { ...o, ...patch } : o)) },
    touched: row ? [row.product_id] : [],
    commit: async () => { check(await db.from('overhead_items').update(patch).eq('id', id)); },
  };
}

export function patchNonUnit(b: Bundle, id: string, patch: Record<string, any>): Mutation {
  const row = b.nu.find(o => o.id === id);
  return {
    next: { ...b, nu: b.nu.map(o => (o.id === id ? { ...o, ...patch } : o)) },
    touched: row ? [row.product_id] : [],
    commit: async () => { check(await db.from('non_unit_cogs').update(patch).eq('id', id)); },
  };
}

// ----- Pricing -----

/** Sets each product's markup so its price lands exactly on its target (products without a target are skipped). */
export function markupToTarget(b: Bundle, rows: WorkspaceRow[], ids: string[]): Mutation {
  const patches: Record<string, Record<string, any>> = {};
  for (const r of rows) {
    if (!ids.includes(r.p.id) || r.requiredMarkup == null) continue;
    patches[r.p.id] = { markup_percent: Math.round(r.requiredMarkup * 10000) / 10000 };
  }
  return patchProducts(b, patches);
}

/** Copies each product's current calculated price into its target price. */
export function targetFromPrice(b: Bundle, rows: WorkspaceRow[], ids: string[]): Mutation {
  const patches: Record<string, Record<string, any>> = {};
  for (const r of rows) if (ids.includes(r.p.id)) patches[r.p.id] = { target_price_usd: Math.round(r.priceUsd * 100) / 100 };
  return patchProducts(b, patches);
}

/** Writes the engine's resolved values (auto rows, cached price/cost) for the given products. */
export async function persistDerived(b: Bundle, results: Map<string, CostingEngineResult>, ids: string[]) {
  await Promise.all(ids.map(async id => {
    const p = b.products.find(x => x.id === id);
    const r = results.get(id);
    if (!p || !r) return;
    await persistResolvedCosting(id, p, b.cogs.filter(c => c.product_id === id), b.nu.filter(n => n.product_id === id), r);
  }));
}

/** Sets the waste % on every raw-piece quote line of the given products. */
export function setRawWaste(b: Bundle, ids: string[], waste: number): Mutation {
  const updates = b.cogs
    .filter(c => ids.includes(c.product_id) && RAW_TYPES.includes(c.cogs_type) && Number(c.waste_factor || 0) !== waste)
    .map(c => ({ id: c.id, patch: { waste_factor: waste } }));
  return cogsMutation(b, updates, []);
}

/** Writes one vendor name into quote slot `slot` for every given product (creating slots as needed). */
export function fillQuoteVendor(b: Bundle, ids: string[], slot: number, vendor: string): Mutation {
  let cur = b;
  const commits: (() => Promise<void>)[] = [];
  for (const id of ids) {
    const m = setQuote(cur, id, slot, { vendor_name: vendor.trim() || null });
    cur = m.next; commits.push(m.commit);
  }
  return { next: cur, touched: ids, commit: async () => { for (const c of commits) await c(); } };
}
