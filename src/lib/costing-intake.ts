// Costing Intake template: one row per SKU covering every editable input on the
// costing sheet. Used by "Import products" (create) and the Bulk Costing Editor
// (update by SKU / name). Writes raw inputs only — every derived number is
// recomputed by the costing engine, so nothing here duplicates costing math.
import { loadXlsx } from '@/lib/xlsx-lazy';
import { supabase } from '@/integrations/supabase/client';
import { invalidateLiveCosts } from '@/lib/live-cost-cache';
import {
  COST_COLS, SLOTS, CHEM_COLS, INTAKE_COLS, HEADER_LOOKUP, norm, intakeCell,
  loadIntakeLookups, applyRow, applyIntakeRows,
  type IntakeRow, type ApplyResult, type Lookups,
} from '@/lib/costing-intake-core';

// The column list and the database writes live in costing-intake-core.ts, shared with the PD HQ connector.
export * from '@/lib/costing-intake-core';

const db = supabase as any;

export async function downloadIntakeTemplate(rows?: Record<string, any>[], fileName = 'costing-intake-template.xlsx') {
  const header = INTAKE_COLS.map(c => c.header);
  const data = rows && rows.length
    ? rows.map(r => INTAKE_COLS.map(c => r[c.key] ?? ''))
    : [INTAKE_COLS.map(c => c.example ?? '')];
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws['!cols'] = INTAKE_COLS.map(c => ({ wch: Math.max(12, c.header.length + 2) }));
  ws['!freeze'] = { xSplit: 2, ySplit: 1 } as any;
  const guide = XLSX.utils.aoa_to_sheet([
    ['Column', 'Section', 'How to fill'],
    ...INTAKE_COLS.map(c => [c.header, c.group, c.help]),
    [],
    ['Rules', '', 'Blank cells leave the current value unchanged. A category ₹ total or any named line item replaces that category\'s manual rows. Named line items (e.g. Handle 1 name = 5" Gold Handle, qty 2, ₹ 150) each become their own row. Color/Sealer/Lacquer (L) set liters per unit at the library price. Auto finishing / box rows are switched off when you enter a finishing or packaging ₹ total. Prices, CBM and FOB are recalculated by the app.'],
  ]);
  guide['!cols'] = [{ wch: 26 }, { wch: 26 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Costing Intake');
  XLSX.utils.book_append_sheet(wb, guide, 'Guide');
  XLSX.writeFile(wb, fileName);
}

/** Returns rows if the file is a Costing Intake sheet, otherwise null. */
export async function parseIntakeFile(file: File): Promise<IntakeRow[] | null> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  for (const sheetName of wb.SheetNames) {
    if (/guide/i.test(sheetName)) continue;
    const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null });
    for (let h = 0; h < Math.min(aoa.length, 5); h++) {
      const map: Record<number, string> = {};
      (aoa[h] || []).forEach((cell, i) => { const k = HEADER_LOOKUP.get(norm(cell)); if (k) map[i] = k; });
      const keys = Object.values(map);
      const costish = keys.filter(k => COST_COLS.some(c => c.key === k) || k.startsWith('mh_') || SLOTS.some(sl => sl.costKey === k) || CHEM_COLS.some(c => c.key === k) || k === 'ic_width' || k === 'markup_pct').length;
      if (!(keys.includes('sku') || keys.includes('name')) || costish < 2) continue;
      const out: IntakeRow[] = [];
      for (let r = h + 1; r < aoa.length; r++) {
        const row = aoa[r];
        if (!row || row.every(c => c === null || c === '')) continue;
        const o: IntakeRow = { _row: r + 1 };
        for (const [iStr, key] of Object.entries(map)) {
          const v = row[Number(iStr)];
          const val = intakeCell(key, v);
          if (val !== null) o[key] = val;
        }
        if (o.sku || o.name) out.push(o);
      }
      return out;
    }
  }
  return null;
}

