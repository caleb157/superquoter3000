import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AllegroTab } from './AllegroTab';
import { AmazonTab } from './AmazonTab';
import { allegroLaunchPlan, DEFAULT_SETTINGS } from '@/lib/dkt-cashflow';
import type { AmazonSku } from '@/lib/dkt-amazon';

// Recharts' ResponsiveContainer needs a ResizeObserver in jsdom.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

const settings = { ...DEFAULT_SETTINGS, allegro_as_of: '2026-10-01' };
const sku: AmazonSku = {
  id: 'a1', scenario_id: 'al', name: 'Tray', mode: 'inventory', price_usd: 40, net_margin_pct: 0.25, units_per_month: 100,
  start_month: null, unit_cost_usd: 8, freight_per_unit_usd: 2, order_qty: 0, make_months: 2, ship_months: 2,
};
const scenarios = [{ id: 'al', name: 'Allegro launches', notes: null, in_forecast: false, funding: 'allegro' as const }];
const noop = () => {};

describe('Allegro launches', () => {
  it('offers to make an Allegro launch scenario when none exists', () => {
    const add = vi.fn();
    render(<AllegroTab settings={settings} saveSettings={noop} thisMonth="2026-10" lookahead={24} skus={[]} scenarios={[]} launches={[]}
      addAllegroScenario={add} setFunding={noop} openAmazon={noop} updateSku={noop} />);
    fireEvent.click(screen.getByText('Make an Allegro launch scenario'));
    expect(add).toHaveBeenCalled();
  });

  it('shows each launch with its month, split and first order on both tabs', () => {
    const launches = allegroLaunchPlan(settings, scenarios, [sku], '2026-10', 44);
    render(<AllegroTab settings={settings} saveSettings={noop} thisMonth="2026-10" lookahead={24} skus={[sku]} scenarios={scenarios} launches={launches}
      addAllegroScenario={noop} setFunding={noop} openAmazon={noop} updateSku={noop} />);
    const row = screen.getByText('1. Tray').closest('tr')!;
    expect(row).toHaveTextContent('Feb 27');
    expect(row).toHaveTextContent('$5,000');
    expect(row).toHaveTextContent('375 units');
    expect(row).toHaveTextContent('Jun 27');
  });

  it('works out the Amazon card from Allegro and counts launch costs', () => {
    const launches = allegroLaunchPlan(settings, scenarios, [sku], '2026-10', 44);
    render(<AmazonTab scenarios={scenarios} skus={[sku]} viewSkus={launches.map(l => l.launched)} launches={launches} settings={settings} saveSettings={noop}
      thisMonth="2026-10" lookahead={24} addScenario={noop} duplicateScenario={noop} updateScenario={noop} removeScenario={noop}
      addSku={noop} updateSku={noop} removeSku={noop} />);
    expect(screen.getAllByText('from Allegro')[0].parentElement).toHaveTextContent('Jun 27');
    expect(screen.getByText('Launch costs').parentElement).toHaveTextContent('$1,250');
    expect(screen.getByText(/Long View to/)).toBeInTheDocument();
  });

  it('pins a launch from the Allegro tab and shows DKT paying for it', () => {
    const updateSku = vi.fn();
    const pinned = { ...sku, launch_month: '2026-11', first_order_qty: 500 };
    const launches = allegroLaunchPlan(settings, scenarios, [pinned], '2026-10', 44);
    render(<AllegroTab settings={settings} saveSettings={noop} thisMonth="2026-10" lookahead={24} skus={[pinned]} scenarios={scenarios} launches={launches}
      addAllegroScenario={noop} setFunding={noop} openAmazon={noop} updateSku={updateSku} />);
    const row = screen.getByText('1. Tray').closest('tr')!;
    expect(row).toHaveTextContent('Nov 26 · pinned');
    expect(row).toHaveTextContent('500 units');
    expect(row).toHaveTextContent('$6,250');
    expect(screen.getByText('DKT pays $6,250')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Launch paid by'), { target: { value: 'allegro' } });
    expect(updateSku).toHaveBeenCalledWith('a1', { launch_paid_by: 'allegro' });
    fireEvent.change(screen.getByLabelText('Launch PO month'), { target: { value: '' } });
    expect(updateSku).toHaveBeenCalledWith('a1', { launch_month: null, launch_paid_by: null });
  });
});
