ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS odoo_product_id integer,
  ADD COLUMN IF NOT EXISTS odoo_template_id integer,
  ADD COLUMN IF NOT EXISTS odoo_sku text,
  ADD COLUMN IF NOT EXISTS odoo_variant text,
  ADD COLUMN IF NOT EXISTS odoo_pushed_at timestamptz;