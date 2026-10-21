import { describe, expect, it } from 'vitest';
import { buildRows, computeResults, type Bundle } from '@/lib/costing-workspace';
import { bundle } from '@/lib/__tests__/workspace-fixture';
import {
  applyAll, applyCogsPair, cogsTypeForOdoo, isOperationMapped, compare, laborTypeFor, linePatchFor, newLineIds, skuPrefix, soPriceInr, suggestTargets,
  type OdooComponent, type OdooPastCost,
} from './repeat-cost';

const rowOf = (b: Bundle, id: string) => buildRows(b, computeResults(b)).find(r => r.p.id === id)!;
const comp = (sku: string, name: string, used: number, value: number, planned = used): OdooComponent =>
  ({ odoo_product_id: Math.abs([...sku].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % 100000, sku, name, category: '', uom: 'Units', planned, used, value });

// 10 made: a raw piece, two handles each, an inner carton and some tape that wasn't on the BOM.
const past = (): OdooPastCost => ({
  product: { id: 1, sku: 'LUX-X', name: 'Box', standard_price: 0 },
  sale: { sale_line_id: 5, order: 'S00099', customer: 'Luxe', quantity: 10, price_unit: 30, currency: 'USD', odoo_cost_unit: 0 },
  mos: [{ id: 7, name: 'WH/MO/00001', origin: 'S00099', planned: 10, produced: 10, date: '2026-07-07', linked: true }],
  mo: { id: 7, name: 'WH/MO/00001', origin: 'S00099', planned: 10, produced: 10, date: '2026-07-07', linked: true, finished_value: 0, value_estimated: false },
  components: [
    comp('RAW-RAO-1', 'Raw piece Rao', 10, 10500),
    comp('HDL-BRS-01', 'Brass knob', 22, 1100, 20),
    comp('PIC-X-01', 'Inner Carton 5 ply', 10, 300),
    comp('PKS-TAPE-TAPE', 'Tape', 40, 40, 0),
  ],
  labour: [
    { operation: 'Manufacturing', hours: 4, expected_hours: 5, cost: 400 },
    { operation: 'Sanding', hours: 2, expected_hours: 1, cost: 0 },
    { operation: 'Polishing', hours: 1, expected_hours: 0, cost: 100 },
  ],
});

describe('Odoo components → PDHQ categories', () => {
  it('reads the SKU prefix, ignoring the OLD marker', () => {
    expect(skuPrefix('OLD EPE-PF02-ALLS')).toBe('EPE');
    expect(cogsTypeForOdoo({ sku: 'TMB-ACIA-01IN', category: '', name: '' })).toBe('Wood');
    expect(cogsTypeForOdoo({ sku: 'SUB-LMBX-MANF', category: '', name: '' })).toBe('Subcontracting');
    expect(cogsTypeForOdoo({ sku: 'LCH-TGGL-ANBZ', category: '', name: '' })).toBe('Handles/Latches');
    expect(cogsTypeForOdoo({ sku: 'OLD EPE-PF02-ALLS', category: '', name: '' })).toBe('Packaging');
    expect(cogsTypeForOdoo({ sku: 'ZZZ-1', category: 'All / Expenses / Subcontracting Services', name: '' })).toBe('Subcontracting');
    expect(cogsTypeForOdoo({ sku: '', category: '', name: 'Mystery' })).toBe('Other');
  });
});

describe('operation → labour type', () => {
  it('uses Settings first, then the defaults; skipped or unknown operations count nowhere', () => {
    expect(laborTypeFor('Sanding', {})).toBe('Finishing');
    expect(laborTypeFor('Sanding', { Sanding: 'Assembly' })).toBe('Assembly');
    expect(laborTypeFor('QC', { QC: 'skip' })).toBeNull();
    expect(laborTypeFor('Polishing', {})).toBeNull();
  });

  it('maps Odoo\'s product-specific operations by their wording', () => {
    const t = (op: string) => laborTypeFor(op, {});
    expect(t('Finish KK')).toBe('Finishing');
    expect(t('BDT Sanding')).toBe('Finishing');
    expect(t('Sand and Putty')).toBe('Finishing');
    expect(t('REwork DGJ')).toBe('Finishing');
    expect(t('Powder Coat SC Seat')).toBe('Finishing');
    expect(t('Char BC')).toBe('Finishing');
    expect(t('Spray Candle')).toBe('Finishing');
    expect(t('Assemble Bean Vial')).toBe('Assembly');
    expect(t('Assemble & Package KI')).toBe('Packaging');
    expect(t('Assembly and Packaging')).toBe('Packaging');
    expect(t('Package Bean Vial')).toBe('Packaging');
    expect(t('Pack Candle')).toBe('Packaging');
    expect(t('QC Pipe Stand')).toBe('QC');
    expect(t('CP Market Running')).toBe('Market');
    expect(t('Ornaments Market')).toBe('Market');
    expect(t('Cut, Drill, and Carve KK')).toBe('Manufacturing');
    expect(t('Lathe Turn BV Lid')).toBe('Manufacturing');
    expect(t('Make CP Base')).toBe('Manufacturing');
    // Laser is a subcontracting COGS line and General Work Order stays out: not counted, and not flagged.
    expect(t('Laser Engrave Cups')).toBeNull();
    expect(t('General Work Order')).toBeNull();
    expect(isOperationMapped('Laser Cut TH', {})).toBe(true);
    expect(isOperationMapped('Polishing', {})).toBe(false);
    expect(laborTypeFor('Finish KK', { 'Finish KK': 'Assembly' })).toBe('Assembly');
  });
});

describe('matching', () => {
  it('pairs cartons with the auto IC box and others by shared words; the rest become new lines', () => {
    const b = bundle();
    const t = suggestTargets(b, 'a', past().components);
    const [raw, knob, ic, tape] = past().components;
    const line = (id: unknown) => b.cogs.find(c => c.id === id);
    expect(line(t[ic.odoo_product_id])?.component_name).toBe('IC Box');
    expect(line(t[raw.odoo_product_id])?.vendor_name).toBe('Rao');
    expect(line(t[knob.odoo_product_id])?.cogs_type).toBe('Handles + Knobs'); // the lone pair in its category
    expect(t[tape.odoo_product_id]).toBe('new');
  });
});

describe('comparison', () => {
  it('PDHQ side adds up to the engine unit cost', () => {
    const b = bundle();
    const p = past();
    const cmp = compare(b, rowOf(b, 'a'), p, suggestTargets(b, 'a', p.components), {});
    expect(cmp.steps.total.pdhq).toBeCloseTo(rowOf(b, 'a').costInr, 6);
    expect(cmp.produced).toBe(10);
  });

  it('flags unmapped operations and ranks the biggest gaps first', () => {
    const b = bundle();
    const p = past();
    const cmp = compare(b, rowOf(b, 'a'), p, suggestTargets(b, 'a', p.components), {});
    expect(cmp.unmappedOps.map(o => o.operation)).toEqual(['Polishing']);
    const abs = cmp.variances.map(v => Math.abs(v.diff));
    expect(abs).toEqual([...abs].sort((x, y) => y - x));
    const fin = cmp.labour.find(l => l.laborType === 'Finishing')!;
    expect(fin.odooHours).toBeCloseTo(0.2, 9); // Sanding counts as finishing
    expect(fin.operations).toEqual(['Sanding']);
  });

  it('after "use all Odoo values" PDHQ costs what the past run cost', () => {
    const b = bundle();
    const p = past();
    const targets = suggestTargets(b, 'a', p.components);
    const before = compare(b, rowOf(b, 'a'), p, targets, {});
    const ids = newLineIds(before);
    const after = applyAll(b, 'a', before, ids).next;
    const cmp = compare(after, rowOf(after, 'a'), p, { ...targets, ...ids }, {});
    expect(cmp.steps.cogs.pdhq).toBeCloseTo(cmp.steps.cogs.odoo, 6);
    expect(cmp.steps.labour.pdhq).toBeCloseTo(cmp.steps.labour.odoo, 6);
    expect(cmp.steps.total.pdhq).toBeCloseTo(cmp.steps.total.odoo, 6);
    expect(cmp.steps.total.pdhq).toBeCloseTo(rowOf(after, 'a').costInr, 6);
    // The added tape line is matched next time, so applying again adds nothing.
    const again = applyAll(after, 'a', cmp, newLineIds(cmp)).next;
    expect(again.cogs.filter(c => c.product_id === 'a').length).toBe(after.cogs.filter(c => c.product_id === 'a').length);
  });

  it('a PDHQ line the past run did not use is turned off', () => {
    const b = bundle();
    const p = { ...past(), components: past().components.filter(c => !c.sku.startsWith('HDL')) };
    const cmp = compare(b, rowOf(b, 'a'), p, suggestTargets(b, 'a', p.components), {});
    const knob = cmp.cogs.flatMap(g => g.pairs).find(x => x.line?.cogs_type === 'Handles + Knobs')!;
    expect(knob.comps).toEqual([]);
    const next = applyCogsPair(b, 'a', knob, cmp.produced)!.next;
    expect(next.cogs.find(c => c.id === knob.line.id)!.include).toBe('No');
  });
});

describe('line values', () => {
  it('one component: quantity used per unit at the price paid, no waste; several: one set', () => {
    const c = comp('HNG-1', 'Hinge', 398, 896);
    expect(linePatchFor([c], 199)).toMatchObject({ components_per_product: 2, unit_cost_inr: 2.2513, waste_factor: 0, is_auto_calculated: false });
    expect(linePatchFor([c, comp('SCR-1', 'Screw', 1592, 357)], 199)).toMatchObject({ components_per_product: 1, units: 'set', unit_cost_inr: 6.2965 });
  });

  it('converts INR and USD sales prices only', () => {
    expect(soPriceInr(10, 'USD', 90)).toBe(900);
    expect(soPriceInr(10, 'INR', 90)).toBe(10);
    expect(soPriceInr(10, 'EUR', 90)).toBeNull();
  });
});
