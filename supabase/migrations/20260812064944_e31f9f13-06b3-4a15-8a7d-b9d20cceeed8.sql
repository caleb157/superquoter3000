CREATE TABLE public.pd_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  is_checked boolean NOT NULL DEFAULT false,
  checked_at timestamptz,
  checked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, item_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pd_checklist_items TO authenticated;
GRANT ALL ON public.pd_checklist_items TO service_role;

ALTER TABLE public.pd_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can do all on pd checklist"
ON public.pd_checklist_items
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()))
WITH CHECK (is_admin_or_team(auth.uid()));

CREATE INDEX idx_pd_checklist_product ON public.pd_checklist_items(product_id);

CREATE TRIGGER trg_pd_checklist_updated_at
BEFORE UPDATE ON public.pd_checklist_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();