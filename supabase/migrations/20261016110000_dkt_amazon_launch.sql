-- DKT Cash Flow: Amazon new-SKU launch terms. Blank = same as the rest of the SKU.
ALTER TABLE public.dkt_amazon_skus
  ADD COLUMN IF NOT EXISTS first_order_qty integer,
  ADD COLUMN IF NOT EXISTS launch_margin_pct numeric,
  ADD COLUMN IF NOT EXISTS launch_units_per_month numeric,
  ADD COLUMN IF NOT EXISTS ramp_months integer;
