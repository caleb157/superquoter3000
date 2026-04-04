DELETE FROM cogs_items WHERE component_name = 'Domestic Freight (External Sourcing)' AND is_auto_calculated = true AND id IN (
  SELECT id FROM cogs_items WHERE component_name = 'Domestic Freight (External Sourcing)' AND is_auto_calculated = true ORDER BY created_at DESC OFFSET 1
);