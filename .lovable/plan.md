# Refactor Part 2 — Route ProductCostingTab through the shared engine

## Goal
Make the costing tab and `product-pricing.ts` produce identical numbers by sourcing the final summary, COGS/unit, overhead/unit, shipping/unit, and per-row resolved values from `computeProductCosting`. Eliminate duplicate orchestration where it's safe to do so.

## What changes in `ProductCostingTab.tsx`

### 1. Add the engine call (single useMemo, after data is loaded)
Build a `CostingEngineInput` from current state and call `computeProductCosting`. Memoize on every input. This produces `engine.summary`, `engine.cogsPerUnit`, `engine.nonUnitCogsPerUnit`, `engine.directOhPerUnit`, `engine.indirectOhPerUnit`, `engine.shippingPerUnit`, `engine.resolvedCogsRows`, plus engine-derived dims/costs.

### 2. Replace the final aggregation block (lines ~911-973) with engine fields
- `cogsPerUnit` → `engine.cogsPerUnit`
- `nonUnitCogsPerUnit` → `engine.nonUnitCogsPerUnit`
- `directOhPerUnit`, `totalDirectMhPerUnit`, `indirectOhPerMh`, `indirectOhPerUnit` → from engine
- `shippingPerUnit` → `engine.shippingPerUnit`
- `exchangeRate`, `markupPercent`, `summary` → from engine

Delete the now-dead inline `ohItems`/`cogsPerUnit`/`nonUnitCogsPerUnit`/`summary` lines.

### 3. Keep inline (display + persistence helpers that the engine doesn't expose)
These are inputs/byproducts of the same math, used by the CBM section UI and the CBM persistence effect. Leaving them avoids inventing new engine fields and avoids breaking the manual-MC-layout path:
- `icDims`, `icOd`, `icOdVolumeCbm`, `icVolume`
- `mcResult` (with the `mcManualLayout` override block), `mcOd`, `mcOdVolumeCbm`
- `icCost`, `mcCost`, `avgIcCostPerSqIn`, `avgMcCostPerSqIn`
- `wrappingResult`, `finalUnitCbm`, `totalCbm`
- `ri`, `prePackCbm`, `difficultyFactor`, `productsPerIc`

For the standard (auto MC layout) case these equal `engine.*` exactly — verified by the engine being a byte-for-byte port. So `engine.cogsPerUnit` will match what the inline display rows render. We do not pass any of these into the engine call directly; the engine recomputes them from `cbmRow`/`productType`/etc. inputs.

### 4. Auto-calc writeback effects (lines ~574-909) — unchanged
These already have epsilon-equality guards and self-converge. They are the side-effect arm of the same math the engine performs in-memory. After the swap:
- The auto-calc effects write computed `components_per_product`/`unit_cost_inr` to `cogs_items` rows.
- On the next render the engine reads those rows; its in-memory override produces the same values; `engine.cogsPerUnit` agrees with the displayed row totals.
- The effects re-check equality and stop writing. No loop.

Per-row displayed qty/cost continues to come from `cogsItems[]` state (which holds the persisted values) — not from `engine.resolvedCogsRows`. The two are equal post-convergence, and reading from state avoids a second source of truth for the editable inputs.

### 5. `calculated_unit_price_usd` writeback (lines 989-1012) — unchanged shape
Same effect, but now reads `engine.summary.unit_price_usd` / `engine.summary.product_cost_per_unit_usd`. The unmount-flush stays.

### 6. Mobile branch
`ProductCostingTabMobile` receives the same prop names; we pass `engine.*` values through. No mobile-component changes needed.

## Manual MC layout — the one real gap

`ProductCostingTab` has a `mcManualLayout` override block (lines 469-483) that lets users hand-pick `mc_ics_along_w/d/h`. The shared engine (and `product-pricing.ts`) does NOT honor this — it always runs `calcMCPacking` in auto mode.

**Current state (after Part 1):** the inquiry list / quote / analytics already ignore manual MC layout. The costing tab is the only place that respects it.

**Two options:**

**Option A — accept the gap (recommended).** For manual-layout products, `engine.cogsPerUnit` will reflect auto MC packing (probably different `products_per_mc` → different per-unit MC cost), so the tab's displayed summary will change for those products. This makes the tab match the list/quote (the user's stated success criterion: "costing tab === inquiry list === quote, exactly"). Behavior change is limited to summary numbers; the manual-layout MC dims still display correctly because we leave `mcResult` inline.

**Option B — extend the engine.** Add an optional `mcResultOverride` to `CostingEngineInput`. Tab passes it when `mcManualLayout` is on; `product-pricing.ts` never does. Preserves tab behavior exactly but reintroduces a tab-only code path inside the "single source" engine.

I recommend **Option A** because the user wrote "Cake Stand and all products: costing tab === inquiry list === quote, exactly" — Option B would re-create the drift.

## Verification
- Run `vitest run` — golden master from Part 1 stays green (engine untouched).
- Open Cake Stand + ~6 other products spanning packaging types. Confirm header price/cost, badges, IC/MC dims, COGS row totals, target-price delta all unchanged from current live behavior (for non-manual-MC products) or now matching the list (for manual-MC products).
- Edit a COGS qty → row total updates → debounced persist → no repeat writes in network tab.
- Check console for any render loop warnings.

## Out of scope
No formula, schema, or UX changes. No engine signature change (under Option A).

## Decision needed
**Confirm Option A** (accept manual-layout convergence to auto, which fulfils "tab === list === quote") OR **switch to Option B** (engine accepts a manual-layout override, tab keeps current manual-MC numbers but list/quote still differ for those products).