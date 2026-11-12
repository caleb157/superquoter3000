-- DKT Cash Flow: Allegro launches Amazon SKUs. Share of each launch budget spent on launch costs
-- (listing, photos, samples, first ads); the rest buys the first order.
ALTER TABLE public.dkt_cash_settings
  ADD COLUMN IF NOT EXISTS allegro_launch_cost_pct numeric NOT NULL DEFAULT 0.25;

-- Scenarios can be paid for by Allegro (column is in the first DKT cash flow SQL; added here in case it isn't).
ALTER TABLE public.dkt_amazon_scenarios
  ADD COLUMN IF NOT EXISTS funding text NOT NULL DEFAULT 'dkt';
