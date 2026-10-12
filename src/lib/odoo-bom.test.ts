import { describe, expect, it } from 'vitest';
import {
  bomSheet, buildDraftLines, checkDraft, convertQty, defaultFinished, lineQty, linkKey, productsSheet, pushPayload, unitInfo,
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
