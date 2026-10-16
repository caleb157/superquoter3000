-- DKT Cash Flow: Allegro saves up for an Amazon launch; the month it's reached, the amount moves
-- into DKT's cash flow (in from Allegro, out to the launch).
ALTER TABLE public.dkt_cash_settings
  ADD COLUMN IF NOT EXISTS allegro_launch_usd numeric NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS allegro_launch_on boolean NOT NULL DEFAULT true;
