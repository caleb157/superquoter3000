import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BooksOrdersCard, OrderSourceSwitch } from './BooksOrdersCard';
import { buildBooks, type BooksRaw } from '@/lib/dkt-books';

const raw: BooksRaw = {
  pv_partner: 'Parable Ventures Pvt Ltd',
  orders: [{ name: 'S00062', partner_id: 90, partner: 'Adam Fogleman', ref: 'urban tribes cafe', date: '2026-10-16', ship_date: '2026-12-10', total_usd: 19100, invoiced_usd: 0, to_invoice_usd: 19100,
    pos: [{ name: 'P00038', ref: '', state: 'purchase', date: '2026-10-16', planned: null, total_usd: 17190, invoice_status: 'no' }] }],
  invoices: [{ name: 'INV/2026/00017', partner_id: 83, partner: 'Carolina Chair and Table', origin: 'S00047', due: '2026-11-05', total_usd: 29571.05, residual_usd: 20511.5 }],
  bills: [], customer_credit: [{ partner_id: 90, partner: 'Adam Fogleman', credit_usd: 7000 }], pv_prepaid_usd: 0,
  banks: [{ journal: 'Mercury', balance_usd: 19271.83, as_of: '2026-11-12' }], fetched_at: null,
};

describe('BooksOrdersCard', () => {
  it("shows DKT's orders with real margin, deposit and the overdue CCT invoice", () => {
    const save = vi.fn();
    render(<BooksOrdersCard books={buildBooks(raw, [], '2026-11')} terms={[]} thisMonth="2026-11" loading={false} reload={() => {}} save={save} />);
    expect(screen.getByText('S00062')).toBeInTheDocument();
    expect(screen.getByText('10.0%')).toBeInTheDocument();
    expect(screen.getByText('incl. $7,000 deposit')).toBeInTheDocument();
    expect(screen.getByText('INV/2026/00017')).toBeInTheDocument();
    expect(screen.getByText('$20,512 due now')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Count S00062'));
    expect(save).toHaveBeenCalledWith('S00062', { excluded: true });
  });

  it("says when DKT's Odoo isn't connected and keeps PV's Odoo", () => {
    render(<OrderSourceSwitch source="pv" setSource={() => {}} booksLoading={false} booksError={{ message: 'x', notConnected: true }} />);
    expect(screen.getByText(/isn't connected yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "DKT's Odoo" })).toBeDisabled();
  });
});
