-- Live costing rates: Odoo exchange rate and LaborTrax labor cost per man-hour,
-- written by the live-rates-sync function. Costing reads them only while
-- use_live_rates is on (src/lib/live-rates.ts). Safe to re-run.
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS use_live_rates boolean NOT NULL DEFAULT false;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS live_exchange_rate numeric;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS live_currency_rates jsonb;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS live_exchange_rate_at timestamptz;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS live_burdened_per_mh numeric;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS live_direct_rates jsonb;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS live_labor_detail jsonb;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS live_labor_at timestamptz;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS live_rates_warnings text[];
