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
import { OUTSOURCED_COGS_NAME, computeProductCosting, type CostingEngineResult, type ShipmentPool } from '@/lib/costing-engine';
import { loadFobRates } from '@/lib/fob-rates';
import { persistResolvedCosting } from '@/lib/costing-seed';
import { solveForMarkup, solveForMaxCost } from '@/lib/target-price-solver';
import { HARDWARE_COGS_TYPES_WITH_LEGACY } from '@/lib/cogs-categories';
import { calcCogsItemCost } from '@/lib/calculations';
import { fetchAllByIds } from '@/lib/supabase-paged';
import { quoteCurrencyOf, readTarget, targetPatch, type QuoteCur } from '@/lib/quote-currency';

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
  hardwarePrices: any[];
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
  /** Effective Finishing/Packaging hours per unit (auto rows follow the engine's estimate); null when the row is missing. */
  labor: Record<'Finishing' | 'Packaging', { hours: number; auto: boolean } | null>;
  rawVendor: string;
  shippingId: string | null;
  shippingName: string;
  costInr: number;
  priceInr: number;
  /** Currency the inquiry is quoted in; price, cost, indirect, target and gap below are in it. */
  cur: QuoteCur;
  price: number;
  cost: number;
  markup: number;
  /** Net margin on price (price − cost) / price. */
  margin: number;
  /** Per-unit indirect (factory) overhead in the cost, with its share of cost of capital. */
  indirectInr: number;
  indirect: number;
  /** Contribution rate: net margin with indirect overhead added back, (price − cost + indirect) / price. */
  contribution: number;
  target: number | null;
  gap: number | null;
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
    // An archived product opened on its own page prices against the live order without joining it.
    if (p.archived_at) continue;
    const r = runEngine(b, p, null);
    const q = Number(p.quantity) || 0;
    pool.lines.push({ product_id: p.id, cbm: q * r.finalUnitCbm, cartons: q > 0 ? Math.ceil(q / (r.productsPerMc || 1)) : 0 });
  }
  const out = new Map<string, CostingEngineResult>();
  for (const p of b.products) out.set(p.id, runEngine(b, p, pool));
  return out;
}

export function buildRows(b: Bundle, results: Map<string, CostingEngineResult>): WorkspaceRow[] {
  const cur = quoteCurrencyOf(b.inq);
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
    // INR per unit of the quote currency: rupee inquiries never touch the exchange rate.
    const rate = cur === 'INR' ? 1 : fx;
    const target = readTarget(p, cur, fx);
    const price = cur === 'INR' ? priceInr : r.summary.unit_price_usd;
    // Cost of capital is charged on the whole base cost, so the indirect share carries its part too.
    const indirectInr = (r.indirectOhPerUnit || 0) * (1 + (r.capitalFactor || 0));
    const ms = target ? solveForMarkup({ targetPriceUsd: target, currentCostInr: costInr, exchangeRate: rate, currentMarkup: r.markupPercent }) : null;
    const cs = target ? solveForMaxCost({ targetPriceUsd: target, currentCostInr: costInr, exchangeRate: rate, markupPercent: r.markupPercent, buckets: [] }) : null;
    const laborFor = (type: 'Finishing' | 'Packaging') => {
      const rows = b.oh.filter(o => o.product_id === p.id && o.labor_type === type && o.include !== 'No');
      if (!rows.length) return null;
      if (type === 'Packaging' && p.packaging_type === 'no_packaging') return { hours: 0, auto: rows.every(o => o.is_auto_estimated) };
      const est = type === 'Finishing' ? r.autoLabor.finishingMh : r.autoLabor.packagingMh;
      // Mirrors the engine: an auto row takes the estimate when there is one.
      return {
        hours: rows.reduce((a, o) => a + (o.is_auto_estimated && est > 0 ? est : Number(o.man_hours_per_unit) || 0), 0),
        auto: rows.every(o => o.is_auto_estimated),
      };
    };
    return {
      p, r,
      labor: { Finishing: laborFor('Finishing'), Packaging: laborFor('Packaging') },
      cbmRow: b.cbm.find(c => c.product_id === p.id) || null,
      qty: Number(p.quantity) || 0,
      buckets, editBuckets, quotes,
      rawVendor: winner?.vendor || '',
      shippingId: shipId,
      shippingName: shipId ? ((shipTypeById.get(shipId) as any)?.name || '—') : '—',
      costInr, priceInr, cur, price,
      cost: cur === 'INR' ? costInr : r.summary.product_cost_per_unit_usd,
      markup: r.markupPercent,
      margin: priceInr > 0 ? (priceInr - costInr) / priceInr : 0,
      indirectInr,
      indirect: indirectInr / rate,
      contribution: priceInr > 0 ? (priceInr - costInr + indirectInr) / priceInr : 0,
      target,
      gap: target ? price - target : null,
      gapPct: target ? (price - target) / target : null,
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
    if (r.gap != null && r.gapPct != null && r.gap > 0.005) {
      r.flags.push({ field: 'target', kind: 'target', msg: `${r.cur === 'INR' ? '₹' : '$'}${r.gap.toFixed(2)} (${(r.gapPct * 100).toFixed(1)}%) over target` });
    }
  }
}

