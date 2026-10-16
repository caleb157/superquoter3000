-- DKT Cash Flow: the pipeline's DKT margin, customer deposit and advance to PV start from the
-- inquiry's projection; these hold the cash flow's own numbers until "Save to inquiry" writes them back.
ALTER TABLE public.dkt_order_status
  ADD COLUMN IF NOT EXISTS margin_pct numeric,
  ADD COLUMN IF NOT EXISTS cust_deposit_pct numeric,
  ADD COLUMN IF NOT EXISTS advance_pct numeric;
