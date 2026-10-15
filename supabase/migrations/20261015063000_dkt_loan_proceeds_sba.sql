-- DKT Cash Flow: loans not received yet. A loan can carry the money it will bring in (net of fees)
-- and the month it arrives, so a loan offer can be tried in the forecast with its payments.
ALTER TABLE public.dkt_loans ADD COLUMN IF NOT EXISTS proceeds_usd numeric;
ALTER TABLE public.dkt_loans ADD COLUMN IF NOT EXISTS proceeds_month date;

-- SBA 7(a) prequalification (Newity + Peak Bank, 2026-10-15): $87,500 at 9.75% over 10 years,
-- about $1,145 a month. Closing costs $4,375 and the SBA guaranty fee $1,488 come out of the money
-- received ($81,637), expected in Nov 2026 with the first payment in Dec 2026. Added switched off,
-- since it's only an offer: switch "In forecast" on to see it.
DO $$
DECLARE
  l uuid;
  p numeric := 87500;
  r numeric := 0.0975 / 12;
  n int := 120;
  pmt numeric;
BEGIN
  IF EXISTS (SELECT 1 FROM public.dkt_loans WHERE name = 'SBA 7(a) loan (Newity offer)') THEN RETURN; END IF;
  pmt := round(p * r / (1 - power(1 + r, -n)), 2);
  INSERT INTO public.dkt_loans (name, kind, balance_usd, rate_pct, active, proceeds_usd, proceeds_month, notes)
  VALUES ('SBA 7(a) loan (Newity offer)', 'schedule', p, 9.75, false, 81637, '2026-11-01',
    'Prequalified offer from Newity / Peak Bank: $87,500, 9.75%, 10 years, about $1,145/month. Received is net of $4,375 closing costs and the $1,488 SBA guaranty fee. Dates are estimates: update them once it closes.')
  RETURNING id INTO l;
  -- Standard amortisation: interest on the balance each month, the rest of the payment is principal;
  -- the last payment clears what's left.
  INSERT INTO public.dkt_loan_payments (loan_id, due_date, principal_usd, interest_usd)
  WITH RECURSIVE s(k, bal) AS (
    SELECT 0, p
    UNION ALL
    SELECT k + 1, CASE WHEN k + 1 = n THEN 0 ELSE bal - (pmt - round(bal * r, 2)) END FROM s WHERE k < n
  )
  SELECT l, (date '2026-12-15' + make_interval(months => s.k))::date,
         CASE WHEN s.k + 1 = n THEN s.bal ELSE pmt - round(s.bal * r, 2) END,
         round(s.bal * r, 2)
  FROM s WHERE s.k < n;
END $$;
