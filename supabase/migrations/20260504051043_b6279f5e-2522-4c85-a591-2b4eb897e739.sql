ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS calculated_unit_price_usd numeric,
  ADD COLUMN IF NOT EXISTS calculated_unit_cost_usd numeric;