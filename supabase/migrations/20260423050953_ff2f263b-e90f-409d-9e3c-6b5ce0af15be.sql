
-- Remove duplicate seeded rows for products that have exactly 2x the expected rows.
-- Keep the earliest row for each (product_id, cogs_type, component_name) combo in cogs_items,
-- (product_id, labor_type) in overhead_items, and earliest non_unit_cogs entry per product.

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY product_id, cogs_type, component_name, sort_order ORDER BY created_at, id) AS rn
  FROM cogs_items
)
DELETE FROM cogs_items WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY product_id, labor_type, sort_order ORDER BY created_at, id) AS rn
  FROM overhead_items
)
DELETE FROM overhead_items WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY product_id, name, sort_order ORDER BY created_at, id) AS rn
  FROM non_unit_cogs
)
DELETE FROM non_unit_cogs WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
