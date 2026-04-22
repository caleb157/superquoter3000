

## Add Packaging Type selector with IC-only / IC+MC / Corrugate+Bubble modes

Add a single dropdown that drives all packaging behavior on the costing sheet, replacing the old "Include Master Carton" checkbox. Add a new height buffer for MCs, and introduce a Corrugate + Bubble Wrap packaging mode with surface-area-based COGS driven by new global settings.

### 1. Database changes

**`products` table**
- Add `packaging_type` text, default `'ic_mc'` (values: `'ic_only' | 'ic_mc' | 'corrugate_bubble'`).
- Backfill: any product where the existing `cbm_estimates.include_mc = false` → `'ic_only'`, otherwise `'ic_mc'`.

**`cbm_estimates` table**
- Add `mc_height_buffer_inch` numeric, default `2.5`.
- (Existing `mc_buffer_inch` becomes the W/D buffer.)

**`global_settings` table** — new "Wrapping" group columns:
- `mc_height_buffer_inch` numeric, default `2.5` (seed for new products)
- `corrugate_kg_per_sq_in` numeric, default `0.25`
- `bubble_kg_per_sq_in` numeric, default `0.20`
- `corrugate_price_per_kg` numeric, default `0`
- `bubble_price_per_kg` numeric, default `0`

No RLS changes required (existing policies cover new columns).

### 2. Calculation engine (`src/lib/calculations.ts`)

- Extend `MCConfig` with `mc_height_buffer_inch`. Update `calcMCPacking`:
  - `along_w = floor((mc_max_width  - W_buffer) / ic_width)`
  - `along_d = floor((mc_max_depth  - W_buffer) / ic_depth)`
  - `along_h = floor((mc_max_height - H_buffer) / ic_height)`
  - `mc_width  = ic_width  * actual_w + W_buffer`
  - `mc_depth  = ic_depth  * actual_d + W_buffer`
  - `mc_height = ic_height * actual_h + H_buffer`
- Add `calcCorrugateBubblePackaging(productW, productD, productH, icAddPerSide, settings)`:
  - Wrapped dims = product + 2 × icAddPerSide on each axis → final unit CBM via `(W·D·H)/61020`.
  - Product surface area in sq in = `2(WD + DH + HW)`.
  - `corrugate_kg = SA × corrugate_kg_per_sq_in`; cost = `× corrugate_price_per_kg`.
  - `bubble_kg = SA × bubble_kg_per_sq_in`; cost = `× bubble_price_per_kg`.
  - Returns `{ wrapped_w, wrapped_d, wrapped_h, final_unit_cbm, corrugate_kg, corrugate_cost, bubble_kg, bubble_cost }`.

### 3. Product Costing Tab (`src/components/ProductCostingTab.tsx`)

**A. Product Info section**
- Add a `Packaging Type` Select next to Product Type with three options: "IC only", "IC + MC", "Corrugate + Bubble Wrap". Writes to `products.packaging_type`. Saving flips the `include_mc` flag implicitly so existing data stays consistent (`ic_only` → false, others → true for legacy code paths until removed).

**B. CBM Calculator section** — render conditionally on `packaging_type`:
- `ic_only`: Show only the IC row (type, products/IC, IC W/D/H, IC cost, IC volume, Final Unit CBM, Total CBM). Hide the "Include MC" checkbox and all MC fields.
- `ic_mc`: Remove the standalone "Include Master Carton" checkbox. Show IC row + MC fields. Add a new "MC H Buffer (in)" input next to the existing "Buffer (in)" (renamed to "MC W/D Buffer (in)"). Pass both buffers into `calcMCPacking`.
- `corrugate_bubble`: Hide IC type/box dropdowns and all MC fields. Show one panel with: wrapped dimensions, final unit CBM, total CBM, plus a small read-out of corrugate kg + cost and bubble kg + cost per unit. Box-data lookups are skipped entirely.

**C. COGS auto-population effects** — add `packaging_type` to dependency arrays:
- `ic_only`: keep IC-box auto row; force MC-box row to `include = 'No'`, `unit_cost = 0`, `qty = 0`.
- `ic_mc`: existing behavior (IC + MC auto rows, both `include = 'Yes'`).
- `corrugate_bubble`: force IC-box and MC-box rows to `include = 'No'`. Auto-create / maintain two rows under cogs_type `'Packaging'`:
  - `Corrugate Wrap` — units `KG`, `components_per_product = corrugate_kg`, `unit_cost_inr = corrugate_price_per_kg`, `is_auto_calculated = true`.
  - `Bubble Wrap` — units `KG`, `components_per_product = bubble_kg`, `unit_cost_inr = bubble_price_per_kg`, `is_auto_calculated = true`.
  - On switching back to IC/MC modes, set both wrap rows to `include = 'No'` (don't delete; preserves history).

### 4. Settings page (`src/pages/Settings.tsx`)

- Under the existing "Logistics" nav group rename or add a new group **Packaging** with one section: **Wrapping**.
- Form (admin-only edit, reuses `GeneralSettings` pattern) with these fields bound to `global_settings`:
  - MC Height Buffer (in) — default 2.5
  - Corrugate KG / sq in
  - Bubble Wrap KG / sq in
  - Corrugate Price (₹/kg)
  - Bubble Wrap Price (₹/kg)
- New product creation seeds `cbm_estimates.mc_height_buffer_inch` from this global value.

### 5. Quote / summary impact

- All downstream code already reads `final_unit_cbm` and `cogs_items` from the database, so quotes automatically reflect new packaging costs and CBM with no further changes.

### Technical notes

- The existing `include_mc` boolean stays in the schema for backward compatibility but is no longer user-toggleable; it's derived from `packaging_type` whenever the dropdown changes.
- Corrugate + Bubble mode bypasses `box_data` cost lookups entirely — surface-area math runs purely from product dimensions and global wrapping settings.
- Buffers are split: `mc_buffer_inch` continues to mean width/depth buffer; `mc_height_buffer_inch` is new and applied only on the height axis in `calcMCPacking`.
- Auto-row matching keys for the new wrap items: component_name = `Corrugate Wrap` / `Bubble Wrap` with `is_auto_calculated = true`, mirroring the IC/MC auto-row pattern.

