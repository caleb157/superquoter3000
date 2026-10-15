-- DKT Cash Flow: what DKT has already paid PV on a confirmed Odoo order, typed in, so prepayments
-- PV hasn't matched to an invoice in Odoo stop showing as upcoming payments.
ALTER TABLE public.dkt_odoo_order_terms ADD COLUMN IF NOT EXISTS pv_paid_usd numeric;
