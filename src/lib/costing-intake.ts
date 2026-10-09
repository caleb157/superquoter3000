// Costing Intake template: one row per SKU covering every editable input on the
// costing sheet. Used by "Import products" (create) and the Bulk Costing Editor
// (update by SKU / name). Writes raw inputs only — every derived number is
// recomputed by the costing engine, so nothing here duplicates costing math.
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

type ColType = 'text' | 'num' | 'pct' | 'bool';
export type IntakeCol = { key: string; header: string; type: ColType; group: string; help: string; example?: any };

// Cost columns map 1:1 to a COGS category; one "Intake" row is written per category.
export const COST_COLS: { key: string; cogsType: string; header: string }[] = [
  { key: 'raw_piece_inr', cogsType: 'Raw Piece', header: 'Raw piece ₹' },
  { key: 'subcontract_inr', cogsType: 'Subcontracting', header: 'Subcontract ₹' },
  { key: 'inserts_instructions_inr', cogsType: 'Inserts + Instructions', header: 'Inserts + instructions ₹' },
  { key: 'handles_knobs_inr', cogsType: 'Handles + Knobs', header: 'Handles + knobs ₹' },
  { key: 'feet_buffers_inr', cogsType: 'Feet/Buffers', header: 'Feet / buffers ₹' },
  { key: 'handles_latches_inr', cogsType: 'Handles/Latches', header: 'Handles / latches ₹' },
  { key: 'other_hardware_inr', cogsType: 'Other Hardware', header: 'Other hardware ₹' },
  { key: 'accessories_inr', cogsType: 'Accessories', header: 'Accessories ₹' },
  { key: 'finishing_materials_inr', cogsType: 'Finishing Materials', header: 'Finishing materials ₹' },
  { key: 'packaging_materials_inr', cogsType: 'Packaging', header: 'Packaging materials ₹' },
  { key: 'components_inr', cogsType: 'Components', header: 'Components ₹' },
  { key: 'other_cogs_inr', cogsType: 'Other', header: 'Other COGS ₹' },
];

export const LABOR_COLS: { key: string; laborType: string }[] = [
  { key: 'mh_manufacturing', laborType: 'Manufacturing' },
  { key: 'mh_finishing', laborType: 'Finishing' },
  { key: 'mh_assembly', laborType: 'Assembly' },
  { key: 'mh_packaging', laborType: 'Packaging' },
  { key: 'mh_qc', laborType: 'QC' },
  { key: 'mh_market', laborType: 'Market' },
];

