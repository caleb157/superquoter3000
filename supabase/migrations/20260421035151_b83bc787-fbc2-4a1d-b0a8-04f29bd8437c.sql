ALTER TABLE public.customer_rfqs
  ADD COLUMN IF NOT EXISTS exchange_rate_override numeric,
  ADD COLUMN IF NOT EXISTS markup_percent_override numeric,
  ADD COLUMN IF NOT EXISTS shipping_type_id_override uuid REFERENCES public.shipping_types(id) ON DELETE SET NULL;