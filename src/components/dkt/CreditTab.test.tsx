import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CreditTab } from './CreditTab';
import type { Forecast } from '@/lib/dkt-cashflow';

const lines = [
  { id: 's', name: 'Sooie', limit_usd: 20000, drawn_usd: 0, rate_pct: 5, maturity_month: '2027-03', notes: null },
  { id: 'a', name: 'Amex', limit_usd: 15300, drawn_usd: 0, rate_pct: 6.6, term_months: 6, monthly_fee_pct: 0.55, notes: null },
];
const forecast = { months: [], flows: [], need: null, lowest: null, creditHeadroom: 0 } as unknown as Forecast;
const noop = () => {};

describe('CreditTab real draws', () => {
  it('works out drawn today and available from real draws', () => {
    render(<CreditTab lines={lines} forecast={forecast} thisMonth="2026-10" horizon={6}
      draws={[{ id: 'd', line_id: 's', month: '2026-08', draw_date: '2026-08-15', amount_usd: 10000, actual: true, rate_pct: 5, maturity_month: '2027-03' }]}
      addLine={noop} updateLine={noop} removeLine={noop} addDraw={noop} updateDraw={noop} removeDraw={noop} />);
    expect(screen.getAllByText('Drawn today')[0].parentElement).toHaveTextContent('$10,000');
    expect(screen.getByText('Available today').parentElement).toHaveTextContent('$25,300');
    expect(screen.getByText('Draws taken')).toBeInTheDocument();
  });

  it('records a draw with terms seeded from the line', () => {
    const addDraw = vi.fn();
    render(<CreditTab lines={lines} forecast={forecast} thisMonth="2026-10" horizon={6} draws={[]}
      addLine={noop} updateLine={noop} removeLine={noop} addDraw={addDraw} updateDraw={noop} removeDraw={noop} />);
    fireEvent.click(screen.getByText('Record a draw'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(dialog.querySelector('select')!, { target: { value: 'a' } });
    const amount = screen.getByLabelText('Amount');
    fireEvent.change(amount, { target: { value: '10000' } });
    fireEvent.blur(amount);
    expect(dialog).toHaveTextContent('6 payments of $1,722 a month');
    fireEvent.click(screen.getByText('Add draw'));
    expect(addDraw).toHaveBeenCalledWith(expect.objectContaining({ line_id: 'a', amount_usd: 10000, actual: true, term_months: 6, monthly_fee_pct: 0.55, rate_pct: 6.6 }));
  });
});