/** Money totals are in the inquiry's quote currency (`cur`). */
export type Totals = {
  cur: QuoteCur;
  skus: number; units: number; cbm: number; fob: number; cost: number; margin: number;
  /** Indirect overhead absorbed by the order, and the contribution rate (net + indirect) / FOB. */
  indirect: number; contribution: number;
  withTarget: number; overTarget: number; targetFob: number; flagged: number;
};

export function totals(rows: WorkspaceRow[], cur: QuoteCur = rows[0]?.cur ?? 'USD'): Totals {
  let units = 0, cbm = 0, fob = 0, cost = 0, indirect = 0, withTarget = 0, overTarget = 0, targetFob = 0, flagged = 0;
  for (const r of rows) {
    units += r.qty; cbm += r.r.finalUnitCbm * r.qty; fob += r.price * r.qty; cost += r.cost * r.qty; indirect += r.indirect * r.qty;
    if (r.target) { withTarget++; targetFob += r.target * r.qty; if ((r.gap ?? 0) > 0.005) overTarget++; }
    if (r.flags.some(f => f.kind !== 'target')) flagged++;
  }
  return { cur, skus: rows.length, units, cbm, fob, cost, margin: fob > 0 ? (fob - cost) / fob : 0,
    indirect, contribution: fob > 0 ? (fob - cost + indirect) / fob : 0, withTarget, overTarget, targetFob, flagged };
}

// ---------- Loading ----------

async function loadRows(ids: string[]) {
  // Paged (PostgREST returns at most 1,000 rows per request) and throws on any error, so a
  // failed or partial load never reaches the engine or gets written back.
  const byProduct = (table: string) => fetchAllByIds<any>(ids, chunk => db.from(table).select('*').in('product_id', chunk).order('id'));
  const [cogs, nu, oh, shipItems, cbm] = await Promise.all([
    byProduct('cogs_items'), byProduct('non_unit_cogs'), byProduct('overhead_items'), byProduct('shipping_items'), byProduct('cbm_estimates'),
  ]);
  return { cogs, nu, oh, shipItems, cbm };
}

async function loadRefs() {
  const [res] = await Promise.all([
    Promise.all([
      db.from('shipping_types').select('*'),
      db.from('labor_employees').select('*'),
      db.from('global_settings').select('*').limit(1).maybeSingle(),
      db.from('product_types').select('*').order('name'),
      db.from('chemical_prices').select('*'),
      db.from('box_data').select('*'),
      db.from('finishing_difficulty').select('*'),
      db.from('local_transport_locations').select('id, name, cost_per_cbm_inr'),
      db.from('raw_material_costs').select('*'),
      db.from('hardware_prices').select('*').order('name'),
    ]),
    loadFobRates(),
  ]);
  const failed = res.find((x: any) => x.error);
  if (failed) throw new Error(failed.error.message);
  const d = res.map((x: any) => x.data || []);
  return {
    shipTypes: d[0], employees: d[1], gs: res[2].data || {}, productTypes: d[3], chemicalPrices: d[4], boxData: d[5],
    difficulties: d[6], locations: d[7], rawMaterialCosts: d[8], hardwarePrices: d[9],
  };
}

