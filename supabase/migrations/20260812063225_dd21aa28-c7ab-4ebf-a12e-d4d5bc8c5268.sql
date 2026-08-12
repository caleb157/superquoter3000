ALTER TABLE public.products ADD COLUMN IF NOT EXISTS outsourced_unit_cost_inr numeric NULL;

INSERT INTO public.product_types (name, finishing_color_per_100ri, finishing_lacquer_per_100ri, finishing_mh_per_100ri, finishing_sealer_l_per_100ri, finishing_wax_g_per_sqin, pkg_ic_add_per_side_in, pkg_corrugate_bubble_rate_mh_per_cbm, pkg_ic_rate_mh_per_cbm, pkg_ic_mc_rate_mh_per_cbm, default_percent_wood_for_finishing)
SELECT 'Outsourced', 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM public.product_types WHERE name = 'Outsourced');