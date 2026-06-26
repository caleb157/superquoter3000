## Goal
In the inquiry Pricing Grid, let the user set the waste factor for raw-piece COGS rows — both individually per product and via a "default / apply to all" control.

## Changes — `src/pages/InquiryPricingGrid.tsx` only

### 1. Toolbar: default raw-piece waste
- New numeric input "Raw piece waste %" in the existing toolbar next to the export/import buttons.
- Initial value pulled from the most common existing `waste_factor` on raw-piece rows for this inquiry (fallback `0`).
- Button **Apply to all** → updates `waste_factor = value/100` on every raw-piece `cogs_items` row across all products in the inquiry (single bulk `update ... in('id', ids)` call), then refreshes local state.
- Also used as the default when the grid lazily creates a new raw-piece row (currently hard-coded `waste_factor: 0` at line 214) — new rows inherit the current toolbar value.

### 2. Per-product waste column
- Add a small **Waste %** input cell in each raw-piece row group (one per product row, shown alongside the existing per-vendor price cells — leftmost sticky area, after product name).
- Editing it writes `waste_factor` to all raw-piece `cogs_items` rows for that product (so all vendor slots stay in sync, matching how the rest of the grid treats raw-piece slots as one logical line).
- Debounced save (reuse the existing debounce pattern already used for price edits).

### 3. No schema / formula changes
- `cogs_items.waste_factor` already exists and is consumed by the costing engine — we're only surfacing it.
- Subcontracting and hardware rows are untouched (user only asked for raw pieces).
- No changes to `costing-engine.ts`, `calculations.ts`, or migrations.

## Out of scope
- Waste factor for subcontracting/hardware (can add later if asked).
- Persisting the toolbar default across sessions — it's a per-visit convenience, not a saved setting.
