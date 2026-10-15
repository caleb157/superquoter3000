import { describe, expect, it } from 'vitest';
import {
  applyPrefixes, applyShared, bomQty, bomSheet, buildDraftLines, checkAcross, checkDraft, combinedBomSheet, combinedProductsSheet, convertQty, sharedItems, defaultFinished, finishedSkuFor, itemCode, lineQty, linkKey, productsSheet, pushPayload, rawPieceSkuFor, unitInfo,
  type OdooProduct,
} from './odoo-bom';

const row = (over: Record<string, unknown>) => ({
  id: String(over.component_name), include: 'Yes', cogs_type: 'Other', components_per_product: 1, waste_factor: 0,
  unit_cost_inr: 10, units: 'pc', sort_order: 0, ...over,
});

describe('units', () => {
  it('reads Odoo pack fractions and packs', () => {
    expect(unitInfo('1/20th of a Pack')).toEqual({ family: 'count', factor: 1 / 20 });
    expect(unitInfo('Pack of 12')).toEqual({ family: 'count', factor: 12 });
  });
  it('converts HQ units to Odoo units', () => {
    expect(convertQty(0.05, 'pc', '1/20th of a Pack')).toEqual({ qty: 1, ok: true });
    expect(convertQty(0.05, 'L', 'mL')).toEqual({ qty: 50, ok: true });
    expect(convertQty(0.17, 'cft', 'cu ft')).toEqual({ qty: 0.17, ok: true });
    expect(convertQty(10, 'g', 'kg')).toEqual({ qty: 0.01, ok: true });
    expect(convertQty(2, 'kg', 'L').ok).toBe(false);
  });
});

describe('draft lines', () => {
  it('includes waste like the engine and drops excluded or empty lines', () => {
    expect(lineQty({ components_per_product: 0.15, waste_factor: 0.25 })).toBeCloseTo(0.2);
    const lines = buildDraftLines([
      row({ component_name: 'Mango wood', cogs_type: 'Wood', components_per_product: 0.15, waste_factor: 0.25, units: 'cft' }),
      row({ component_name: 'Off', include: 'No' }),
      row({ component_name: 'Zero', components_per_product: 0 }),
      row({ component_name: 'Polishing', cogs_type: 'Subcontracting' }),
      row({ component_name: 'Domestic Freight (External Sourcing)' }),
    ], new Map());
    expect(lines.map(l => [l.hqName, l.status])).toEqual([
      ['Mango wood', 'new'], ['Polishing', 'skip'], ['Domestic Freight (External Sourcing)', 'skip'],
    ]);
    expect(lines[0].newItem).toMatchObject({ sku: 'TMB-', uom: 'cu ft', tracked: true });
  });

  it('pre-matches a line linked before', () => {
    const handle: OdooProduct = { id: 2371, sku: 'HRD-HDGL-12IN', name: 'Gold Handle / Electroplated SS / 12 inch', display_name: '[HRD-HDGL-12IN] Gold Handle / Electroplated SS / 12 inch', uom: 'Units' };
    const lines = buildDraftLines([row({ component_name: 'Gold  handle', cogs_type: 'Handles + Knobs', components_per_product: 2 })],
      new Map([[linkKey('Handles + Knobs', 'gold handle'), handle]]));
    expect(lines[0].status).toBe('match');
    expect(lines[0].match?.id).toBe(2371);
  });
});

