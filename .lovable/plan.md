## Problem

Rows created from the Pricing Grid land in `cogs_items` with `components_per_product = 0` (the column default). The costing engine multiplies unit_cost × components_per_product, so a vendor price entered in the grid never shows up on the costing sheet — the row is effectively muted. That defeats the purpose of the grid.

## Fix

Default the qty to 1 on every Pricing Grid–created Raw Piece / Subcontracting / Hardware row, and expose a small control so the user can override that default for the whole grid before entering prices.

### 1. Default qty = 1 on row creation

In `src/pages/InquiryPricingGrid.tsx`, `ensureRow()` currently inserts each new row without setting `components_per_product`. Change all three insert paths (raw, subc, hw) to include `components_per_product: defaultQtyPerSku`. This is the only persistence change — existing rows are untouched.

### 2. Backfill qty when a price is written into an existing 0-qty row

In `writeCell()` (price branch), after persisting `unit_cost_inr`, look up the row in state; if its `components_per_product` is `0` (or null), also patch it to `defaultQtyPerSku`. This handles two cases:
- Rows that were auto-created by costing seed with qty 0 (so a price typed in the grid actually flows through).
- Rows added earlier in this session before the user changed the default.

Vendor-name writes do NOT touch qty.

### 3. "Default qty per SKU" input in the grid header

Add a small numeric input next to the existing action buttons:

```
Default qty per SKU: [ 1 ]   (used for new rows created from this grid)
```

- State: `defaultQtyPerSku`, number, initial `1`, min `0`, step `1`.
- Persists only in component state (no DB, no localStorage — matches the rest of this page).
- Used by both (1) and (2) above.
- Tooltip / helper text: "New raw-piece / subcontract / hardware rows created by typing or pasting into this grid use this quantity. Existing rows are not changed."

### 4. Vendor-price import path

`VendorPriceImportDialog` calls back into the same `ensureRow`/update path? Confirm during build: if the dialog inserts rows directly via Supabase rather than via `ensureRow`, mirror the same `components_per_product: defaultQtyPerSku` default there (pass the value in as a prop). If it only updates existing rows, no change needed.

## Out of scope

- Touching rows that already have a non-zero `components_per_product` (never overwrite a real qty).
- A per-SKU qty column in the grid itself (the user offered this as an alternative; the single header input is simpler and matches "raw piece is almost always 1 per SKU"). Easy to add later if needed.
- Changing the DB column default (other code paths legitimately create 0-qty rows).
- Recosting on qty change alone — the existing `recostInBackground(productId)` already fires after winner selection / price changes, which is when the grid actually wants to refresh costing.

## Files touched

- `src/pages/InquiryPricingGrid.tsx` — add state, header input, pass qty into inserts, backfill on price write.
- `src/components/VendorPriceImportDialog.tsx` — accept + apply `defaultQtyPerSku` when it inserts new rows (verify during build whether it inserts or only updates).
