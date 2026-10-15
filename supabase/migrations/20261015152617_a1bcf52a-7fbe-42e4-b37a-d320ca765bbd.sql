CREATE TABLE public.odoo_standard_bom_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  odoo_product_id integer,
  sku text NOT NULL,
  name text NOT NULL,
  uom text NOT NULL DEFAULT 'Units',
  default_qty numeric NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.odoo_standard_bom_components TO authenticated;
GRANT ALL ON public.odoo_standard_bom_components TO service_role;
ALTER TABLE public.odoo_standard_bom_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team reads standard BOM components" ON public.odoo_standard_bom_components
  FOR SELECT TO authenticated USING (public.is_admin_or_team(auth.uid()));
CREATE POLICY "Team manages standard BOM components" ON public.odoo_standard_bom_components
  FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));