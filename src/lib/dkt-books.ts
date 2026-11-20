// DKT's own books (DKT's Odoo, read live by the odoo-dkt-books edge function) turned into DKT Cash Flow
// orders. Each open DKT sales order is the customer side; the purchase orders to PV that name it as their
// source are PV's side. Nothing is typed or guessed when the books have it:
//   customer still owes   = unpaid invoice residuals (due on their due dates; overdue = this month)
//                         + what's not invoiced yet, less customer deposits (credits on the customer's
//                           account, applied to that customer's open orders, oldest first)
//   DKT still owes PV     = unpaid PV bills (on their due dates) + PO amounts not billed yet, less DKT's
//                           advances to PV (debits on PV's account, applied oldest order first)
//   ship month            = the order's delivery date, else PV's ship date for the PO (from PV's Odoo),
//                           else the PO's planned date, else three months after the order; never before now
//   margin                = 1 − PV's POs ÷ the customer's order
// Unpaid customer invoices or PV bills whose order isn't open (e.g. CCT's invoice for an order already
// fully invoiced) still count, on their own.
import { addMonths, toMonth, type BookedOrder, type Flow, type Month } from './dkt-cashflow';

export type BooksRaw = {
  pv_partner: string | null;
  orders: {
    name: string; partner_id: number | null; partner: string; ref: string; date: string | null; ship_date: string | null;
    total_usd: number; invoiced_usd: number; to_invoice_usd: number;
    pos: { name: string; ref: string; state: string; date: string | null; planned: string | null; total_usd: number; invoice_status: string }[];
  }[];
  invoices: { name: string; partner_id: number | null; partner: string; origin: string; due: string | null; total_usd: number; residual_usd: number }[];
  bills: { name: string; origin: string; ref: string; due: string | null; total_usd: number; residual_usd: number }[];
  customer_credit: { partner_id: number; partner: string; credit_usd: number }[];
  pv_prepaid_usd: number;
  banks: { journal: string; balance_usd: number; as_of: string | null }[];
  fetched_at: string | null;
};

/** Per-order choices kept in the app: leave an order out, or move its ship month. */
export type BooksTerms = { so_name: string; excluded: boolean; ship_month: Month | null };

export type Due = { name: string; month: Month; amount: number };
export type BooksOrder = BookedOrder & {
  kind: 'order' | 'invoice' | 'bill';
  name: string; partner: string; ref: string;
  custTotal: number; custPaid: number; custOpen: Due[]; custUninvoiced: number; depositApplied: number;
  pvTotal: number; pvOpen: Due[]; pvUnbilled: number; advanceApplied: number;
  pos: string[];
  shipMonth: Month; shipSource: 'order' | 'pv' | 'po' | 'guess' | 'typed';
  marginPct: number | null;
};
export type Books = {
  orders: BooksOrder[];
  cash: { balance: number; asOf: string | null; journals: BooksRaw['banks'] } | null;
  unappliedDeposits: { partner: string; usd: number }[];
  unappliedAdvance: number;
  pvPartner: string | null;
  fetchedAt: string | null;
};

const names = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
/** PO numbers as tokens (P00038 = P38), to find PV's sales order whose customer reference names the PO. */
const poToken = (s: string) => [...String(s || '').toUpperCase().matchAll(/\bP0*(\d{2,})\b/g)].map(m => `P${m[1]}`);

/**
 * Builds the forecast orders from DKT's books.
 * @param pvShip PV's ship month for each of its sales orders to DKT, keyed by PV's customer reference
 *               (which starts with DKT's PO number, e.g. "P00038 Urban Tribes"). Optional.
 */
