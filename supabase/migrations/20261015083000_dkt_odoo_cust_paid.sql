-- DKT Cash Flow: what the customer has paid DKT on a confirmed Odoo order, typed in.
-- Replaces the deposit % and paid ticks on those orders (kept only as a fallback while this is blank).
ALTER TABLE public.dkt_odoo_order_terms ADD COLUMN IF NOT EXISTS cust_paid_usd numeric;