export const INTAKE_COLS: IntakeCol[] = [
  { key: 'sku', header: 'SKU', type: 'text', group: 'Product', help: 'Match key for updates', example: 'CCT-AT3335' },
  { key: 'name', header: 'Product name', type: 'text', group: 'Product', help: 'Required for new products', example: 'Accent Table 33x35' },
  { key: 'product_type', header: 'Product type', type: 'text', group: 'Product', help: 'Exact product type name', example: 'Wood Side/End Table' },
  { key: 'quantity', header: 'Quantity', type: 'num', group: 'Product', help: 'Order quantity', example: 200 },
  { key: 'moq', header: 'MOQ', type: 'num', group: 'Product', help: 'Minimum order qty', example: 50 },
  { key: 'target_price_usd', header: 'Target price', type: 'num', group: 'Product', help: 'In quoting currency', example: 145 },
  { key: 'source_location', header: 'Source location', type: 'text', group: 'Product', help: 'Local transport location name', example: 'Jodhpur' },
  { key: 'finishing_difficulty', header: 'Finishing difficulty', type: 'text', group: 'Product', help: 'Very Easy / Easy / Medium / Hard / Very Hard / Wax', example: 'Medium' },
  { key: 'percent_wood', header: '% wood', type: 'pct', group: 'Product', help: '0–100', example: 100 },
  { key: 'is_component', header: 'Is component', type: 'bool', group: 'Product', help: 'Yes / No', example: 'No' },
  { key: 'notes', header: 'Notes', type: 'text', group: 'Product', help: 'Free text', example: '' },

  { key: 'width_inch', header: 'Piece W (in)', type: 'num', group: 'Piece size', help: 'Inches', example: 33 },
  { key: 'depth_inch', header: 'Piece D (in)', type: 'num', group: 'Piece size', help: 'Inches', example: 35 },
  { key: 'height_inch', header: 'Piece H (in)', type: 'num', group: 'Piece size', help: 'Inches', example: 24 },
  { key: 'weight_kg', header: 'Weight (kg)', type: 'num', group: 'Piece size', help: 'Net kg', example: 12 },

  { key: 'packaging_type', header: 'Packaging type', type: 'text', group: 'Packaging', help: 'ic_only / ic_mc / corrugate_bubble / bulk_pack / no_packaging', example: 'ic_mc' },
  { key: 'ic_type', header: 'Inner box ply', type: 'text', group: 'Packaging', help: 'e.g. 5 ply, 7 ply', example: '7 ply' },
  { key: 'products_per_ic', header: 'Units per inner box', type: 'num', group: 'Packaging', help: 'Default 1', example: 1 },
  { key: 'ic_width', header: 'Box W (in)', type: 'num', group: 'Packaging', help: 'Inner box ID; blank = auto from piece', example: 34 },
  { key: 'ic_depth', header: 'Box D (in)', type: 'num', group: 'Packaging', help: 'Inner box ID', example: 36 },
  { key: 'ic_height', header: 'Box H (in)', type: 'num', group: 'Packaging', help: 'Inner box ID', example: 25 },
  { key: 'include_mc', header: 'Master carton', type: 'bool', group: 'Packaging', help: 'Yes / No', example: 'No' },
  { key: 'bulk_pieces_per_box', header: 'Bulk pieces per box', type: 'num', group: 'Packaging', help: 'Bulk pack only', example: '' },

  ...COST_COLS.map(c => ({ key: c.key, header: c.header, type: 'num' as ColType, group: 'COGS (₹ per unit)', help: `${c.cogsType}; blank = leave as is`, example: c.key === 'raw_piece_inr' ? 2400 : c.key === 'other_hardware_inr' ? 120 : '' })),
  { key: 'raw_vendor', header: 'Raw vendor', type: 'text', group: 'COGS (₹ per unit)', help: 'Vendor on the raw piece row', example: '' },
  { key: 'is_outsourced', header: 'Outsourced', type: 'bool', group: 'COGS (₹ per unit)', help: 'Bought finished? Yes / No', example: 'No' },
  { key: 'outsourced_unit_cost_inr', header: 'Outsourced cost ₹', type: 'num', group: 'COGS (₹ per unit)', help: 'Purchase price per unit', example: '' },

  ...LABOR_COLS.map(l => ({ key: l.key, header: `${l.laborType} hrs`, type: 'num' as ColType, group: 'Labor (man-hours per unit)', help: 'Blank = keep / auto', example: l.key === 'mh_manufacturing' ? 3.5 : '' })),

  { key: 'shipping_type', header: 'Shipping type', type: 'text', group: 'Pricing', help: 'Exact shipping type name', example: '' },
  { key: 'markup_pct', header: 'NPM / markup %', type: 'pct', group: 'Pricing', help: 'e.g. 22', example: 22 },
  { key: 'cost_of_capital', header: 'Cost of capital', type: 'bool', group: 'Pricing', help: 'Yes / No', example: '' },
  { key: 'coc_monthly_rate', header: 'CoC rate %/mo', type: 'num', group: 'Pricing', help: 'e.g. 1.5', example: '' },
  { key: 'coc_months', header: 'CoC months', type: 'num', group: 'Pricing', help: 'e.g. 3', example: '' },
];

export type IntakeRow = Record<string, any> & { _row: number };

const norm = (s: any) => String(s ?? '').toLowerCase().replace(/₹/g, 'inr').replace(/[^a-z0-9]+/g, '');
const HEADER_LOOKUP = new Map<string, string>();
for (const c of INTAKE_COLS) { HEADER_LOOKUP.set(norm(c.header), c.key); HEADER_LOOKUP.set(norm(c.key), c.key); }
HEADER_LOOKUP.set('productname', 'name'); HEADER_LOOKUP.set('npm', 'markup_pct'); HEADER_LOOKUP.set('markup', 'markup_pct');

function toNum(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[,\s$₹%]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function toBool(v: any): boolean | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (['yes', 'y', 'true', '1', 'x'].includes(s)) return true;
  if (['no', 'n', 'false', '0'].includes(s)) return false;
  return null;
}
const toPct = (v: any) => { const n = toNum(v); return n == null ? null : (n > 1 ? n / 100 : n); };

