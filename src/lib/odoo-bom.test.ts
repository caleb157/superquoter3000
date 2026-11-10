import { describe, expect, it } from 'vitest';
import {
  bomQty, bomSheet, buildDraftLines, cartonItem, cartonKind, checkDraft, convertQty, defaultFinished, editNewItem, isFullSku,
  lineQty, productsSheet, pushPayload, splitSku, unitInfo,
  type OdooProduct,
} from './odoo-bom';

const row = (over: Record<string, unknown>) => ({
  id: String(over.component_name), include: 'Yes', cogs_type: 'Other', components_per_product: 1, waste_factor: 0,
  unit_cost_inr: 10, units: 'pc', sort_order: 0, ...over,
});
const handle: OdooProduct = { id: 2371, sku: 'HRD-HDGL-12IN', name: 'Gold Handle', display_name: '[HRD-HDGL-12IN] Gold Handle', uom: 'Units' };

describe('units', () => {
  it('reads Odoo pack fractions and converts', () => {
    expect(unitInfo('1/20th of a Pack')).toEqual({ family: 'count', factor: 1 / 20 });
    expect(convertQty(0.05, 'pc', '1/20th of a Pack')).toEqual({ qty: 1, ok: true });
    expect(convertQty(0.05, 'L', 'mL')).toEqual({ qty: 50, ok: true });
    expect(convertQty(2, 'kg', 'L').ok).toBe(false);
  });
});

describe('draft lines', () => {
  it('includes waste, drops excluded lines, and leaves new raw material SKUs blank with no cost', () => {
    expect(lineQty({ components_per_product: 0.15, waste_factor: 0.25 })).toBeCloseTo(0.2);
    const lines = buildDraftLines([
      row({ component_name: 'Mango wood', cogs_type: 'Wood', components_per_product: 0.15, waste_factor: 0.25, units: 'cft', unit_cost_inr: 900 }),
      row({ component_name: 'Off', include: 'No' }),
      row({ component_name: 'Polishing', cogs_type: 'Subcontracting' }),
    ], new Map());
    expect(lines.map(l => [l.hqName, l.status])).toEqual([['Mango wood', 'new'], ['Polishing', 'skip']]);
    expect(lines[0].newItem).toMatchObject({ sku: '', cost: null, uom: 'cu ft' });
  });
  it('never defaults a category, even from the SKU prefix', () => {
    const item = buildDraftLines([row({ component_name: 'Knob', cogs_type: 'Handles + Knobs' })], new Map())[0].newItem;
    expect(item.category).toBe('');
    expect(editNewItem(item, { sku: 'SCR-X' }).category).toBe('');
  });
  it('leaves carton names blank for the user to type', () => {
    const [l] = buildDraftLines([row({ component_name: 'MC Box', cogs_type: 'Packaging' })], new Map());
    expect(l.newItem.name).toBe('');
    expect(l.newItem.sku).toBe('');
  });
});

describe('finished SKU', () => {
  it('needs a prefix, a base and a suffix', () => {
    expect(isFullSku('CCT-WSS2016-CHST')).toBe(true);
    expect(isFullSku('CCT-WSS2016-CHST_SMALL')).toBe(true);
    expect(isFullSku('CCT-WSS2016')).toBe(false);
    expect(isFullSku('CCT-WSS2016-')).toBe(false);
    expect(splitSku('CCT-WSS2016-CHST_SMALL')).toEqual({ prefix: 'CCT', base: 'WSS2016', suffix: 'CHST_SMALL' });
  });
  it('suggests a 4-character base and no prefix or suffix', () => {
    expect(defaultFinished({ name: 'Tray', sku: 'AT-3335' }).sku).toBe('-AT33-');
  });
});

describe('cartons', () => {
  it('names PIC from the outside size and ply, SKU from the first two sides with decimals dropped', () => {
    expect(cartonItem('PIC', 'Side Table', 'WSS2', { w: 44.2, d: 37.9, h: 50 }, '5 ply')).toEqual({
      name: 'Inner Carton for Side Table / 44 x 37 x 50 inch / 5 ply', sku: 'PIC-WSS2-4437',
    });
    expect(cartonItem('PMC', 'Tray', 'AT33', { w: 103, d: 41, h: 13 }, null)).toEqual({
      name: 'Master Carton for Tray / 103 x 41 x 13 inch', sku: 'PMC-AT33-10341',
    });
  });
  it('leaves the SKU blank without a size', () => {
    expect(cartonItem('PIC', 'Tray', 'AT33', null, null)).toEqual({ name: 'Inner Carton for Tray', sku: '' });
  });
  it('tells inner from master cartons by line name', () => {
    expect(cartonKind('Packaging', 'IC Box')).toBe('PIC');
    expect(cartonKind('Packaging', 'MC Box')).toBe('PMC');
    expect(cartonKind('Packaging', 'Other Packaging')).toBe(null);
  });
});

describe('BOM units', () => {
  const lines = () => {
    const ls = buildDraftLines([row({ component_name: 'Gold handle', cogs_type: 'Handles + Knobs', components_per_product: 2 })], new Map());
    ls[0] = { ...ls[0], status: 'match', match: handle };
    return ls;
  };
  it('multiplies line quantities by the units per BOM and sets the BOM quantity to match', () => {
    const f = { ...defaultFinished({ name: 'Tray', sku: 'AT-3335' }), sku: 'CCT-AT33-DARK', bomUnits: 20 };
    expect(bomQty(lines()[0], 20).qty).toBe(40);
    const s = bomSheet(f, lines());
    expect(s[1][3]).toBe(20);
    expect(s[1][5]).toBe(40);
    const p = pushPayload('pid', f, lines(), new Set());
    expect(p.bomUnits).toBe(20);
    expect(p.lines[0].qty).toBe(40);
  });
});

