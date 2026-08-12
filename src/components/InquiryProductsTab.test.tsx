import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- Mock heavy/irrelevant child components to keep the test focused on price rendering ---
vi.mock('@/components/ProductStagePills', () => ({
  ProductStagePills: () => null,
  SingleStagePill: () => null,
}));
vi.mock('@/components/BulkStageActions', () => ({ BulkStageActions: () => null }));
vi.mock('@/components/GenerateSampleDialog', () => ({ GenerateSampleDialog: () => null }));
vi.mock('@/components/ConfirmDeleteButton', () => ({ ConfirmDeleteButton: () => null }));
vi.mock('@/components/UploadParseDialog', () => ({ UploadParseDialog: () => null }));
vi.mock('@/components/QuickAddProductsDialog', () => ({ QuickAddProductsDialog: () => null }));
vi.mock('@/components/CopyProductsDialog', () => ({ CopyProductsDialog: () => null }));
vi.mock('@/components/HardwareSyncDialog', () => ({ HardwareSyncDialog: () => null }));
vi.mock('@/components/QuotePriceReviewDialog', () => ({ QuotePriceReviewDialog: () => null }));
vi.mock('@/components/BulkCostingUpdateDialog', () => ({ BulkCostingUpdateDialog: () => null }));
vi.mock('@/components/BulkQuantityDialog', () => ({ BulkQuantityDialog: () => null }));
vi.mock('@/components/BulkLogRfqRfsDialog', () => ({ BulkLogRfqRfsDialog: () => null }));
vi.mock('@/lib/hardware-sync', () => ({
  getHardwareSyncPlan: vi.fn(),
  applyHardwareSync: vi.fn(),
}));

const computeMock = vi.fn();
vi.mock('@/lib/product-pricing', () => ({
  computeProductPriceAndCost: (...args: unknown[]) => computeMock(...args),
}));

// --- Supabase client mock: returns one product with the saved product unit price ---
const productRow = {
  id: 'p1',
  name: 'Test Chair',
  sku: 'TC-1',
  quantity: null,
  updated_at: new Date().toISOString(),
  design_stage: null,
  quote_stage: null,
  sample_stage: null,
  target_price_usd: 123.45,
  markup_percent: null,
  cogs_done: null,
  cbm_done: null,
  overhead_done: null,
  shipping_done: null,
  revenue_done: null,
  calculated_unit_price_usd: 0.22,
  calculated_unit_cost_usd: null,
};

const updateEqMock = vi.fn().mockResolvedValue({ error: null });

// Chainable query-builder mock: every builder method returns the builder, and the
// builder itself is thenable so `await`ing at any point yields the table's rows.
function makeBuilder(rows: any[]) {
  const result = { data: rows, error: null, count: rows.length };
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          return (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => Promise.resolve({ data: rows[0] ?? null, error: null });
        }
        return () => builder;
      },
    },
  );
  return builder;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'products') {
        return {
          select: () => makeBuilder([productRow]),
          update: (vals: unknown) => ({
            eq: (_col: string, id: string) => updateEqMock(vals, id),
          }),
        };
      }
      if (table === 'customer_rfqs') {
        return { select: () => makeBuilder([{ quoting_currency: 'USD' }]) };
      }
      return { select: () => makeBuilder([]) };
    },
  },
}));

import { InquiryProductsTab } from './InquiryProductsTab';

describe('InquiryProductsTab unit price rendering', () => {
  beforeEach(() => {
    computeMock.mockReset();
    computeMock.mockResolvedValue({});
    updateEqMock.mockClear();
  });

  it('shows the saved product unit price without persisting a new one', async () => {
    render(
      <MemoryRouter>
        <InquiryProductsTab
          inquiryId="inq-1"
          initialFilter="all"
          onFilterChange={() => {}}
          onChange={() => {}}
        />
      </MemoryRouter>,
    );

    // Price renders (formatted via fmt.usd — assert on the numeric portion)
    await waitFor(() => {
      const matches = screen.getAllByText((_, el) =>
        !!el && /123\.45/.test(el.textContent || ''),
      );
      expect(matches.length).toBeGreaterThan(0);
    });

    expect(updateEqMock).not.toHaveBeenCalled();
  });
});

