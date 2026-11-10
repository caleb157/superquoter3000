import { describe, expect, it } from 'vitest';
import { buildBookedOrders, bookedVendorCashItems } from './master-analytics';

const today = '2026-10-27';
const opts = { today, pvEntityId: 'pv', defaults: { custDeposit: 0.3, ieDeposit: 0.8 }, live: {} };
// FOB 10,000 at 25% GPM → planned vendor cost $7,500 = ₹675,000 at ₹90.
const inquiry = (p: any = {}) => ({
  id: 'a', rfq_number: 'RFQ-1', status: 'po', products: [],
  inquiry_projections: { projected_fob_revenue_usd: 10000, project_gpm: 0.25, cust_deposit_month: '2026-11-01', cust_final_month: '2027-02-01', odoo_so_name: 'S00124', ...p },
});
const so = (x: any = {}) => ({ name: 'S00124', delivery_status: 'pending', invoice_status: 'to invoice', ...x }) as any;
const run = (p?: any, spend?: number, soX?: any) => {
  const orders = buildBookedOrders([inquiry(p)], opts, { sales_orders: [so(soX)], po_by_so: spend == null ? {} : { S00124: { amount_inr: spend, amount_usd: spend / 90, pos: ['P01109'] } } }, 90);
  return { orders, items: bookedVendorCashItems(orders, 90, today) };
};
const total = (items: { amount_inr: number }[]) => Math.round(items.reduce((s, i) => s + i.amount_inr, 0));

describe('booked SO vendor costs', () => {
  it('counts the full planned cost on the vendor months when no PO is raised yet', () => {
    const { items } = run();
    expect(total(items)).toBe(675000);
    expect(items.map(i => [i.date.slice(0, 7), Math.round(i.amount_inr)])).toEqual([['2026-11', 202500], ['2027-02', 472500]]);
  });
  it('nets off POs, deposit first, so a PO never counts twice', () => {
    const { items } = run({}, 250000);
    expect(total(items)).toBe(425000);
    expect(items.map(i => i.date.slice(0, 7))).toEqual(['2027-02']);
  });
  it('never goes below zero', () => {
    expect(run({}, 900000).items).toEqual([]);
  });
  it('stops once all POs are placed or the order has shipped', () => {
    expect(run({ all_pos_placed: true }).orders[0].state).toBe('all_pos_placed');
    expect(run({ all_pos_placed: true }).items).toEqual([]);
    expect(run({}, 0, { delivery_status: 'full' }).items).toEqual([]);
  });
  it('flags inquiries with no SO linked, or one Odoo does not have', () => {
    expect(run({ odoo_so_name: null }).orders[0].state).toBe('no_so');
    expect(run({ odoo_so_name: 'S99999' }).orders[0].state).toBe('so_not_found');
    expect(run({ odoo_so_name: null }).items).toEqual([]);
  });
});
