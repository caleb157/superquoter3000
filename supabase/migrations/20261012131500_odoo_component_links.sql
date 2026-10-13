-- Send to Odoo (product "Odoo" tab).
-- odoo_component_links: which Odoo product an HQ costing item is (by cost category + name),
-- picked once and pre-matched on every later product. Only the link and its label are kept;
-- Odoo's product list is always read live.
-- odoo_push_log: what each "Send to Odoo" created or reused, or why it stopped.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS public.odoo_component_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_key text NOT NULL UNIQUE,
  cogs_type text,
  component_name text,
  odoo_product_id integer,
  odoo_sku text,
  odoo_name text,
  odoo_display_name text,
  odoo_uom text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.odoo_component_links TO authenticated;
GRANT ALL ON public.odoo_component_links TO service_role;
ALTER TABLE public.odoo_component_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/team manage odoo component links" ON public.odoo_component_links;
CREATE POLICY "Admin/team manage odoo component links" ON public.odoo_component_links FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));

DROP TRIGGER IF EXISTS trg_odoo_component_links_updated_at ON public.odoo_component_links;
CREATE TRIGGER trg_odoo_component_links_updated_at BEFORE UPDATE ON public.odoo_component_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.odoo_push_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ok boolean NOT NULL,
  request jsonb,
  result jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.odoo_push_log TO authenticated;
GRANT ALL ON public.odoo_push_log TO service_role;
ALTER TABLE public.odoo_push_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/team read odoo push log" ON public.odoo_push_log;
CREATE POLICY "Admin/team read odoo push log" ON public.odoo_push_log FOR SELECT TO authenticated
  USING (public.is_admin_or_team(auth.uid()));
DROP POLICY IF EXISTS "Admins write odoo push log" ON public.odoo_push_log;
CREATE POLICY "Admins write odoo push log" ON public.odoo_push_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_odoo_push_log_product ON public.odoo_push_log (product_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
