
-- 1. chemical_prices: unit-aware columns
ALTER TABLE public.chemical_prices
  ADD COLUMN IF NOT EXISTS unit_type text NOT NULL DEFAULT 'L',
  ADD COLUMN IF NOT EXISTS price_per_unit_inr numeric;

UPDATE public.chemical_prices
SET price_per_unit_inr = price_per_litre_inr,
    unit_type = 'L'
WHERE price_per_unit_inr IS NULL;

ALTER TABLE public.chemical_prices
  ALTER COLUMN price_per_litre_inr DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chemical_prices_unit_type_check'
  ) THEN
    ALTER TABLE public.chemical_prices
      ADD CONSTRAINT chemical_prices_unit_type_check
      CHECK (unit_type IN ('L', 'mL', 'g', 'kg', 'pc'));
  END IF;
END $$;

-- 2. Seed wax in chemical_prices
INSERT INTO public.chemical_prices (category, name, unit_type, price_per_unit_inr, price_per_litre_inr)
SELECT 'Wax', 'Wax', 'g', 1.25, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.chemical_prices WHERE category = 'Wax' AND name = 'Wax'
);

-- Seed wax in raw_material_costs
INSERT INTO public.raw_material_costs (category, name, cost, unit_type, currency, active, notes)
SELECT 'Finishing Chemicals', 'Wax', 1.25, 'g', 'INR', true, 'Surface wax for finishing — measured in grams per square inch of exposed surface.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.raw_material_costs WHERE category = 'Finishing Chemicals' AND name = 'Wax'
);

-- 3. product_types: wax rate column
ALTER TABLE public.product_types
  ADD COLUMN IF NOT EXISTS finishing_wax_g_per_sqin numeric DEFAULT 0.1;

-- 5. finishing_difficulty: add Extremely Easy
INSERT INTO public.finishing_difficulty (name, adjustment_factor, sort_order)
VALUES ('Extremely Easy', 0.5, 0)
ON CONFLICT (name) DO UPDATE SET adjustment_factor = 0.5, sort_order = 0;

-- 6. cogs_items: FK to chemical_prices
ALTER TABLE public.cogs_items
  ADD COLUMN IF NOT EXISTS chemical_price_id uuid REFERENCES public.chemical_prices(id) ON DELETE SET NULL;

-- Backfill from name patterns
UPDATE public.cogs_items ci
SET chemical_price_id = cp.id
FROM public.chemical_prices cp
WHERE ci.cogs_type = 'Finishing Materials'
  AND ci.chemical_price_id IS NULL
  AND (
    (lower(ci.component_name) LIKE '%color%' AND cp.category = 'Color')
    OR (lower(ci.component_name) LIKE '%sealer%' AND cp.category = 'Sealer')
    OR (lower(ci.component_name) LIKE '%lacquer%' AND cp.category = 'Lacquer')
  );
