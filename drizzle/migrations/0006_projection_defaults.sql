ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS default_certainty_pct numeric NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS default_cust_deposit_pct numeric NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS default_ie_deposit_pct numeric NOT NULL DEFAULT 0.80;
COMMENT ON COLUMN public.global_settings.opening_cash_inr IS 'DEPRECATED: opening cash now synced from Odoo asset_cash accounts';