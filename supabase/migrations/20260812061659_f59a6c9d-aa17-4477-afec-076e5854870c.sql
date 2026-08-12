ALTER TABLE public.products
  ADD COLUMN is_outsourced boolean NOT NULL DEFAULT false,
  ADD COLUMN outsourced_unit_cost_usd numeric NULL;