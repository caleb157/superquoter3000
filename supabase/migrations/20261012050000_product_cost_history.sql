-- Cost history: one row per product each time its costing changes (written by the app on save
-- and on recost, only when something moved). Feeds the product Cost history tab and the
-- "cost up since last quote" warning. Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.product_cost_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  unit_cost_usd numeric,
  unit_price_usd numeric,
  unit_cost_inr numeric,
  exchange_rate numeric,
  markup_percent numeric,
  man_hours numeric,
  parts jsonb NOT NULL DEFAULT '{}'::jsonb,  -- INR per unit: raw_piece, hardware, materials, labor, overhead, shipping, capital
  raw_vendor text,                           -- vendor of the chosen raw-piece quote
  reason text,                               -- what changed, e.g. "Raw piece +₹180 (Rao)"
  created_by uuid DEFAULT auth.uid()
);
CREATE INDEX IF NOT EXISTS product_cost_history_product_idx
  ON public.product_cost_history(product_id, recorded_at DESC);

ALTER TABLE public.product_cost_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team can manage cost history" ON public.product_cost_history;
CREATE POLICY "Admin/team can manage cost history"
  ON public.product_cost_history FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_cost_history TO authenticated;
GRANT ALL ON public.product_cost_history TO service_role;