describe('files', () => {
  const handle: OdooProduct = { id: 2371, sku: 'HRD-HDGL-12IN', name: 'Gold Handle', display_name: '[HRD-HDGL-12IN] Gold Handle', uom: 'Units' };
  const carton: OdooProduct = { id: 99, sku: 'PBX-0004-B', name: 'Master Carton', display_name: '[PBX-0004-B] Master Carton', uom: '1/20th of a Pack' };
  const make = () => {
    const lines = buildDraftLines([
      row({ component_name: 'Gold handle', cogs_type: 'Handles + Knobs', components_per_product: 2 }),
      row({ component_name: 'MC box', cogs_type: 'Packaging', components_per_product: 0.05 }),
      row({ component_name: 'NC sealer', cogs_type: 'Finishing Materials', components_per_product: 0.05, units: 'L', unit_cost_inr: 400 }),
    ], new Map([[linkKey('Handles + Knobs', 'Gold handle'), handle], [linkKey('Packaging', 'MC box'), carton]]));
    lines[2].newItem.sku = 'CHM-NCSL-NEW';
    const f = { ...defaultFinished({ name: 'Advent Candle Set Dark', sku: 'RWH-ADC4-DARK', weight_kg: 1.2 }), code: 'RADC Dark' };
    return { f, lines };
  };

  it('writes the BOM in the layout of the Odoo export', () => {
    const { f, lines } = make();
    const s = bomSheet(f, lines);
    expect(s[0]).toEqual(['company_id', 'product_tmpl_id', 'code', 'type', 'product_qty', 'bom_line_ids/product_id', 'bom_line_ids/product_qty', 'bom_line_ids/product_uom_id']);
    expect(s[1]).toEqual(['Parable Ventures Private Limited', '[RWH-ADC4-DARK] Advent Candle Set Dark', 'RADC Dark', 'Manufacture this product', 1, '[HRD-HDGL-12IN] Gold Handle', 2, 'Units']);
    expect(s[2]).toEqual([null, null, null, null, null, '[PBX-0004-B] Master Carton', 1, '1/20th of a Pack']);
    expect(s[3].slice(5)).toEqual(['[CHM-NCSL-NEW] NC sealer', 0.05, 'L']);
  });

  it('lists only products not yet in Odoo', () => {
    const { f, lines } = make();
    const all = productsSheet(f, lines, null);
    expect(all.map(r => r[1])).toEqual(['default_code', 'RWH-ADC4-DARK', 'CHM-NCSL-NEW']);
    expect(all[2].slice(2, 11)).toEqual(['Goods', 'True', 'All / Expenses / Raw Materials AVCO Automatic', 'L', 'L', 'False', 'True', null, 400]);
    const some = productsSheet(f, lines, new Set(['RWH-ADC4-DARK']));
    expect(some.map(r => r[1])).toEqual(['default_code', 'CHM-NCSL-NEW']);
  });

  it('flags SKUs that already exist in Odoo and unfinished SKUs', () => {
    const { f, lines } = make();
    expect(checkDraft(f, lines, new Set()).filter(i => i.level === 'error')).toEqual([]);
    expect(checkDraft(f, lines, new Set(['CHM-NCSL-NEW'])).some(i => i.level === 'error' && /already exists/.test(i.msg))).toBe(true);
    lines[2].newItem.sku = 'CHM-';
    expect(checkDraft(f, lines, null).some(i => /unfinished/.test(i.msg))).toBe(true);
  });

  it('builds the direct-send payload from the same draft', () => {
    const { f, lines } = make();
    const p = pushPayload('pid', f, lines, new Set());
    expect(p.components.map(c => c.sku)).toEqual(['CHM-NCSL-NEW']);
    expect(p.lines).toEqual([
      { productId: 2371, sku: 'HRD-HDGL-12IN', qty: 2, uom: 'Units' },
      { productId: 99, sku: 'PBX-0004-B', qty: 1, uom: '1/20th of a Pack' },
      { productId: null, sku: 'CHM-NCSL-NEW', qty: 0.05, uom: 'L' },
    ]);
  });
});

