import { describe, it, expect } from 'vitest';
import { buildReplyGrid, productSpecs, isOpenRfq, planWinner, priceTone, whatsappMessage, defaultReplyBy, type SheetRfq, type SheetLine } from './vendor-rfq-sheet';

const rfq = (id: string, vendor: string): SheetRfq => ({ id, rfq_number: `RFQ-${id}`, vendor_id: null, vendor_name: vendor, status: 'sent', response_due: null });
const line = (id: string, rfqId: string, productId: string, extra: Partial<SheetLine> = {}): SheetLine => ({
  id, vendor_rfq_id: rfqId, product_id: productId, item_name: `Product ${productId}`, quantity: 100, target_price: 500, sort_order: 0, ...extra,
});

describe('buildReplyGrid', () => {
  const rfqs = [rfq('a', 'Rao'), rfq('b', 'Mehta')];
  const lines = [
    line('a1', 'a', 'p1'), line('b1', 'b', 'p1'),
    line('a2', 'a', 'p2', { sort_order: 1 }), line('b2', 'b', 'p2', { sort_order: 1, picked_at: '2026-10-12T00:00:00Z' }),
  ];

  it('makes one row per product with a cell per vendor and marks the cheapest', () => {
    const rows = buildReplyGrid(rfqs, lines, [
      { vendor_rfq_line_item_id: 'a1', quoted_unit_price: 480, quoted_lead_time_days: 30 },
      { vendor_rfq_line_item_id: 'b1', quoted_unit_price: 450, quoted_lead_time_days: 45 },
      { vendor_rfq_line_item_id: 'a2', quoted_unit_price: 300, quoted_lead_time_days: null },
    ]);
    expect(rows.map(r => r.productId)).toEqual(['p1', 'p2']);
    expect(rows[0].cells.a.price).toBe(480);
    expect(rows[0].cells.b.lead).toBe(45);
    expect(rows[0].cheapestRfqId).toBe('b');
    expect(rows[1].cheapestRfqId).toBe('a');
    expect(rows[1].cells.b.price).toBeNull();
  });

  it('records the picked vendor and ignores zero prices', () => {
    const rows = buildReplyGrid(rfqs, lines, [{ vendor_rfq_line_item_id: 'a2', quoted_unit_price: 0, quoted_lead_time_days: 10 }]);
    expect(rows[1].pickedRfqId).toBe('b');
    expect(rows[1].cheapestRfqId).toBeNull();
  });
});

describe('priceTone', () => {
  it('compares against the target', () => {
    expect(priceTone(480, 500)).toBe('good');
    expect(priceTone(500, 500)).toBe('good');
    expect(priceTone(520, 500)).toBe('over');
    expect(priceTone(520, null)).toBe('none');
    expect(priceTone(null, 500)).toBe('none');
  });
});

describe('planWinner', () => {
  const raw = (id: string, extra: any) => ({ id, product_id: 'p1', cogs_type: 'Raw Piece', components_per_product: 1, ...extra });

  it('updates the slot already holding that vendor, makes it the included one and excludes the rest', () => {
    const cogs = [
      raw('r1', { vendor_name: 'Mehta', unit_cost_inr: 520, include: 'Yes', sort_order: 0 }),
      raw('r2', { vendor_name: 'rao ', unit_cost_inr: 510, include: 'No', sort_order: 1 }),
      { id: 'h1', product_id: 'p1', cogs_type: 'Other Hardware', include: 'Yes' },
    ];
    const plan = planWinner('p1', cogs, false, 'Rao', 480);
    expect(plan.insert).toBeNull();
    expect(plan.updates).toEqual([
      { id: 'r1', patch: { include: 'No' } },
      { id: 'r2', patch: { vendor_name: 'Rao', unit_cost_inr: 480, include: 'Yes' } },
    ]);
  });

  it('fills an empty slot before adding a new one', () => {
    const plan = planWinner('p1', [raw('r1', { vendor_name: null, unit_cost_inr: 0, include: 'Yes', components_per_product: 0 })], false, 'Rao', 480);
    expect(plan.updates).toEqual([{ id: 'r1', patch: { vendor_name: 'Rao', unit_cost_inr: 480, include: 'Yes', components_per_product: 1 } }]);
    expect(plan.insert).toBeNull();
  });

  it('adds a new included slot when every slot belongs to another vendor', () => {
    const plan = planWinner('p1', [raw('r1', { vendor_name: 'Mehta', unit_cost_inr: 520, include: 'Yes', sort_order: 0 })], false, 'Rao', 480);
    expect(plan.updates).toEqual([{ id: 'r1', patch: { include: 'No' } }]);
    expect(plan.insert).toMatchObject({ product_id: 'p1', cogs_type: 'Raw Piece', component_name: 'Raw Piece 2', vendor_name: 'Rao', unit_cost_inr: 480, include: 'Yes', sort_order: 1 });
  });

  it('writes outsourced products onto the Outsourced Product line', () => {
    const cogs = [{ id: 'o1', product_id: 'p1', cogs_type: 'Other', component_name: 'Outsourced Product', unit_cost_inr: 900, include: 'Yes', components_per_product: 1 }];
    expect(planWinner('p1', cogs, true, 'Rao', 850)).toEqual({ updates: [{ id: 'o1', patch: { vendor_name: 'Rao', unit_cost_inr: 850, include: 'Yes' } }], insert: null });
    expect(planWinner('p1', [], true, 'Rao', 850).insert).toMatchObject({ component_name: 'Outsourced Product', cogs_type: 'Other', unit_cost_inr: 850 });
  });
});

