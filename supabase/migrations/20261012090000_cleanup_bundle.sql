-- Cleanup bundle (Wrapping, Wood prices, product variants, RFQ log, unused columns) and
-- product-id indexes. Safe to run more than once. Run after the app update is live.

-- 0. Stop if a database function still uses anything dropped below (nothing in the app does).
DO $$
DECLARE hits text;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ') INTO hits
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosrc ~* '(corrugate_kg_per_sq_in|bubble_kg_per_sq_in|corrugate_price_per_kg|bubble_price_per_kg|use_live_rates|opening_cash_inr|slow_quote_days|slow_sample_days|finishing_mh_per_100ri|default_percent_wood_for_finishing|pkg_ic_rate_mh_per_cbm|pkg_ic_mc_rate_mh_per_cbm|pkg_corrugate_bubble_rate_mh_per_cbm|adjustment_factor|ic_volume_cbm|total_weight_kg|fob_mode_override|kanban_substage_override|initial_ready_date|final_ready_date|legacy_rfs_id|product_variants|wood_prices|inquiry_received_rfqs)';
  IF hits IS NOT NULL THEN
    RAISE EXCEPTION 'Nothing was changed: these database functions still use columns or tables this cleanup drops: %', hits;
  END IF;
END $$;

-- 1. Products on the retired wrap packaging move to IC + MC, as if picked in the costing workspace.
UPDATE public.cogs_items c SET include = 'Yes'
FROM public.products p
WHERE c.product_id = p.id AND p.packaging_type = 'corrugate_bubble'
  AND c.is_auto_calculated AND c.cogs_type = 'Packaging'
  AND (lower(c.component_name) LIKE '%ic box%' OR lower(c.component_name) LIKE '%inner carton%'
    OR lower(c.component_name) LIKE '%mc box%' OR lower(c.component_name) LIKE '%master carton%'
    OR lower(c.component_name) LIKE '%outer carton%');
UPDATE public.cbm_estimates e SET include_mc = true
FROM public.products p
WHERE e.product_id = p.id AND p.packaging_type = 'corrugate_bubble';
UPDATE public.products SET packaging_type = 'ic_mc' WHERE packaging_type = 'corrugate_bubble';
DELETE FROM public.cogs_items WHERE is_auto_calculated AND lower(component_name) IN ('corrugate wrap', 'bubble wrap');

-- 2. Settings and columns nothing reads any more.
ALTER TABLE public.global_settings
  DROP COLUMN IF EXISTS use_live_rates,
  DROP COLUMN IF EXISTS opening_cash_inr,
  DROP COLUMN IF EXISTS slow_quote_days,
  DROP COLUMN IF EXISTS slow_sample_days,
  DROP COLUMN IF EXISTS corrugate_kg_per_sq_in,
  DROP COLUMN IF EXISTS bubble_kg_per_sq_in,
  DROP COLUMN IF EXISTS corrugate_price_per_kg,
  DROP COLUMN IF EXISTS bubble_price_per_kg;
ALTER TABLE public.product_types
  DROP COLUMN IF EXISTS finishing_mh_per_100ri,
  DROP COLUMN IF EXISTS default_percent_wood_for_finishing,
  DROP COLUMN IF EXISTS pkg_ic_rate_mh_per_cbm,
  DROP COLUMN IF EXISTS pkg_ic_mc_rate_mh_per_cbm,
  DROP COLUMN IF EXISTS pkg_corrugate_bubble_rate_mh_per_cbm;
ALTER TABLE public.finishing_difficulty DROP COLUMN IF EXISTS adjustment_factor;
ALTER TABLE public.cbm_estimates DROP COLUMN IF EXISTS ic_volume_cbm, DROP COLUMN IF EXISTS total_weight_kg;
ALTER TABLE public.customer_rfqs DROP COLUMN IF EXISTS fob_mode_override, DROP COLUMN IF EXISTS kanban_substage_override;
ALTER TABLE public.samples DROP COLUMN IF EXISTS initial_ready_date, DROP COLUMN IF EXISTS final_ready_date, DROP COLUMN IF EXISTS rfs_id;
ALTER TABLE public.sample_requests DROP COLUMN IF EXISTS legacy_rfs_id;

-- 3. Tables nothing reads any more.
DROP TABLE IF EXISTS public.product_variants;
DROP TABLE IF EXISTS public.wood_prices;
DROP TABLE IF EXISTS public.inquiry_received_rfqs;

-- 4. Every costing load filters these by product.
CREATE INDEX IF NOT EXISTS idx_cogs_items_product_id ON public.cogs_items(product_id);
CREATE INDEX IF NOT EXISTS idx_overhead_items_product_id ON public.overhead_items(product_id);
CREATE INDEX IF NOT EXISTS idx_non_unit_cogs_product_id ON public.non_unit_cogs(product_id);
CREATE INDEX IF NOT EXISTS idx_shipping_items_product_id ON public.shipping_items(product_id);
CREATE INDEX IF NOT EXISTS idx_cbm_estimates_product_id ON public.cbm_estimates(product_id);
