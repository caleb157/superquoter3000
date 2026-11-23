// The simpler product view folded out under a costing SKU row.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({}), storage: { from: () => ({}) } } }));
vi.mock('@/components/VendorCombobox', () => ({ VendorCombobox: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('@/components/ProductChemicalsPicker', () => ({ ProductChemicalsPicker: () => <div /> }));
vi.mock('@/lib/cogs-categories', async orig => ({ ...(await orig<any>()), useCogsCategories: () => ['Raw Piece', 'Packaging'] }));

import { SkuGlance } from './SkuGlance';
import { buildRows, computeResults } from '@/lib/costing-workspace';
import { bundle } from '@/lib/__tests__/workspace-fixture';

describe('SkuGlance', () => {
  it('shows the cost sum and offers the full costing and product page', () => {
    const b = bundle();
    const row = buildRows(b, computeResults(b)).find(r => r.p.id === 'a')!;
    const onOpen = vi.fn(); const onFold = vi.fn();
    render(<MemoryRouter><TooltipProvider><SkuGlance row={row} bundle={b} apply={vi.fn()} onOpen={onOpen} onFold={onFold} /></TooltipProvider></MemoryRouter>);
    expect(screen.getByText('Unit cost')).toBeTruthy();
    expect(screen.getByLabelText('Open the product page').getAttribute('href')).toBe('/product/a?tab=costing');
    fireEvent.click(screen.getByText('Full costing'));
    fireEvent.click(screen.getByLabelText('Fold the product view'));
    expect(onOpen).toHaveBeenCalled();
    expect(onFold).toHaveBeenCalled();
  });
});
