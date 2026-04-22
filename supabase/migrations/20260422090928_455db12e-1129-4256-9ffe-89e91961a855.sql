-- products: add packaging_type
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS packaging_type text NOT NULL DEFAULT 'ic_mc';

-- backfill packaging_type from existing cbm_estimates.include_mc
UPDATE public.products p
SET packaging_type = CASE
  WHEN ce.include_mc = false THEN 'ic_only'
  ELSE 'ic_mc'
END
FROM public.cbm_estimates ce
WHERE ce.product_id = p.id;

-- cbm_estimates: add mc_height_buffer_inch
ALTER TABLE public.cbm_estimates
  ADD COLUMN IF NOT EXISTS mc_height_buffer_inch numeric DEFAULT 2.5;

-- global_settings: add wrapping fields
ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS mc_height_buffer_inch numeric NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS corrugate_kg_per_sq_in numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS bubble_kg_per_sq_in numeric NOT NULL DEFAULT 0.20,
  ADD COLUMN IF NOT EXISTS corrugate_price_per_kg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bubble_price_per_kg numeric NOT NULL DEFAULT 0;