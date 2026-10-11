CREATE TABLE IF NOT EXISTS public.iron_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL,
  label text NOT NULL DEFAULT '',
  price_per_kg numeric,
  data jsonb NOT NULL,
  total_kg numeric,
  total_cost numeric,
  notes text,
  owner_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT iron_builds_sku_label_key UNIQUE (sku, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.iron_builds TO authenticated;
GRANT ALL ON public.iron_builds TO service_role;
ALTER TABLE public.iron_builds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team manage iron_builds" ON public.iron_builds;
CREATE POLICY "Admin/team manage iron_builds" ON public.iron_builds FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
DROP TRIGGER IF EXISTS trg_iron_builds_updated_at ON public.iron_builds;
CREATE TRIGGER trg_iron_builds_updated_at BEFORE UPDATE ON public.iron_builds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();