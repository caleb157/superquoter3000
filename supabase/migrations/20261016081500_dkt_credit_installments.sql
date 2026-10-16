-- DKT Cash Flow: installment credit lines (Amex business loan). Each draw is repaid in term_months
-- equal payments starting the month after, plus monthly_fee_pct of the draw each month.
ALTER TABLE public.dkt_credit_lines
  ADD COLUMN IF NOT EXISTS term_months integer,
  ADD COLUMN IF NOT EXISTS monthly_fee_pct numeric;

-- Amex: 6 monthly payments, 0.55% of the draw per month ($504.90 on $15,300).
UPDATE public.dkt_credit_lines SET term_months = 6, monthly_fee_pct = 0.55 WHERE name ILIKE 'Amex%';