async function loadLookups(): Promise<Lookups> {
  const { getCachedMcHeightBuffer } = await import('@/lib/product-defaults');
  return loadIntakeLookups(db, await getCachedMcHeightBuffer());
}

/**
 * Apply intake rows to an inquiry. Rows match existing products by SKU, then name.
 * Unmatched rows are created when `createMissing` is true.
 */
export async function applyIntake(
  inquiryId: string, rows: IntakeRow[], opts: { createMissing: boolean; updateExisting: boolean; onProgress?: (done: number, total: number) => void },
): Promise<ApplyResult> {
  const { ids, ...res } = await applyIntakeRows(db, inquiryId, rows, await loadLookups(), opts);
  // Recompute and persist packaged CBM / cached prices through the shared engine.
  if (ids.length) {
    invalidateLiveCosts();
    try { const { computeProductPriceAndCost } = await import('@/lib/product-pricing'); await computeProductPriceAndCost(ids); } catch { /* self-heals on open */ }
  }
  return res;
}

/** Apply one row to a product that already exists (e.g. one just created), then recompute its cached price. */
export async function applyIntakeToProduct(productId: string, row: IntakeRow): Promise<string[]> {
  const L = await loadLookups();
  const warnings: string[] = [];
  await applyRow(db, productId, row, L, m => warnings.push(m));
  invalidateLiveCosts();
  try { const { computeProductPriceAndCost } = await import('@/lib/product-pricing'); await computeProductPriceAndCost([productId]); } catch { /* self-heals on open */ }
  return warnings;
}

/** Serialize a product's existing manual COGS rows into intake columns (round-trip export). */
export function cogsToIntake(r: Record<string, any>, mine: any[], chems: any[] = []) {
  const lineCost = (x: any) => (Number(x.components_per_product) || 0) * (Number(x.unit_cost_inr) || 0) * (1 + (Number(x.waste_factor) || 0));
  const round = (n: number) => Math.round(n * 100) / 100;
  const manual = mine.filter(x => x.include !== 'No' && !x.is_auto_calculated);
  for (const c of CHEM_COLS) {
    const x = mine.find(y => y.cogs_type === 'Finishing Materials' && !y.is_auto_calculated && (y.component_name || '').toLowerCase().includes(c.name.toLowerCase()));
    if (x) r[c.key] = x.include === 'No' ? 0 : x.components_per_product;
    const any = x || mine.find(y => y.cogs_type === 'Finishing Materials' && (y.component_name || '').toLowerCase().includes(c.name.toLowerCase()));
    const linked = any?.chemical_price_id ? chems.find(ch => ch.id === any.chemical_price_id) : null;
    if (linked) r[`${c.key}_chem`] = linked.name;
  }
  for (const cc of COST_COLS) {
    let lines = manual.filter(x => x.cogs_type === cc.cogsType);
    if (cc.cogsType === 'Finishing Materials') lines = lines.filter(x => !CHEM_COLS.some(c => (x.component_name || '').toLowerCase().includes(c.name.toLowerCase())));
    const slots = SLOTS.filter(sl => sl.cogsType === cc.cogsType);
    const named = lines.slice(0, slots.length);
    if (slots.length) {
      named.forEach((x, i) => {
        const sl = slots[i];
        r[sl.nameKey] = x.component_name; r[sl.qtyKey] = x.components_per_product;
        r[sl.costKey] = round((Number(x.unit_cost_inr) || 0) * (1 + (Number(x.waste_factor) || 0))); r[sl.vendorKey] = x.vendor_name ?? '';
      });
      const overflow = lines.slice(slots.length);
      if (overflow.length) r[cc.key] = round(overflow.reduce((a, x) => a + lineCost(x), 0));
    } else if (lines.length) {
      r[cc.key] = round(lines.reduce((a, x) => a + lineCost(x), 0));
    }
  }
}
