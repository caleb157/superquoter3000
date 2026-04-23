
-- Safety net: clean any lingering dups before adding constraints (keep earliest row).
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY product_id, cogs_type, COALESCE(component_name, '')
    ORDER BY created_at, id
  ) AS rn FROM public.cogs_items WHERE product_id IS NOT NULL
)
DELETE FROM public.cogs_items WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY product_id, labor_type
    ORDER BY created_at, id
  ) AS rn FROM public.overhead_items WHERE product_id IS NOT NULL
)
DELETE FROM public.overhead_items WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY product_id, COALESCE(name, '')
    ORDER BY created_at, id
  ) AS rn FROM public.non_unit_cogs WHERE product_id IS NOT NULL
)
DELETE FROM public.non_unit_cogs WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Unique partial indexes (NULL product_id excluded, since unattached rows shouldn't conflict).
CREATE UNIQUE INDEX IF NOT EXISTS cogs_items_product_type_component_uniq
  ON public.cogs_items (product_id, cogs_type, COALESCE(component_name, ''))
  WHERE product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS overhead_items_product_labor_uniq
  ON public.overhead_items (product_id, labor_type)
  WHERE product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS non_unit_cogs_product_name_uniq
  ON public.non_unit_cogs (product_id, COALESCE(name, ''))
  WHERE product_id IS NOT NULL;