export function buildBooks(raw: BooksRaw, terms: BooksTerms[], thisMonth: Month, pvShip: { ref: string; ship_month: Month }[] = []): Books {
  const at = (m: Month | null) => (!m || m < thisMonth ? thisMonth : m);
  const termOf = new Map(terms.map(t => [t.so_name, t]));
  const pvByPo = new Map<string, Month>();
  for (const p of pvShip) for (const t of poToken(p.ref)) if (!pvByPo.has(t)) pvByPo.set(t, p.ship_month);

  // Customer deposits per customer, applied to that customer's open orders oldest first (to what isn't invoiced).
  const deposits = new Map(raw.customer_credit.map(c => [c.partner_id, c.credit_usd]));
  const advanceLeft = { usd: Math.max(0, raw.pv_prepaid_usd) };
  const openOrders = [...raw.orders].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const orders: BooksOrder[] = [];
  const usedInvoices = new Set<string>(), usedBills = new Set<string>();
  for (const o of openOrders) {
    const t = termOf.get(o.name);
    const invs = raw.invoices.filter(i => names(i.origin).includes(o.name));
    invs.forEach(i => usedInvoices.add(i.name));
    const custOpen: Due[] = invs.filter(i => i.residual_usd > 0.5).map(i => ({ name: i.name, month: at(toMonth(i.due)), amount: i.residual_usd }));
    let depositApplied = 0;
    if (!t?.excluded && o.partner_id != null) {
      const left = deposits.get(o.partner_id) ?? 0;
      depositApplied = Math.min(left, o.to_invoice_usd);
      deposits.set(o.partner_id, left - depositApplied);
    }
    const custUninvoiced = Math.max(0, o.to_invoice_usd - depositApplied);
    const custOwed = custOpen.reduce((s, d) => s + d.amount, 0) + custUninvoiced;

    const pos = o.pos.filter(p => p.state !== 'cancel');
    const poNames = pos.map(p => p.name);
    const billRows = raw.bills.filter(b => names(b.origin).some(n => poNames.includes(n)));
    billRows.forEach(b => usedBills.add(b.name));
    const pvOpen: Due[] = billRows.filter(b => b.residual_usd > 0.5).map(b => ({ name: b.name, month: at(toMonth(b.due)), amount: b.residual_usd }));
    const unbilledRaw = pos.filter(p => p.invoice_status !== 'invoiced').reduce((s, p) => s + p.total_usd, 0);
    let advanceApplied = 0;
    if (!t?.excluded) { advanceApplied = Math.min(advanceLeft.usd, unbilledRaw); advanceLeft.usd -= advanceApplied; }
    const pvUnbilled = Math.max(0, unbilledRaw - advanceApplied);
    const pvTotal = pos.reduce((s, p) => s + p.total_usd, 0);

    // Ship month: typed, else the order's delivery date, else PV's ship date, else the PO's planned date.
    let shipMonth: Month; let shipSource: BooksOrder['shipSource'];
    const pvM = poNames.flatMap(poToken).map(tk => pvByPo.get(tk)).find(Boolean) ?? null;
    const plannedM = pos.map(p => toMonth(p.planned)).filter(Boolean).sort().pop() ?? null;
    if (t?.ship_month) { shipMonth = t.ship_month; shipSource = 'typed'; }
    else if (o.ship_date) { shipMonth = toMonth(o.ship_date)!; shipSource = 'order'; }
    else if (pvM) { shipMonth = pvM; shipSource = 'pv'; }
    else if (plannedM) { shipMonth = plannedM; shipSource = 'po'; }
    else { shipMonth = addMonths(toMonth(o.date) ?? thisMonth, 3); shipSource = 'guess'; }
    shipMonth = at(shipMonth);

    const label = `${o.name}${o.partner ? ` · ${o.partner}` : ''}`;
    const flows: Flow[] = [
      ...custOpen.map(d => ({ month: d.month, kind: 'cust_balance' as const, amount: d.amount, label: `${label} · ${d.name}`, ref: o.name })),
      ...(custUninvoiced > 0.5 ? [{ month: shipMonth, kind: 'cust_balance' as const, amount: custUninvoiced, label, ref: o.name }] : []),
      ...pvOpen.map(d => ({ month: d.month, kind: 'odoo_invoice' as const, amount: -d.amount, label: `${label} · ${d.name}`, ref: o.name })),
      ...(pvUnbilled > 0.5 ? [{ month: shipMonth, kind: 'odoo_to_invoice' as const, amount: -pvUnbilled, label: `${label} · ${poNames.join(', ')}`, ref: o.name }] : []),
    ];
    const lastIn = [...custOpen.map(d => d.month), ...(custUninvoiced > 0.5 ? [shipMonth] : [])].sort().pop() ?? null;
    orders.push({
      key: `dkt:${o.name}`, label, flows, excluded: !!t?.excluded,
      // Earned when it ships; an order already fully invoiced was earned before this forecast.
      profit: o.to_invoice_usd > 0.5 ? { month: shipMonth, revenue: o.total_usd, cost: pvTotal } : null,
      loanMonth: lastIn,
      kind: 'order', name: o.name, partner: o.partner, ref: o.ref,
      custTotal: o.total_usd, custPaid: Math.max(0, o.total_usd - custOwed), custOpen, custUninvoiced, depositApplied,
      pvTotal, pvOpen, pvUnbilled, advanceApplied, pos: poNames, shipMonth, shipSource,
      marginPct: o.total_usd > 0 && pvTotal > 0 ? 1 - pvTotal / o.total_usd : null,
    });
  }

  // Unpaid customer invoices and PV bills whose order isn't open: count them on their own.
  for (const i of raw.invoices.filter(x => !usedInvoices.has(x.name) && x.residual_usd > 0.5)) {
    const t = termOf.get(i.name);
    const m = at(toMonth(i.due));
    const label = `${i.name}${i.partner ? ` · ${i.partner}` : ''}${i.origin ? ` (${i.origin})` : ''}`;
    orders.push({
      key: `dkt:${i.name}`, label, excluded: !!t?.excluded, profit: null, loanMonth: m,
      flows: [{ month: m, kind: 'cust_balance', amount: i.residual_usd, label, ref: i.name }],
      kind: 'invoice', name: i.name, partner: i.partner, ref: i.origin,
      custTotal: i.total_usd, custPaid: i.total_usd - i.residual_usd, custOpen: [{ name: i.name, month: m, amount: i.residual_usd }], custUninvoiced: 0, depositApplied: 0,
      pvTotal: 0, pvOpen: [], pvUnbilled: 0, advanceApplied: 0, pos: [], shipMonth: m, shipSource: 'order', marginPct: null,
    });
  }
  for (const b of raw.bills.filter(x => !usedBills.has(x.name) && x.residual_usd > 0.5)) {
    const t = termOf.get(b.name);
    const m = at(toMonth(b.due));
    const label = `${b.name} · ${raw.pv_partner ?? 'PV'}${b.origin ? ` (${b.origin})` : ''}`;
    orders.push({
      key: `dkt:${b.name}`, label, excluded: !!t?.excluded, profit: null, loanMonth: null,
      flows: [{ month: m, kind: 'odoo_invoice', amount: -b.residual_usd, label, ref: b.name }],
      kind: 'bill', name: b.name, partner: raw.pv_partner ?? 'PV', ref: b.origin,
      custTotal: 0, custPaid: 0, custOpen: [], custUninvoiced: 0, depositApplied: 0,
      pvTotal: b.total_usd, pvOpen: [{ name: b.name, month: m, amount: b.residual_usd }], pvUnbilled: 0, advanceApplied: 0, pos: [], shipMonth: m, shipSource: 'order', marginPct: null,
    });
  }

  const bank = raw.banks.filter(b => Number.isFinite(b.balance_usd));
  return {
    orders,
    cash: bank.length ? { balance: bank.reduce((s, b) => s + b.balance_usd, 0), asOf: bank.map(b => b.as_of).filter(Boolean).sort().pop() ?? null, journals: bank } : null,
    unappliedDeposits: raw.customer_credit.map(c => ({ partner: c.partner, usd: deposits.get(c.partner_id) ?? 0 })).filter(c => c.usd > 0.5),
    unappliedAdvance: advanceLeft.usd,
    pvPartner: raw.pv_partner,
    fetchedAt: raw.fetched_at,
  };
}
