-- DKT Cash Flow: how much of "Customer paid" on a confirmed Odoo order is already in "Current cash".
-- Anything above it was received after current cash was typed, so the forecast adds it this month.
-- Saving a new current cash figure sets it equal to Customer paid.
ALTER TABLE public.dkt_odoo_order_terms ADD COLUMN IF NOT EXISTS cust_paid_in_cash_usd numeric;
-- Amounts typed before this change are taken as already in current cash (only rows not set yet).
UPDATE public.dkt_odoo_order_terms SET cust_paid_in_cash_usd = cust_paid_usd
 WHERE cust_paid_in_cash_usd IS NULL AND cust_paid_usd IS NOT NULL;
