-- DKT Cash Flow → Credit lines: how Pull as needed draws on each line.
--   pull_step_usd     pulls and pay-backs in whole multiples of this (blank = $500)
--   pull_cover_months one pull covers this month and the next ones (blank = 1, this month only)
-- Safe to run more than once.
ALTER TABLE public.dkt_credit_lines
  ADD COLUMN IF NOT EXISTS pull_step_usd numeric,
  ADD COLUMN IF NOT EXISTS pull_cover_months integer;

-- Sooie asked for fewer transactions (2026-11-20): $5,000 blocks, each covering three months.
UPDATE public.dkt_credit_lines SET pull_step_usd = 5000, pull_cover_months = 3
  WHERE name ILIKE 'sooie%' AND pull_step_usd IS NULL AND pull_cover_months IS NULL;
