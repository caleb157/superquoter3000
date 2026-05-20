ALTER TABLE public.customer_rfqs
  ADD COLUMN IF NOT EXISTS po_received_date date,
  ADD COLUMN IF NOT EXISTS po_total_value_usd numeric,
  ADD COLUMN IF NOT EXISTS payment_terms_deposit_pct numeric DEFAULT 30,
  ADD COLUMN IF NOT EXISTS payment_terms_deposit_due_days integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_terms_balance_due_days integer DEFAULT 70,
  ADD COLUMN IF NOT EXISTS po_estimated_ship_date date;