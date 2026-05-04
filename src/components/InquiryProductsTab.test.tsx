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

// --- Supabase client mock: returns one product with null calculated_* columns ---
const productRow = {
  id: 'p1',
  name: 'Test Chair',
  sku: 'TC-1',
  updated_at: new Date().toISOString(),
  design_stage: null,
  quote_stage: null,
  sample_stage: null,
  target_price_usd: null,
  markup_percent: null,
  cogs_done: null,
  cbm_done: null,
  overhead_done: null,
  shipping_done: null,
  revenue_done: null,
  calculated_unit_price_usd: null,
  calculated_unit_cost_usd: null,
};

const updateEqMock = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'product_types') {
        return {
          select: () => ({ order: () => Promise.resolve({ data: [] }) }),
        };
      }
      if (table === 'products') {
        return {
          select: () => ({
            eq: () => ({
              order: () => Promise.resolve({ data: [productRow] }),
            }),
          }),
          update: (vals: unknown) => ({
            eq: (_col: string, id: string) => updateEqMock(vals, id),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) };
    },
  },
}));

import { InquiryProductsTab } from './InquiryProductsTab';

describe('InquiryProductsTab unit price rendering', () => {
  beforeEach(() => {
    computeMock.mockReset();
    updateEqMock.mockClear();
  });

  it('shows unit price computed live when calculated_* columns are null, and persists it', async () => {
    computeMock.mockResolvedValue({
      p1: { unit_cost_usd: 80, unit_price_usd: 123.45, unit_price_inr: 0, exchange_rate: 0 },
    });

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

    // Live-computed values are persisted back to the products row
    expect(computeMock).toHaveBeenCalledWith(['p1']);
    await waitFor(() => {
      expect(updateEqMock).toHaveBeenCalledWith(
        { calculated_unit_price_usd: 123.45, calculated_unit_cost_usd: 80 },
        'p1',
      );
    });
  });
});
