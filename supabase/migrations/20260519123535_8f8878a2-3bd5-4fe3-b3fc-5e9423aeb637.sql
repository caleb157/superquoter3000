ALTER TABLE public.customer_rfqs
  ADD COLUMN IF NOT EXISTS quoting_currency_rate_override numeric;

COMMENT ON COLUMN public.customer_rfqs.quoting_currency_rate_override IS
  'Optional override: INR per 1 unit of the inquiry quoting_currency. When set, this rate is frozen into quote snapshots instead of the global currencies table import rate. exchange_rate_override (INR per USD) remains the legacy field used by costing displays.';