
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS indirect_overhead_per_mh numeric NOT NULL DEFAULT 0;
UPDATE public.global_settings
  SET indirect_overhead_per_mh = CASE WHEN COALESCE(total_available_mh_per_month,0) > 0
       THEN ROUND((indirect_overhead_monthly::numeric / total_available_mh_per_month)::numeric, 4)
       ELSE indirect_overhead_per_mh END
  WHERE indirect_overhead_per_mh = 0;
ALTER TABLE public.global_settings DROP COLUMN indirect_overhead_monthly;
ALTER TABLE public.global_settings DROP COLUMN total_available_mh_per_month;

ALTER TABLE public.customer_rfqs ADD COLUMN IF NOT EXISTS indirect_overhead_per_mh_override numeric;
UPDATE public.customer_rfqs c
  SET indirect_overhead_per_mh_override = CASE
    WHEN c.indirect_overhead_monthly_override IS NOT NULL
     AND COALESCE(c.total_available_mh_per_month_override, (SELECT 0)) > 0
       THEN ROUND((c.indirect_overhead_monthly_override::numeric / c.total_available_mh_per_month_override)::numeric, 4)
    ELSE NULL END
  WHERE indirect_overhead_per_mh_override IS NULL;
ALTER TABLE public.customer_rfqs DROP COLUMN indirect_overhead_monthly_override;
ALTER TABLE public.customer_rfqs DROP COLUMN total_available_mh_per_month_override;