export function downloadIntakeTemplate(rows?: Record<string, any>[], fileName = 'costing-intake-template.xlsx') {
  const header = INTAKE_COLS.map(c => c.header);
  const data = rows && rows.length
    ? rows.map(r => INTAKE_COLS.map(c => r[c.key] ?? ''))
    : [INTAKE_COLS.map(c => c.example ?? '')];
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws['!cols'] = INTAKE_COLS.map(c => ({ wch: Math.max(12, c.header.length + 2) }));
  ws['!freeze'] = { xSplit: 2, ySplit: 1 } as any;
  const guide = XLSX.utils.aoa_to_sheet([
    ['Column', 'Section', 'How to fill'],
    ...INTAKE_COLS.map(c => [c.header, c.group, c.help]),
    [],
    ['Rules', '', 'Blank cells leave the current value unchanged. A ₹ cost replaces that category\'s rows with one line at that cost (auto finishing / box rows are switched off when you enter finishing or packaging ₹). Prices, CBM and FOB are recalculated by the app.'],
  ]);
  guide['!cols'] = [{ wch: 26 }, { wch: 26 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Costing Intake');
  XLSX.utils.book_append_sheet(wb, guide, 'Guide');
  XLSX.writeFile(wb, fileName);
}

/** Returns rows if the file is a Costing Intake sheet, otherwise null. */
export async function parseIntakeFile(file: File): Promise<IntakeRow[] | null> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  for (const sheetName of wb.SheetNames) {
    if (/guide/i.test(sheetName)) continue;
    const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
    for (let h = 0; h < Math.min(aoa.length, 5); h++) {
      const map: Record<number, string> = {};
      (aoa[h] || []).forEach((cell, i) => { const k = HEADER_LOOKUP.get(norm(cell)); if (k) map[i] = k; });
      const keys = Object.values(map);
      const costish = keys.filter(k => COST_COLS.some(c => c.key === k) || k.startsWith('mh_') || k === 'ic_width' || k === 'markup_pct').length;
      if (!(keys.includes('sku') || keys.includes('name')) || costish < 2) continue;
      const out: IntakeRow[] = [];
      for (let r = h + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.every(c => c === null || c === '')) continue;
        const o: IntakeRow = { _row: r + 1 };
        for (const [iStr, key] of Object.entries(map)) {
          const v = row[Number(iStr)];
          const col = INTAKE_COLS.find(c => c.key === key)!;
          const val = col.type === 'num' ? toNum(v) : col.type === 'pct' ? toPct(v) : col.type === 'bool' ? toBool(v) : (v == null || v === '' ? null : String(v).trim());
          if (val !== null) o[key] = val;
        }
        if (o.sku || o.name) out.push(o);
      }
      return out;
    }
  }
  return null;
}

type Lookups = { productTypes: any[]; shippingTypes: any[]; locations: any[]; mcHeightBuffer: number };
async function loadLookups(): Promise<Lookups> {
  const [pt, st, loc] = await Promise.all([
    db.from('product_types').select('id, name'),
    db.from('shipping_types').select('id, name'),
    db.from('local_transport_locations').select('id, name'),
  ]);
  const { getCachedMcHeightBuffer } = await import('@/lib/product-defaults');
  return { productTypes: pt.data || [], shippingTypes: st.data || [], locations: loc.data || [], mcHeightBuffer: await getCachedMcHeightBuffer() };
}
const byName = (list: any[], name?: string) => name ? list.find(x => (x.name || '').toLowerCase().trim() === name.toLowerCase().trim()) : undefined;

export type ApplyResult = { created: number; updated: number; warnings: string[] };

