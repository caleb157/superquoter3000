-- Remove duplicate Domestic Freight rows, keeping only the first one per product
DELETE FROM cogs_items
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY product_id, component_name, is_auto_calculated ORDER BY created_at) as rn
    FROM cogs_items
    WHERE component_name = 'Domestic Freight (External Sourcing)' AND is_auto_calculated = true
  ) sub WHERE rn > 1
);