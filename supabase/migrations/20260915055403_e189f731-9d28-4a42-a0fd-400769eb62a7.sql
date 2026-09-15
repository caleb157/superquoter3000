ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_of_capital_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cost_of_capital_monthly_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_of_capital_months numeric NOT NULL DEFAULT 0;