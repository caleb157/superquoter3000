-- Section 7: Per-product-type default chemicals
CREATE TABLE IF NOT EXISTS public.product_type_default_chemicals (
  product_type_id uuid NOT NULL REFERENCES public.product_types(id) ON DELETE CASCADE,
  chemical_price_id uuid NOT NULL REFERENCES public.chemical_prices(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (product_type_id, chemical_price_id)
);

ALTER TABLE public.product_type_default_chemicals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage product type default chemicals"
  ON public.product_type_default_chemicals FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

-- Backfill: seed Color + Sealer + (NC Lacquer preferred) for wood-finishing product types.
INSERT INTO public.product_type_default_chemicals (product_type_id, chemical_price_id)
SELECT pt.id, cp.id
FROM public.product_types pt
CROSS JOIN public.chemical_prices cp
WHERE COALESCE(pt.default_percent_wood_for_finishing, 1) > 0
  AND cp.category IN ('Color', 'Sealer', 'Lacquer')
  AND (
    cp.category <> 'Lacquer'
    OR cp.name ILIKE '%NC%'
    OR NOT EXISTS (
      SELECT 1 FROM public.chemical_prices cp2
      WHERE cp2.category = 'Lacquer' AND cp2.name ILIKE '%NC%'
    )
  )
ON CONFLICT DO NOTHING;