export async function loadBundle(inquiryId: string): Promise<Bundle | null> {
  const { data: inq, error } = await db.from('customer_rfqs').select('*').eq('id', inquiryId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!inq) return null;
  const [cust, prods] = await Promise.all([
    inq.customer_id ? db.from('customers').select('id, name, company').eq('id', inq.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('products').select('*').eq('customer_rfq_id', inquiryId).is('archived_at', null)
      .order('sort_order', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }).order('name', { ascending: true }),
  ]);
  if ((prods as any).error) throw new Error((prods as any).error.message);
  const products = (prods.data as any[]) || [];
  const [rows, refs] = await Promise.all([loadRows(products.map(p => p.id)), loadRefs()]);
  return { inq, customer: cust.data, products, ...rows, ...refs };
}

/**
 * Bundle for one product's costing sheet. A product in an inquiry is loaded with its whole
 * inquiry, so FOB shipping is pooled exactly as in the workspace; `inq` is null otherwise.
 */
export async function loadProductBundle(productId: string): Promise<Bundle | null> {
  const { data: product, error } = await db.from('products').select('*').eq('id', productId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!product) return null;
  const b = product.customer_rfq_id ? await loadBundle(product.customer_rfq_id) : null;
  if (b && b.products.some(p => p.id === productId)) return b;
  // Archived, or not in an inquiry: just this product's rows.
  const [rows, refs] = await Promise.all([loadRows([productId]), b ? Promise.resolve(null) : loadRefs()]);
  if (b) {
    return { ...b, products: [...b.products, product], cogs: [...b.cogs, ...rows.cogs], nu: [...b.nu, ...rows.nu],
      oh: [...b.oh, ...rows.oh], shipItems: [...b.shipItems, ...rows.shipItems], cbm: [...b.cbm, ...rows.cbm] };
  }
  return { inq: null, customer: null, products: [product], ...rows, ...refs! };
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

// ----- Labor -----

export function patchOverhead(b: Bundle, id: string, patch: Record<string, any>): Mutation {
  const row = b.oh.find(o => o.id === id);
  return {
    next: { ...b, oh: b.oh.map(o => (o.id === id ? { ...o, ...patch } : o)) },
    touched: row ? [row.product_id] : [],
    commit: async () => { check(await db.from('overhead_items').update(patch).eq('id', id)); },
  };
}

/**
 * Sets the Finishing or Packaging hours of each product: a number makes the row manual at that
 * value; 'auto' hands it back to the running-inch estimate (autoLaborEstimate).
 */
export function setLaborHours(b: Bundle, ids: string[], laborType: 'Finishing' | 'Packaging', value: number | 'auto'): Mutation {
  const patch = value === 'auto' ? { is_auto_estimated: true } : { is_auto_estimated: false, man_hours_per_unit: value };
  const rows = b.oh.filter(o => ids.includes(o.product_id) && o.labor_type === laborType);
  const rowIds = new Set(rows.map(r => r.id));
  return {
    next: { ...b, oh: b.oh.map(o => (rowIds.has(o.id) ? { ...o, ...patch } : o)) },
    touched: [...new Set(rows.map(r => r.product_id))],
    commit: async () => { if (rowIds.size) check(await db.from('overhead_items').update(patch).in('id', [...rowIds])); },
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

export function addNonUnit(b: Bundle, productId: string, name = 'New item'): Mutation {
  const maxSort = b.nu.filter(n => n.product_id === productId).reduce((m, n) => Math.max(m, n.sort_order ?? 0), 0);
  const row = { id: uuid(), product_id: productId, name, include: 'Yes', total_quantity: 1, cost_each_inr: 0, manual_override: false, sort_order: maxSort + 1 };
  return { next: { ...b, nu: [...b.nu, row] }, touched: [productId], commit: async () => { check(await db.from('non_unit_cogs').insert(row)); } };
}

export function deleteNonUnit(b: Bundle, id: string): Mutation {
  const row = b.nu.find(n => n.id === id);
  return { next: { ...b, nu: b.nu.filter(n => n.id !== id) }, touched: row ? [row.product_id] : [], commit: async () => { check(await db.from('non_unit_cogs').delete().eq('id', id)); } };
}

/** Chains mutations, each built on the bundle the previous one produced, into one. */
export function chain(b: Bundle, steps: ((cur: Bundle) => Mutation | null)[]): Mutation {
  let cur = b;
  const commits: (() => Promise<void>)[] = [];
  const touched = new Set<string>();
  for (const step of steps) {
    const m = step(cur);
    if (!m) continue;
    cur = m.next; commits.push(m.commit); m.touched.forEach(t => touched.add(t));
  }
  return { next: cur, touched: [...touched], commit: async () => { for (const c of commits) await c(); } };
}

function ohMutation(b: Bundle, updates: { id: string; patch: any }[]): Mutation {
  const byId = new Map(updates.map(u => [u.id, u.patch]));
  return {
    next: { ...b, oh: b.oh.map(o => (byId.has(o.id) ? { ...o, ...byId.get(o.id) } : o)) },
    touched: [...new Set(b.oh.filter(o => byId.has(o.id)).map(o => o.product_id))],
    commit: async () => { await Promise.all(updates.map(async u => check(await db.from('overhead_items').update(u.patch).eq('id', u.id)))); },
  };
}

function nuMutation(b: Bundle, updates: { id: string; patch: any }[]): Mutation {
  const byId = new Map(updates.map(u => [u.id, u.patch]));
  return {
    next: { ...b, nu: b.nu.map(o => (byId.has(o.id) ? { ...o, ...byId.get(o.id) } : o)) },
    touched: [...new Set(b.nu.filter(o => byId.has(o.id)).map(o => o.product_id))],
    commit: async () => { await Promise.all(updates.map(async u => check(await db.from('non_unit_cogs').update(u.patch).eq('id', u.id)))); },
  };
}

const lc = (s: any) => String(s || '').toLowerCase();
const nextSort = (b: Bundle, pid: string) => b.cogs.filter(c => c.product_id === pid).reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0) + 1;
const autoLine = (pid: string, sort: number, extra: Record<string, any>) => ({
  id: uuid(), product_id: pid, include: 'Yes', components_per_product: 0, unit_cost_inr: 0, waste_factor: 0,
  is_auto_calculated: true, vendor_name: null, chemical_price_id: null, sort_order: sort, created_at: new Date().toISOString(), ...extra,
});

/** Which packaging lines a packaging type uses (null = not a packaging line this rule knows). */
export function packagingIncludeForType(pkg: string, componentName: string): boolean | null {
  const n = lc(componentName);
  if (pkg === 'no_packaging') return false;
  if (n.includes('ic box') || n.includes('inner carton') || n === 'ic') return pkg === 'ic_only' || pkg === 'ic_mc';
  if (n.includes('mc box') || n.includes('master carton') || n.includes('outer carton')) return pkg === 'ic_mc' || pkg === 'bulk_pack';
  if (n.includes('foam') || n.includes('bulk pack')) return pkg === 'bulk_pack';
  return null;
}

/**
 * Packaging type: switches the packaging lines on/off to match, turns packaging labor off for
 * "No packaging".
 */
export function setPackagingType(b: Bundle, ids: string[], pkg: string): Mutation {
  return chain(b, [
    cur => patchProductsSame(cur, ids, { packaging_type: pkg }),
    cur => patchCbm(cur, ids, { include_mc: pkg === 'ic_mc' }),
    cur => {
      const updates: { id: string; patch: any }[] = [];
      for (const pid of ids) {
        const lines = cur.cogs.filter(c => c.product_id === pid && c.cogs_type === 'Packaging');
        for (const l of lines) {
          const on = packagingIncludeForType(pkg, l.component_name);
          if (on != null && (l.include === 'No') === on) updates.push({ id: l.id, patch: { include: on ? 'Yes' : 'No' } });
        }
      }
      return updates.length ? cogsMutation(cur, updates, []) : null;
    },
    cur => (pkg === 'no_packaging'
      ? ohMutation(cur, cur.oh.filter(o => ids.includes(o.product_id) && o.labor_type === 'Packaging')
        .map(o => ({ id: o.id, patch: { include: 'No', man_hours_per_unit: 0 } })))
      : null),
  ]);
}

const isOutsourcedType = (b: Bundle, typeId: string | null) => lc(b.productTypes.find(t => t.id === typeId)?.name) === 'outsourced';

/**
 * Bought-in finished product: every other cost line and labor row is switched off and a single
 * "Outsourced Product" line holds the purchased cost (kept editable, so extras can be re-enabled).
 */
function makeOutsourced(b: Bundle, ids: string[]): Mutation {
  return chain(b, [
    cur => {
      const updates: { id: string; patch: any }[] = [];
      const inserts: any[] = [];
      for (const pid of ids) {
        const p = cur.products.find(x => x.id === pid);
        const mine = cur.cogs.filter(c => c.product_id === pid);
        const row = mine.find(c => lc(c.component_name) === lc(OUTSOURCED_COGS_NAME));
        mine.filter(c => c !== row && c.include !== 'No').forEach(c => updates.push({ id: c.id, patch: { include: 'No' } }));
        if (row) { if (row.include !== 'Yes') updates.push({ id: row.id, patch: { include: 'Yes' } }); }
        else inserts.push({ ...autoLine(pid, nextSort(cur, pid), { cogs_type: 'Other', component_name: OUTSOURCED_COGS_NAME }),
          is_auto_calculated: false, components_per_product: 1, unit_cost_inr: Number(p?.outsourced_unit_cost_inr) || 0 });
      }
      return cogsMutation(cur, updates, inserts);
    },
    cur => nuMutation(cur, cur.nu.filter(n => ids.includes(n.product_id) && n.include !== 'No').map(n => ({ id: n.id, patch: { include: 'No' } }))),
    cur => ohMutation(cur, cur.oh.filter(o => ids.includes(o.product_id) && o.include !== 'No').map(o => ({ id: o.id, patch: { include: 'No' } }))),
    // The cost now lives on the line, so the legacy product-level field is cleared.
    cur => patchProductsSame(cur, ids, { outsourced_unit_cost_inr: null, outsourced_unit_cost_usd: null }),
  ]);
}

export function setProductType(b: Bundle, ids: string[], typeId: string | null): Mutation {
  const becoming = isOutsourcedType(b, typeId)
    ? ids.filter(id => !isOutsourcedType(b, b.products.find(p => p.id === id)?.product_type_id ?? null)) : [];
  return chain(b, [
    cur => patchProductsSame(cur, ids, { product_type_id: typeId }),
    cur => (becoming.length ? makeOutsourced(cur, becoming) : null),
  ]);
}

export function setOutsourced(b: Bundle, ids: string[], on: boolean): Mutation {
  const becoming = on ? ids.filter(id => !b.products.find(p => p.id === id)?.is_outsourced) : [];
  return chain(b, [
    cur => patchProductsSame(cur, ids, { is_outsourced: on }),
    cur => (becoming.length ? makeOutsourced(cur, becoming) : null),
  ]);
}

const finishCat = (b: Bundle, line: any): string => {
  const linked = b.chemicalPrices.find((c: any) => c.id === line.chemical_price_id);
  if (linked?.category) return lc(linked.category);
  const n = lc(line.component_name);
  if (n.includes('color') || n.includes('stain')) return 'color';
  if (n.includes('sealer')) return 'sealer';
  if (n.includes('lacquer')) return 'lacquer';
  if (n.includes('wax')) return 'wax';
  return '';
};

/**
 * Finish difficulty: finishing labor goes back to the estimate for the new difficulty. "Wax"
 * swaps color, sealer and lacquer for a wax line (added if missing); leaving Wax swaps back.
 */
export function setDifficulty(b: Bundle, ids: string[], difficulty: string): Mutation {
  const waxChem = b.chemicalPrices.find((c: any) => c.category === 'Wax');
  return chain(b, [
    cur => patchProductsSame(cur, ids, { finishing_difficulty: difficulty }),
    cur => ohMutation(cur, cur.oh.filter(o => ids.includes(o.product_id) && o.labor_type === 'Finishing' && !o.is_auto_estimated)
      .map(o => ({ id: o.id, patch: { is_auto_estimated: true } }))),
    cur => {
      const updates: { id: string; patch: any }[] = [];
      const inserts: any[] = [];
      for (const pid of ids) {
        const was = b.products.find(p => p.id === pid)?.finishing_difficulty;
        const goingWax = difficulty === 'Wax' && was !== 'Wax';
        const leavingWax = was === 'Wax' && difficulty !== 'Wax';
        if (!goingWax && !leavingWax) continue;
        const finishing = cur.cogs.filter(c => c.product_id === pid && c.cogs_type === 'Finishing Materials');
        for (const l of finishing) {
          const cat = finishCat(cur, l);
          if (cat === 'color' || cat === 'sealer' || cat === 'lacquer') updates.push({ id: l.id, patch: { include: goingWax ? 'No' : 'Yes' } });
          else if (cat === 'wax') updates.push({ id: l.id, patch: { include: goingWax ? 'Yes' : 'No', is_auto_calculated: true,
            ...(goingWax && !l.chemical_price_id && waxChem ? { chemical_price_id: waxChem.id } : {}) } });
        }
        if (goingWax && waxChem && !finishing.some(l => finishCat(cur, l) === 'wax')) {
          inserts.push(autoLine(pid, nextSort(cur, pid), { cogs_type: 'Finishing Materials', component_name: waxChem.name,
            chemical_price_id: waxChem.id, units: waxChem.unit_type || 'g' }));
        }
      }
      return updates.length || inserts.length ? cogsMutation(cur, updates, inserts) : null;
    },
  ]);
}

export const DOMESTIC_FREIGHT = 'Domestic Freight (External Sourcing)';

/** Source location: an outside source adds the domestic freight line; back to in-house removes it. */
export function setSourceLocation(b: Bundle, ids: string[], locationId: string | null): Mutation {
  return chain(b, [
    cur => patchProductsSame(cur, ids, { source_location_id: locationId }),
    cur => {
      if (!locationId) {
        const del = cur.cogs.filter(c => ids.includes(c.product_id) && c.component_name === DOMESTIC_FREIGHT).map(c => c.id);
        return del.length ? cogsMutation(cur, [], [], del) : null;
      }
      const inserts = ids.filter(pid => !cur.cogs.some(c => c.product_id === pid && c.component_name === DOMESTIC_FREIGHT))
        .map(pid => autoLine(pid, nextSort(cur, pid), { cogs_type: 'Subcontracting', component_name: DOMESTIC_FREIGHT, units: 'CBM' }));
      return inserts.length ? cogsMutation(cur, [], inserts) : null;
    },
  ]);
}

/** Shipping type for each product (one shipping row per product). */
export function setShippingType(b: Bundle, ids: string[], shippingTypeId: string): Mutation {
  const existing = new Set(b.shipItems.filter(s => ids.includes(s.product_id)).map(s => s.product_id));
  const inserts = ids.filter(id => !existing.has(id)).map(pid => ({ id: uuid(), product_id: pid, shipping_type_id: shippingTypeId }));
  return {
    next: { ...b, shipItems: [...b.shipItems.map(s => (ids.includes(s.product_id) ? { ...s, shipping_type_id: shippingTypeId } : s)), ...inserts] },
    touched: ids,
    commit: async () => {
      if (existing.size) check(await db.from('shipping_items').update({ shipping_type_id: shippingTypeId }).in('product_id', [...existing]));
      if (inserts.length) check(await db.from('shipping_items').insert(inserts));
    },
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
  for (const r of rows) if (ids.includes(r.p.id)) patches[r.p.id] = targetPatch(r.p, r.cur, Math.round(r.price * 100) / 100, r.r.exchangeRate || 0);
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

/**
 * "Target this line": the ₹ each that brings the product's price onto its target when only
 * this line's price changes (quantity, waste and NPM held). Each ₹ of line cost carries the
 * cost-of-capital charge, so the needed cut is divided by (1 + capital factor). Null when
 * there's no target or the line alone can't get there.
 */
export function targetLineEach(row: WorkspaceRow, line: any): number | null {
  if (row.maxCostInr == null || line.include === 'No') return null;
  const per = lineValue({ ...line, include: 'Yes', unit_cost_inr: 1 });
  const want = lineValue({ ...line, include: 'Yes' }) - (row.costInr - row.maxCostInr) / (1 + (row.r.capitalFactor || 0));
  return per > 0 && want > 0 ? want / per : null;
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
