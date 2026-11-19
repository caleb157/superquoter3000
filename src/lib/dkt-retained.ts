// Retained orders (DKT Cash Flow → Orders): a what-if list of orders DKT expects to keep getting,
// typed here rather than taken from HQ inquiries or Odoo. Each row runs through the same order math
// as the pipeline (dkt-cashflow.ts orderFlows) and only counts once it's ticked; every row starts
// unticked, so the forecast is unchanged until Caleb switches some on.
//
// The starting list (Caleb, 2026-11-19): CCT's container every quarter, PO Mar/Jun/Sep/Dec 2027
// (the Dec 2026 one is already a pipeline inquiry), and last year's other DKT customers again, each
// in the same month a year on (DKT's Odoo invoices, Dec 2025 to Nov 2026, product and service lines
// without freight charged on). DKT keeps 10% throughout. CCT pays no deposit and pays about 24 days
// after shipping (10 days after the BL), counted as the month after shipping.
import type { DktOrder, Month } from './dkt-cashflow';
import { addMonths } from './dkt-cashflow';

export type RetainedOrder = {
  id: string;
  name: string;
  customer: string | null;
  fob_usd: number;
  margin_pct: number; // 0..1 DKT keeps
  cust_deposit_pct: number; // 0..1 at PO
  advance_pct: number; // 0..1 of PV's amount, paid at PO
  po_month: Month;
  ship_month: Month;
  cust_lag_months: number; // customer pays its balance this many months after shipping
  counted: boolean;
  sort: number;
};

export type RetainedSeed = Omit<RetainedOrder, 'id' | 'counted' | 'sort'>;

const CCT = 'Carolina Chair and Table';
const cct = (po: Month, n: number): RetainedSeed => ({
  name: `CCT container ${n}`, customer: CCT, fob_usd: 33404, margin_pct: 0.1, cust_deposit_pct: 0, advance_pct: 0.5,
  po_month: po, ship_month: addMonths(po, 3), cust_lag_months: 1,
});
/** A repeat of last year's order: PO two months before it ships, 30% deposit, 50% advance to PV. */
const repeat = (customer: string, ship: Month, fob: number): RetainedSeed => ({
  name: `Repeat ${customer}`, customer, fob_usd: fob, margin_pct: 0.1, cust_deposit_pct: 0.3, advance_pct: 0.5,
  po_month: addMonths(ship, -2), ship_month: ship, cust_lag_months: 0,
});

export const RETAINED_SEED: RetainedSeed[] = [
  cct('2027-03', 2), cct('2027-06', 3), cct('2027-09', 4), cct('2027-12', 5),
  repeat('Hypernikao', '2027-01', 6270),
  repeat('Sooie Investments', '2027-01', 1890),
  repeat('Sooie Investments', '2027-02', 4658),
  repeat('Circa Loft', '2027-02', 89),
  repeat('Highridge', '2027-06', 2484),
  repeat('Hypernikao', '2027-06', 850),
  repeat('Hypernikao', '2027-07', 5200),
  repeat('Olive Ateliers', '2027-07', 252),
  repeat('Hypernikao', '2027-08', 3102),
  repeat('Joffa', '2027-09', 4024),
  repeat('Kurinam', '2027-09', 4387),
  repeat('Open Door Presbyterian', '2027-09', 3344),
  repeat('Highridge', '2027-10', 3245),
  repeat('Hypernikao', '2027-10', 13286),
  repeat('Big Chicken', '2027-12', 250),
  repeat('Luxe Designs', '2027-12', 2097),
  repeat('Sooie Investments', '2027-12', 2490),
];

/** The starting list as rows (ids are local; the database gives its own). */
export const seedRows = (): RetainedOrder[] =>
  RETAINED_SEED.map((s, i) => ({ ...s, id: `seed-${i}`, counted: false, sort: i }));

/** A retained row as a forecast order: counted only while ticked. */
export function retainedToOrder(r: RetainedOrder): DktOrder {
  return {
    inquiry_id: `retained:${r.id}`, rfq_number: r.name || 'Retained order', title: null, customer: r.customer, status: 'retained',
    fob_usd: r.fob_usd, fob_source: 'projection', margin_pct: r.margin_pct, cust_deposit_pct: r.cust_deposit_pct, advance_pct: r.advance_pct,
    po_month: r.po_month, ship_month: r.ship_month < r.po_month ? r.po_month : r.ship_month,
    done: { cust_deposit: false, advance: false, cust_balance: false, pv_balance: false },
    excluded: !r.counted, cust_lag_months: r.cust_lag_months, retained: true,
  };
}
