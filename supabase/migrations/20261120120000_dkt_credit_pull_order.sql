-- DKT Cash Flow → Credit lines: pull order for "Pull as needed" on the forecast.
-- 1 is pulled first, then 2, and so on; blank = never pulled automatically. Safe to run more than once.
ALTER TABLE public.dkt_credit_lines ADD COLUMN IF NOT EXISTS draw_priority integer;

-- Start from the order Caleb gave (2026-11-19): Sooie first, Amex second, HQ First Financial third.
-- Only fills lines that have no pull order yet; change it any time on the Credit lines tab.
UPDATE public.dkt_credit_lines SET draw_priority = 1 WHERE draw_priority IS NULL AND name ILIKE 'sooie%';
UPDATE public.dkt_credit_lines SET draw_priority = 2 WHERE draw_priority IS NULL AND name ILIKE 'amex%';
UPDATE public.dkt_credit_lines SET draw_priority = 3 WHERE draw_priority IS NULL AND name ILIKE 'hq first%';
