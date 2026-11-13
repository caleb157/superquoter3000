// The inquiry page's costing bar: it loads the inquiry's costing once SKUs are ticked, then
// shows the workspace's selection bar for the ticked SKUs that are in the costing.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => ({}), storage: { from: () => ({}) } } }));
vi.mock('@/lib/cogs-categories', async orig => ({ ...(await orig<any>()), useCogsCategories: () => ['Raw Piece', 'Subcontracting', 'Finishing Materials', 'Packaging'] }));
vi.mock('@/lib/costing-workspace', async orig => {
  const real = await orig<any>();
  const { bundle } = await import('@/lib/__tests__/workspace-fixture');
  return { ...real, loadBundle: vi.fn(async () => bundle()) };
});

import { InquiryBulkBar } from './InquiryBulkBar';

function setup(ids: string[]) {
  const onClear = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <InquiryBulkBar inquiryId="inq1" ids={ids} onClear={onClear} onChanged={() => {}} reloadKey="0" />
      </TooltipProvider>
    </MemoryRouter>,
  );
  return { onClear };
}

describe('InquiryBulkBar', () => {
  it('shows the bulk bar for the ticked SKUs once the costing has loaded', async () => {
    const { onClear } = setup(['a', 'b', 'not-in-this-inquiry']);
    expect(screen.getByText(/Loading costing for the 3 selected/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Add items')).toBeTruthy());
    // Only the SKUs that are in the costing are counted.
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Target')).toBeTruthy();
    expect(screen.getByText('Full sheet').closest('a')?.getAttribute('href')).toBe('/inquiry/inq1/costing?select=a,b');
    // The workspace-only actions are left to the page's own bar.
    expect(screen.queryByText('Generate quote')).toBeNull();
    expect(screen.queryByText('Duplicate')).toBeNull();
    fireEvent.click(screen.getByLabelText('Clear selection'));
    expect(onClear).toHaveBeenCalled();
  });

  it('shows nothing when none of the ticked SKUs is in the costing', async () => {
    setup(['zzz']);
    await waitFor(() => expect(screen.queryByText(/Loading costing/)).toBeNull());
    expect(screen.queryByText('Add items')).toBeNull();
  });
});