describe('several products', () => {
  const draft = (id: string, sku: string, rows: Record<string, unknown>[]) => ({
    productId: id, finished: defaultFinished({ name: `Product ${id}`, sku }), lines: buildDraftLines(rows.map(row), new Map()),
  });

  it('shares one decision per HQ item and keeps each product its own quantity', () => {
    const a = draft('a', 'RWH-A', [{ component_name: 'Brass knob', cogs_type: 'Handles + Knobs', components_per_product: 2 }]);
    const b = draft('b', 'RWH-B', [{ component_name: 'Brass Knob', cogs_type: 'Handles + Knobs', components_per_product: 4 }]);
    const items = sharedItems([a, b]);
    expect(items).toHaveLength(1);
    expect(items[0].usedIn).toBe(2);
    const shared = new Map([[items[0].key, { ...items[0].first, newItem: { ...items[0].first.newItem, sku: 'HRD-BRKN-01' } }]]);
    const drafts = [a, b].map(d => ({ ...d, lines: applyShared(d.lines, shared) }));
    expect(drafts.map(d => bomQty(d.lines[0]).qty)).toEqual([2, 4]);
    expect(combinedProductsSheet(drafts, null).map(r => r[1])).toEqual(['default_code', 'RWH-A', 'HRD-BRKN-01', 'RWH-B']);
    const bom = combinedBomSheet(drafts);
    expect(bom.map(r => r[1])).toEqual(['product_tmpl_id', '[RWH-A] Product a', '[RWH-B] Product b']);
    expect(checkAcross(drafts)).toEqual([]);
  });

  it('flags one SKU used for two different items', () => {
    const a = draft('a', 'RWH-A', [{ component_name: 'Knob', cogs_type: 'Handles + Knobs' }, { component_name: 'Hinge', cogs_type: 'Other Hardware' }]);
    a.lines.forEach(l => { l.newItem.sku = 'HRD-SAME'; });
    expect(checkAcross([a])[0].msg).toMatch(/2 different/);
  });
});

describe('SKU prefixes', () => {
  const lines = (id: string) => buildDraftLines([
    row({ component_name: 'Raw piece', cogs_type: 'Raw Piece' }),
    row({ component_name: 'Brass knob', cogs_type: 'Handles + Knobs' }),
  ], new Map(), id);

  it('builds SKUs from the HQ SKU or the name', () => {
    expect(itemCode('AT-3335', 'Anything')).toBe('AT3335');
    expect(itemCode('', 'Advent Candle Set of 4 Dark')).toBe('AC4D');
    expect(finishedSkuFor('cct', 'AT-3335', 'x')).toBe('CCT-AT3335');
    expect(finishedSkuFor('CCT', 'CCT-AT3335-WHTE', 'x')).toBe('CCT-AT3335-WHTE');
    expect(rawPieceSkuFor('RAW', 'CCT-AT3335')).toBe('RAW-AT3335');
    expect(rawPieceSkuFor('RAW', 'CCT-AT3335', 2)).toBe('RAW-AT3335-2');
  });

  it('keeps raw pieces per product but other items shared', () => {
    expect(lines('a')[0].key).not.toBe(lines('b')[0].key);
    expect(lines('a')[1].key).toBe(lines('b')[1].key);
  });

  it('fills, refills on a prefix change, and keeps typed SKUs', () => {
    const f = defaultFinished({ name: 'Tray', sku: 'AT-3335' });
    let r = applyPrefixes({ ...f, sku: '' }, lines('a'), { product: 'CCT', raw: 'RAW' }, null);
    expect(r.finished.sku).toBe('CCT-AT3335');
    expect(r.lines[0].newItem.sku).toBe('RAW-AT3335');
    expect(r.lines[1].newItem.sku).toBe('HRD-');
    r = applyPrefixes(r.finished, r.lines, { product: 'RWH', raw: 'RP' }, { product: 'CCT', raw: 'RAW' });
    expect([r.finished.sku, r.lines[0].newItem.sku]).toEqual(['RWH-AT3335', 'RP-AT3335']);
    const typed = { ...r.finished, sku: 'MY-OWN' };
    const ls = r.lines.map((l, i) => (i === 0 ? { ...l, newItem: { ...l.newItem, sku: 'PIECE-9' } } : l));
    r = applyPrefixes(typed, ls, { product: 'CCT', raw: 'RAW' }, { product: 'RWH', raw: 'RP' });
    expect([r.finished.sku, r.lines[0].newItem.sku]).toEqual(['MY-OWN', 'PIECE-9']);
  });
});
