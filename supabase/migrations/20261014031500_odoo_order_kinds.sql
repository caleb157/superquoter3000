-- Trading vs manufacturing per Odoo sales order, set by hand on the SO Profitability page and read by
-- the Breakeven Calculator. Keyed by SO number only; the orders themselves are always read live.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS public.odoo_order_kinds (
  so_name text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('trading', 'manufacturing')),
  updated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.odoo_order_kinds TO authenticated;
GRANT ALL ON public.odoo_order_kinds TO service_role;
ALTER TABLE public.odoo_order_kinds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/team manage odoo order kinds" ON public.odoo_order_kinds;
CREATE POLICY "Admin/team manage odoo order kinds" ON public.odoo_order_kinds FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));

DROP TRIGGER IF EXISTS trg_odoo_order_kinds_updated_at ON public.odoo_order_kinds;
CREATE TRIGGER trg_odoo_order_kinds_updated_at BEFORE UPDATE ON public.odoo_order_kinds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
