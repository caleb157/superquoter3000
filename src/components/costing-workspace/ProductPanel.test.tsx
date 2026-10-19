// Smoke test for the product costing panel in both of its homes: the workspace drawer and
// the product page (page mode). Renders every section open and checks the page-only parts.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({}), storage: { from: () => ({}) } } }));
vi.mock('@/components/VendorCombobox', () => ({ VendorCombobox: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('@/components/ProductChemicalsPicker', () => ({ ProductChemicalsPicker: () => <div>chemicals picker</div> }));
vi.mock('@/lib/cogs-categories', async orig => ({ ...(await orig<any>()), useCogsCategories: () => ['Raw Piece', 'Subcontracting', 'Finishing Materials', 'Packaging'] }));

import { ProductPanel } from './ProductPanel';
import { buildRows, computeResults } from '@/lib/costing-workspace';
import { bundle } from '@/lib/__tests__/workspace-fixture';

function setup(page: boolean) {
  const b = bundle();
  const row = buildRows(b, computeResults(b)).find(r => r.p.id === 'a')!;
  const apply = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ProductPanel row={row} bundle={b} apply={apply} page={page} onReload={() => {}} onClose={() => {}} position="1 of 3" />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { apply };
}

describe('ProductPanel', () => {
  it('page mode shows product details, chemicals, the four steps in order and done flags, without the drawer header', () => {
    const { apply } = setup(true);
    expect(screen.getByText('Product details')).toBeTruthy();
    expect(screen.getByText('chemicals picker')).toBeTruthy();
    expect(screen.getByLabelText('3. Shipping done')).toBeTruthy();
    expect(screen.getByText(/Max raw piece at target/)).toBeTruthy();
    // Quantity and MOQs come first, ahead of the cost figures.
    const order = ['Qty', 'MOQ', 'Hard MOQ', 'Unit cost'].map(t => screen.getAllByText(t)[0]);
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The steps run in costing-sheet order: COGS, labour, shipping, margin.
    const steps = ['1. COGS', '2. Labour', '3. Shipping', '4. Margin'].map(t => screen.getAllByText(t)[0]);
    for (let i = 1; i < steps.length; i++) expect(steps[i - 1].compareDocumentPosition(steps[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText('Next SKU')).toBeNull();
    fireEvent.click(screen.getByLabelText('1. COGS done'));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('drawer mode keeps the SKU header and leaves out the page-only parts', () => {
    setup(false);
    expect(screen.getByLabelText('Next SKU')).toBeTruthy();
    expect(screen.queryByText('Product details')).toBeNull();
    expect(screen.queryByText('chemicals picker')).toBeNull();
  });
});
