-- DKT Cash Flow: real credit line draws next to planned ones. A real draw (actual = true) has the
-- day it was drawn and its own repayment terms (seeded from its line, blank = use the line's), and
-- what's drawn today is worked out from real draws instead of typed by hand.
ALTER TABLE public.dkt_credit_draws
  ADD COLUMN IF NOT EXISTS actual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS draw_date date,
  ADD COLUMN IF NOT EXISTS term_months integer,
  ADD COLUMN IF NOT EXISTS monthly_fee_pct numeric,
  ADD COLUMN IF NOT EXISTS rate_pct numeric,
  ADD COLUMN IF NOT EXISTS maturity_month date,
  ADD COLUMN IF NOT EXISTS notes text;

-- Turn each line's typed "Drawn today" into one real draw with the line's terms, then clear it.
-- The draw is dated when current cash was last saved (so it isn't counted as new cash), or today.
-- Only lines without a real draw yet, so running this again changes nothing.
DO $$
DECLARE d date := LEAST(current_date, COALESCE((SELECT cash_as_of FROM public.dkt_cash_settings WHERE id = 1), current_date));
BEGIN
  INSERT INTO public.dkt_credit_draws (line_id, month, amount_usd, actual, draw_date, term_months, monthly_fee_pct, rate_pct, maturity_month, notes)
  SELECT l.id, date_trunc('month', d)::date, l.drawn_usd, true, d, l.term_months, l.monthly_fee_pct, l.rate_pct, l.maturity_month,
         'Moved from "Drawn today". Check the date.'
  FROM public.dkt_credit_lines l
  WHERE l.drawn_usd > 0
    AND NOT EXISTS (SELECT 1 FROM public.dkt_credit_draws x WHERE x.line_id = l.id AND x.actual);
  UPDATE public.dkt_credit_lines l SET drawn_usd = 0
  WHERE l.drawn_usd > 0 AND EXISTS (SELECT 1 FROM public.dkt_credit_draws x WHERE x.line_id = l.id AND x.actual);
END $$;