describe('existing finished product', () => {
  const ls = buildDraftLines([row({ component_name: 'Gold handle', cogs_type: 'Handles + Knobs' })], new Map());
  ls[0] = { ...ls[0], status: 'match', match: handle };
  const odoo: OdooProduct = { id: 55, sku: 'CCT-AT33-DARK', name: 'Tray', display_name: '[CCT-AT33-DARK] Tray', uom: 'Units' };
  it('creates no product and attaches the BOM to the picked product', () => {
    const f = { ...defaultFinished({ name: 'Tray' }), exists: true, existing: odoo };
    expect(checkDraft(f, ls, new Set()).filter(i => i.level === 'error')).toEqual([]);
    expect(productsSheet(f, ls, new Set())).toHaveLength(1);
    const p = pushPayload('pid', f, ls, new Set());
    expect(p.finished).toBeNull();
    expect(p.existingProductId).toBe(55);
  });
  it('requires picking the product when ticked', () => {
    const f = { ...defaultFinished({ name: 'Tray' }), exists: true, existing: null };
    expect(checkDraft(f, ls, new Set()).some(i => i.level === 'error' && /Pick the Odoo product/.test(i.msg))).toBe(true);
  });
  it('blocks a new product SKU without a suffix', () => {
    const f = { ...defaultFinished({ name: 'Tray' }), sku: 'CCT-AT33-' };
    expect(checkDraft(f, ls, new Set()).some(i => i.level === 'error' && /suffix/.test(i.msg))).toBe(true);
  });
  it('never sends a cost for new components', () => {
    const n = buildDraftLines([row({ component_name: 'NC sealer', cogs_type: 'Finishing Materials', units: 'L', unit_cost_inr: 400 })], new Map());
    n[0].newItem.sku = 'CHM-NCSL-01';
    const p = pushPayload('pid', { ...defaultFinished({ name: 'Tray' }), sku: 'CCT-AT33-DARK' }, n, new Set());
    expect(p.components[0]).not.toHaveProperty('cost');
  });
});

import { dktProductsSheet as dktSheet, checkFinishedOnly as finOnly, defaultFinished as defFin } from './odoo-bom';
describe('final products step', () => {
  it('DKT sheet: name (customer SKU), Parable vendor, dropship category, Goods', () => {
    expect(dktSheet([{ name: 'Crank Table', customerSku: 'CF3931CHETBK' }, { name: 'Stool', customerSku: '' }]).slice(1)).toEqual([
      ['Crank Table (CF3931CHETBK)', 'Parable Ventures Pvt Ltd', 'Goods / Goods AVCO Dropship', 'Goods', '', '', ''],
      ['Stool', 'Parable Ventures Pvt Ltd', 'Goods / Goods AVCO Dropship', 'Goods', '', '', ''],
    ]);
  });
  it('DKT sheet: vendor unit price = sale price x (1 - selling retention); vendor code = Odoo SKU', () => {
    const s = dktSheet([{ name: 'Table', sku: 'CCT-CF3931-CHBL', salePriceUsd: 10 }], 0.1);
    expect(s[0].slice(4)).toEqual(['Sales Price', 'Vendors/Unit Price', 'Vendors/Vendor Product Code']);
    expect(s[1].slice(4)).toEqual([10, 9, 'CCT-CF3931-CHBL']);
  });
  it('DKT sheet: no retention set means the full sale price', () => {
    expect(dktSheet([{ name: 'Table', salePriceUsd: 10 }], null)[1][5]).toBe(10);
  });
  it('blocks a SKU already in Odoo and one without a suffix', () => {
    const f = { ...defFin({ name: 'Table' }), sku: 'CCT-CF3931-CHBL', category: 'All / Saleable' };
    expect(defFin({ name: 'Table' }).category).toBe('');
    expect(finOnly(f, new Set(['CCT-CF3931-CHBL'])).length).toBe(1);
    expect(finOnly({ ...f, sku: 'CCT-CF3931-' }, null).length).toBe(1);
    expect(finOnly(f, new Set())).toEqual([]);
  });
});

import { categorySuggestions, mergeVariantLines, buildDraftLines as bdl } from './odoo-bom';
const r2 = (id: string, name: string, qty: number) => ({ id, product_id: 'x', component_name: name, cogs_type: 'Hardware', components_per_product: qty, include: 'Yes' } as never);
describe('template BOM', () => {
  it('suggests every Odoo category used by the SKU prefix, most used first', () => {
    const list = [{ prefix: 'BWL', categories: [{ name: 'A', count: 5 }, { name: 'B', count: 2 }] }];
    expect(categorySuggestions('BWL-CPRL-0707', list).map(c => c.name)).toEqual(['A', 'B']);
    expect(categorySuggestions('PMC-X', list)).toEqual([]);
  });
  it('keeps shared lines once for all variants and variant-only lines with their variant', () => {
    const a = bdl([r2('a1', 'Screw', 4), r2('a2', 'Knob', 1)], new Map());
    const b = bdl([r2('b1', 'Screw', 4), r2('b2', 'Knob', 2)], new Map());
    const m = mergeVariantLines([{ productId: 'A', lines: a }, { productId: 'B', lines: b }]);
    expect(m.map(l => [l.hqName, l.variantOf])).toEqual([['Screw', null], ['Knob', 'A'], ['Knob', 'B']]);
  });
});