async function scaffoldProduct(inquiryId: string, row: IntakeRow, sort: number, L: Lookups) {
  const { data: prod, error } = await db.from('products').insert({
    customer_rfq_id: inquiryId, name: row.name || row.sku, sku: row.sku || null,
    quantity: row.quantity ?? 100, finishing_difficulty: 'Medium', percent_wood: 1, sort_order: sort,
  }).select().single();
  if (error) throw new Error(error.message);
  const id = prod.id;
  await Promise.all([
    db.from('cogs_items').insert([
      { product_id: id, cogs_type: 'Finishing Materials', component_name: 'Color', is_auto_calculated: true, sort_order: 4 },
      { product_id: id, cogs_type: 'Finishing Materials', component_name: 'Sealer', is_auto_calculated: true, sort_order: 5 },
      { product_id: id, cogs_type: 'Finishing Materials', component_name: 'Lacquer', is_auto_calculated: true, sort_order: 6 },
      { product_id: id, cogs_type: 'Packaging', component_name: 'IC Box', is_auto_calculated: true, waste_factor: 0.05, sort_order: 7 },
      { product_id: id, cogs_type: 'Packaging', component_name: 'MC Box', is_auto_calculated: true, sort_order: 8 },
    ]),
    db.from('overhead_items').insert([
      { product_id: id, labor_type: 'Manufacturing', sort_order: 0 },
      { product_id: id, labor_type: 'QC', man_hours_per_unit: 0.05, sort_order: 1 },
      { product_id: id, labor_type: 'Finishing', is_auto_estimated: true, sort_order: 3 },
      { product_id: id, labor_type: 'Assembly', sort_order: 4 },
      { product_id: id, labor_type: 'Packaging', is_auto_estimated: true, sort_order: 5 },
      { product_id: id, labor_type: 'Market', sort_order: 6 },
    ]),
    db.from('cbm_estimates').insert({ product_id: id, mc_height_buffer_inch: L.mcHeightBuffer }),
    db.from('non_unit_cogs').insert({ product_id: id, name: 'Auto Transport', total_quantity: 1, cost_each_inr: 0, include: 'Yes', sort_order: 0 }),
  ]);
  return id as string;
}

async function applyRow(productId: string, row: IntakeRow, L: Lookups, warn: (m: string) => void) {
  const label = row.sku || row.name || `row ${row._row}`;
  // --- products ---
  const p: any = {};
  for (const k of ['name', 'sku', 'quantity', 'moq', 'target_price_usd', 'finishing_difficulty', 'percent_wood', 'is_component', 'notes',
    'width_inch', 'depth_inch', 'height_inch', 'weight_kg', 'packaging_type', 'bulk_pieces_per_box', 'is_outsourced', 'outsourced_unit_cost_inr']) {
    if (row[k] !== undefined) p[k] = row[k];
  }
  if (row.markup_pct !== undefined) p.markup_percent = row.markup_pct;
  if (row.cost_of_capital !== undefined) p.cost_of_capital_enabled = row.cost_of_capital;
  if (row.coc_monthly_rate !== undefined) p.cost_of_capital_monthly_rate = row.coc_monthly_rate;
  if (row.coc_months !== undefined) p.cost_of_capital_months = row.coc_months;
  if (row.product_type) { const t = byName(L.productTypes, row.product_type); if (t) p.product_type_id = t.id; else warn(`${label}: product type "${row.product_type}" not found`); }
  if (row.source_location) { const l = byName(L.locations, row.source_location); if (l) p.source_location_id = l.id; else warn(`${label}: location "${row.source_location}" not found`); }
  if (Object.keys(p).length) { const { error } = await db.from('products').update(p).eq('id', productId); if (error) warn(`${label}: ${error.message}`); }

  // --- packaging dims ---
  const c: any = {};
  for (const k of ['ic_type', 'products_per_ic', 'ic_width', 'ic_depth', 'ic_height', 'include_mc']) if (row[k] !== undefined) c[k] = row[k];
  if (Object.keys(c).length) {
    const { data: ex } = await db.from('cbm_estimates').select('id').eq('product_id', productId).maybeSingle();
    if (ex) await db.from('cbm_estimates').update(c).eq('id', ex.id);
    else await db.from('cbm_estimates').insert({ product_id: productId, mc_height_buffer_inch: L.mcHeightBuffer, ...c });
  }

  // --- COGS: one intake line per category ---
  for (const cc of COST_COLS) {
    const v = row[cc.key];
    if (v === undefined) continue;
    await db.from('cogs_items').delete().eq('product_id', productId).eq('cogs_type', cc.cogsType).eq('is_auto_calculated', false);
    if (cc.cogsType === 'Finishing Materials' || cc.cogsType === 'Packaging') {
      await db.from('cogs_items').update({ include: v > 0 ? 'No' : 'Yes' }).eq('product_id', productId).eq('cogs_type', cc.cogsType).eq('is_auto_calculated', true);
    }
    if (v > 0) {
      await db.from('cogs_items').insert({
        product_id: productId, cogs_type: cc.cogsType, component_name: cc.cogsType === 'Raw Piece' ? 'Raw Piece' : `${cc.cogsType} (intake)`,
        components_per_product: 1, unit_cost_inr: v, units: 'pc', waste_factor: 0, include: 'Yes', is_auto_calculated: false,
        vendor_name: cc.cogsType === 'Raw Piece' ? (row.raw_vendor ?? null) : null, sort_order: COST_COLS.indexOf(cc),
      });
    }
  }
  if (row.raw_vendor !== undefined && row.raw_piece_inr === undefined) {
    await db.from('cogs_items').update({ vendor_name: row.raw_vendor }).eq('product_id', productId).eq('cogs_type', 'Raw Piece');
  }

  // --- Labor ---
  for (const lc of LABOR_COLS) {
    const v = row[lc.key];
    if (v === undefined) continue;
    const { data: ex } = await db.from('overhead_items').select('id').eq('product_id', productId).eq('labor_type', lc.laborType).limit(1);
    if (ex?.length) await db.from('overhead_items').update({ man_hours_per_unit: v, is_auto_estimated: false, include: 'Yes' }).eq('id', ex[0].id);
    else await db.from('overhead_items').insert({ product_id: productId, labor_type: lc.laborType, man_hours_per_unit: v, include: 'Yes', sort_order: LABOR_COLS.indexOf(lc) });
  }

  // --- Shipping ---
  if (row.shipping_type) {
    const st = byName(L.shippingTypes, row.shipping_type);
    if (!st) warn(`${label}: shipping type "${row.shipping_type}" not found`);
    else {
      const { data: ex } = await db.from('shipping_items').select('id').eq('product_id', productId).limit(1);
      if (ex?.length) await db.from('shipping_items').update({ shipping_type_id: st.id }).eq('id', ex[0].id);
      else await db.from('shipping_items').insert({ product_id: productId, shipping_type_id: st.id });
    }
  }
}

