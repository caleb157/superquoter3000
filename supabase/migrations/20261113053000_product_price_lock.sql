-- Costing: hold a product's price at a typed, target or quoted figure. While it is set the
-- price stays put and the margin floats as costs move. price_lock is in price_lock_currency
-- ('INR' or 'USD', the inquiry's quoting currency when it was locked). NULL = not locked.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_lock numeric,
  ADD COLUMN IF NOT EXISTS price_lock_currency text;
