-- Repeat product cost check (product page → Repeat product).
-- products.repeat_odoo: the past Odoo product (and sales order line / manufacturing order)
--   this product is checked against: {odoo_product_id, sale_line_id, mo_id, label}. Nothing else from Odoo is stored.
-- global_settings.odoo_operation_labor_map: which PDHQ labour type each Odoo operation's hours count as,
--   e.g. {"Sanding": "Finishing", "Rework": "skip"}. Operations not listed use the app's defaults.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS repeat_odoo jsonb;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS odoo_operation_labor_map jsonb;