/**
 * Apply intake rows to an inquiry. Rows match existing products by SKU, then name.
 * Unmatched rows are created when `createMissing` is true.
 */
export async function applyIntake(
  inquiryId: string, rows: IntakeRow[], opts: { createMissing: boolean; updateExisting: boolean; onProgress?: (done: number, total: number) => void },
): Promise<ApplyResult> {
  const L = await loadLookups();
  const { data: existing } = await db.from('products').select('id, sku, name, sort_order').eq('customer_rfq_id', inquiryId).is('archived_at', null);
  const prods: any[] = existing || [];
  let sort = prods.reduce((m, p) => Math.max(m, p.sort_order ?? 0), 0) + 1;
  const res: ApplyResult = { created: 0, updated: 0, warnings: [] };
  const warn = (m: string) => res.warnings.push(m);
  const ids: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const match = matchProduct(prods, row);
    try {
      if (match) {
        if (!opts.updateExisting) continue;
        await applyRow(match.id, row, L, warn); res.updated++; ids.push(match.id);
      } else if (opts.createMissing) {
        if (!row.name && !row.sku) continue;
        const id = await scaffoldProduct(inquiryId, row, sort++, L);
        await applyRow(id, row, L, warn); res.created++; ids.push(id);
      }
    } catch (e: any) { warn(`${row.sku || row.name}: ${e.message}`); }
    opts.onProgress?.(i + 1, rows.length);
  }
  // Recompute and persist packaged CBM / cached prices through the shared engine.
  if (ids.length) {
    try { const { computeProductPriceAndCost } = await import('@/lib/product-pricing'); await computeProductPriceAndCost(ids); } catch { /* self-heals on open */ }
  }
  return res;
}

export function matchProduct(prods: any[], row: IntakeRow) {
  const sku = (row.sku || '').toLowerCase().trim();
  const name = (row.name || '').toLowerCase().trim();
  return (sku && prods.find(p => (p.sku || '').toLowerCase().trim() === sku))
    || (name && prods.find(p => (p.name || '').toLowerCase().trim() === name)) || null;
}
