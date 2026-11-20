import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PullAsNeededCard } from './PullAsNeededCard';
import { DEFAULT_SETTINGS, type ForecastInput } from '@/lib/dkt-cashflow';
import { pullAsNeeded } from '@/lib/dkt-pull-as-needed';

const inp: ForecastInput = {
  settings: { ...DEFAULT_SETTINGS, cash_usd: 5000, min_cash_usd: 1000, horizon_months: 6, allegro_launch_on: false },
  thisMonth: '2026-11', orders: [], loans: [], loanPayments: [], amazonSkus: [], creditDraws: [],
  creditLines: [{ id: 's', name: 'Sooie', limit_usd: 20000, drawn_usd: 0, rate_pct: 5, balloon: true, draw_priority: 1 }],
  costs: [{ id: 'b', name: 'bill', kind: 'expense', amount_usd: 10000, frequency: 'once', start_month: '2026-12', end_month: null }],
};

describe('PullAsNeededCard', () => {
  it('switches on and shows the pulls by month', () => {
    const setPrefs = vi.fn();
    const { rerender } = render(<PullAsNeededCard prefs={{ on: false }} setPrefs={setPrefs} plan={null} minCash={1000} queueSize={1} openCredit={() => {}} />);
    fireEvent.click(screen.getByLabelText('Pull credit as needed'));
    expect(setPrefs).toHaveBeenCalledWith({ on: true });
    rerender(<PullAsNeededCard prefs={{ on: true }} setPrefs={setPrefs} plan={pullAsNeeded(inp, { s: 1 })} minCash={1000} queueSize={1} openCredit={() => {}} />);
    expect(screen.getByText('Pull $6,000 from Sooie')).toBeInTheDocument();
  });

  it('asks for a pull order when no line has one', () => {
    render(<PullAsNeededCard prefs={{ on: true }} setPrefs={() => {}} plan={pullAsNeeded(inp, {})} minCash={1000} queueSize={0} openCredit={() => {}} />);
    expect(screen.getByText(/No credit line has a pull order yet/)).toBeInTheDocument();
  });
});