describe('whatsappMessage', () => {
  it('names the vendor, RFQ, item count, reply date and sender', () => {
    const msg = whatsappMessage({ vendorName: 'Rao', rfqNumber: 'RFQ-2026-014', itemCount: 3, replyBy: '2026-10-15', senderName: 'Caleb', companyName: 'Parable Ventures' });
    expect(msg).toContain('Hello Rao,');
    expect(msg).toContain('quotation RFQ-2026-014 for 3 items');
    expect(msg).toContain('15 Oct 2026');
    expect(msg).toContain('Caleb, Parable Ventures');
  });
});

describe('defaultReplyBy', () => {
  it('is three days out as a date', () => {
    expect(defaultReplyBy(new Date(2026, 9, 30))).toBe('2026-11-02');
  });
});

describe('productSpecs', () => {
  it('lists size, type, wood, finish, weight, MOQ, hardware and vendor notes, never internal notes', () => {
    const p = {
      id: 'p1', width_inch: 18, depth_inch: 12, height_inch: 2.5, product_type: { name: 'Wood Tray' }, percent_wood: 0.8,
      notes_finishes: 'Natural oil', finishing_difficulty: 'Medium', weight_kg: 1.25, moq: 200,
      notes_vendors: 'Kiln-dried mango only', notes: 'Rounded corners',
    };
    const cogs = [
      { product_id: 'p1', cogs_type: 'Handles + Knobs', component_name: 'Brass handle', components_per_product: 2, include: 'Yes' },
      { product_id: 'p1', cogs_type: 'Other Hardware', component_name: 'Hardware 1', components_per_product: 1, include: 'Yes' },
      { product_id: 'p2', cogs_type: 'Handles + Knobs', component_name: 'Other product handle', components_per_product: 1, include: 'Yes' },
    ];
    const { specs, notes } = productSpecs(p, cogs);
    expect(specs).toEqual([
      { label: 'Size (W x D x H)', value: '18 x 12 x 2.5 in' },
      { label: 'Type', value: 'Wood Tray' },
      { label: 'Wood', value: '80%' },
      { label: 'Finish', value: 'Natural oil · Medium finish' },
      { label: 'Weight', value: '1.25 kg' },
      { label: 'MOQ', value: '200' },
      { label: 'Hardware', value: 'Brass handle x 2' },
    ]);
    expect(notes).toEqual(['Kiln-dried mango only']);
  });

  it('skips what the product does not have', () => {
    expect(productSpecs({ id: 'p1', percent_wood: 1 }, [])).toEqual({ specs: [], notes: [] });
  });
});

describe('isOpenRfq', () => {
  it('is an RFQ with no vendor on it', () => {
    expect(isOpenRfq({ vendor_id: null, vendor_name: null })).toBe(true);
    expect(isOpenRfq({ vendor_id: null, vendor_name: 'Rao' })).toBe(false);
    expect(isOpenRfq({ vendor_id: 'v1', vendor_name: null })).toBe(false);
  });
});
