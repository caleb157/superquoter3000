-- Rupee targets for INR customers (costing workspace in ₹).
-- Safe to run more than once: only adds what is missing.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS target_price_inr numeric;

COMMENT ON COLUMN public.products.target_price_inr IS
  'Customer target price per unit in INR, used when the inquiry''s quoting currency is INR. target_price_usd is kept alongside at the rate of the day.';
