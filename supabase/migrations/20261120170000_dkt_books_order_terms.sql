-- DKT Cash Flow: per-order choices for orders read from DKT's own Odoo (odoo-dkt-books).
-- Keyed by DKT's sales order / invoice / bill number (e.g. 'S00062', 'INV/2026/00017'). DKT's Odoo numbers
-- can repeat PV's ('S00062' exists in both), so this is kept apart from dkt_odoo_order_terms.
-- Safe to run more than once.
CREATE TABLE IF NOT EXISTS public.dkt_books_order_terms (
  so_name text PRIMARY KEY,
  excluded boolean NOT NULL DEFAULT false,
  ship_month date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dkt_books_order_terms TO authenticated;
GRANT ALL ON public.dkt_books_order_terms TO service_role;
ALTER TABLE public.dkt_books_order_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team manage dkt_books_order_terms" ON public.dkt_books_order_terms;
CREATE POLICY "Admin/team manage dkt_books_order_terms" ON public.dkt_books_order_terms
  FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
