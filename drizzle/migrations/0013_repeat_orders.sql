-- Repeat orders: an inquiry created with "Repeat of…" links to the inquiry it repeats
-- (inquiry_projections.repeat_order stays the flag projections read), and repeats start
-- at their own default certainty instead of the general one.
ALTER TABLE public.customer_rfqs ADD COLUMN IF NOT EXISTS repeat_of_inquiry_id uuid REFERENCES public.customer_rfqs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS customer_rfqs_repeat_of_idx ON public.customer_rfqs(repeat_of_inquiry_id);
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS default_repeat_certainty_pct numeric NOT NULL DEFAULT 0.8;