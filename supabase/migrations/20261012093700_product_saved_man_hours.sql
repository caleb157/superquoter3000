-- Man-hours per unit saved on each product next to the saved price and cost, so the
-- Inquiries list can show man-hours straight away (src/lib/stored-man-hours.ts).
-- Safe to run more than once. Existing products fill in by themselves: the Inquiries
-- list and the costing screens save the value the next time they cost a product.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS calculated_man_hours_per_unit numeric;

COMMENT ON COLUMN public.products.calculated_man_hours_per_unit IS
  'Man-hours per unit from the costing engine, saved with calculated_unit_price_usd. A cache: the live engine is the source of truth.';

-- Make the new column visible to the API right away.
NOTIFY pgrst, 'reload schema';
