-- DKT Cash Flow: balloon credit (Sooie). Interest builds up and is paid with the principal in the
-- "due in full" month instead of every month. Set on the line (seeds new draws) and on each draw.
ALTER TABLE public.dkt_credit_lines ADD COLUMN IF NOT EXISTS balloon boolean NOT NULL DEFAULT false;
ALTER TABLE public.dkt_credit_draws ADD COLUMN IF NOT EXISTS balloon boolean;

-- Sooie: all principal and interest due in one payment. Revolving, so no installment terms.
UPDATE public.dkt_credit_lines SET balloon = true, term_months = NULL, monthly_fee_pct = NULL
WHERE name ILIKE 'sooie%' AND NOT balloon;
UPDATE public.dkt_credit_draws d SET balloon = true, term_months = NULL, monthly_fee_pct = NULL
FROM public.dkt_credit_lines l
WHERE d.line_id = l.id AND l.name ILIKE 'sooie%' AND d.actual AND d.balloon IS NULL;
