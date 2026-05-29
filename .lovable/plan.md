## Fix 1 — Weighted Pipeline uses revenue, not cost

**File:** `src/lib/pipeline-weights.ts` (`computeWeightedPipeline`)

Today the fallback path (products without a projection row) accumulates `qty × unit_cost × stage_weight`. Change it to `qty × unit_price × stage_weight` so every contributor is on the revenue side, identical to the Projections FOB column.

- Replace `cost = pricing[p.id]?.unit_cost_usd` with `price = pricing[p.id]?.unit_price_usd` as the value driver.
- Keep cost around only for the profit calc: `profit += qty × max(0, price − cost) × weight` (unchanged).
- Skip products with `price === 0` instead of `cost === 0` (rename `skippedNoCost` → `skippedNoPrice`; update Dashboard usage if it reads that field).
- Contributor rows: keep `cost` field for the drill-down "Unit cost" column, but `value = qty × price × weight`. Add `price` to the contributor shape so the drill-down can show both if desired (optional — current UI keeps showing cost).

**File:** `src/components/analytics/SalesDashboard.tsx`
- Update the Weighted Pipeline card sublabel from `Σ qty × FOB cost × stage weight` → `Σ qty × FOB price × stage weight` (or "Σ FOB revenue × stage weight").

**File:** `src/pages/Dashboard.tsx`
- Verify the same helper is used and labels match; update any sublabel that still references cost.

Result: Weighted Pipeline ≈ weighted sum of the FOB column on Projections (for forward inquiries: active / projected_po / po).

## Fix 2 — Monthly cells show unweighted customer payments

**File:** `src/components/analytics/ProjectionsTable.tsx`

In `cashForMonth`, drop the `× certainty` factor so each cell is the raw scheduled customer payment: `FOB × pct` per milestone falling in that month, summed across deposit / final / other.

- Remove `certainty` from the multiplication inside `cashForMonth`.
- Keep using `projected_fob_revenue_usd` if set, else `autoFob` (already wired in `computedRows`).
- Update the footer note from "Month cells show weighted customer payments only (revenue side)." → "Month cells show scheduled customer payments (FOB × milestone %, unweighted)."
- TOTAL row's `perMonth` automatically reflects the new values.

**File:** `supabase/functions/push-projections-to-sheets/index.ts`
- Mirror the same unweighting in the sheet push so the Google Sheet matches the UI. Find the per-month accumulation (uses the same `cust_*_pct × FOB × certainty` pattern) and drop the certainty factor.

## Out of scope

- No schema changes.
- No changes to `effectiveCertainty`, `projectedGrossProfit`, or the Exp GP column (those stay weighted).
- No change to CashflowForecastCard unless its labels reference the old behavior — I'll check and only touch labels if needed.

## Verification

- Manually compare: sum of FOB column on Projections (forward statuses only, no override) vs Weighted Pipeline card — should match after weighting by certainty per row.
- Tableware row: Jun '26 and Aug '26 cells should jump from `$438` (weighted at 25%) to `$1,752` each (unweighted: FOB × 50%) — or whatever pct is configured.
- Push to Sheets and confirm month columns match the UI.
