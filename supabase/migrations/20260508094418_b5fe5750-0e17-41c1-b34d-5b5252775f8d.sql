-- Below-MOQ surcharge percentage (e.g., 0.15 = +15% on unit price when customer orders below MOQ)
ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS below_moq_surcharge_percent numeric NOT NULL DEFAULT 0.15;

-- Hard MOQ floor: customer cannot order below this. NULL means use moq as the hard floor.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS hard_moq integer;

ALTER TABLE public.product_assemblies
  ADD COLUMN IF NOT EXISTS hard_moq integer;