-- Phase 4: schema cleanup + consolidated MH override

-- 1. Add consolidated MH override on inquiries
ALTER TABLE public.customer_rfqs
  ADD COLUMN IF NOT EXISTS total_available_mh_per_month_override numeric;

-- Backfill from old pair when both non-null
UPDATE public.customer_rfqs
SET total_available_mh_per_month_override = num_laborers_override * available_hours_per_month_override
WHERE total_available_mh_per_month_override IS NULL
  AND num_laborers_override IS NOT NULL
  AND available_hours_per_month_override IS NOT NULL;

-- 2. Drop legacy columns
ALTER TABLE public.products DROP COLUMN IF EXISTS sourced_externally;

ALTER TABLE public.global_settings
  DROP COLUMN IF EXISTS num_laborers,
  DROP COLUMN IF EXISTS available_hours_per_month,
  DROP COLUMN IF EXISTS contractor_to_inhouse_decrease;

ALTER TABLE public.customer_rfqs
  DROP COLUMN IF EXISTS num_laborers_override,
  DROP COLUMN IF EXISTS available_hours_per_month_override,
  DROP COLUMN IF EXISTS contractor_to_inhouse_decrease_override;

ALTER TABLE public.product_types
  DROP COLUMN IF EXISTS contractor_base_rate_per_ri,
  DROP COLUMN IF EXISTS finishing_sealer_per_100ri,
  DROP COLUMN IF EXISTS packaging_mh_per_cbm,
  DROP COLUMN IF EXISTS ic_addition_per_side_inch;

-- 3. Update the seed_product_defaults trigger (it references mc_height_buffer only — safe)
-- but the products INSERT trigger context may now include sourced_externally references in old triggers.
-- Recreate the trigger function body unchanged since it does not touch dropped columns.
