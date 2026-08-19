CREATE TABLE public.container_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  internal_width_in numeric NOT NULL DEFAULT 0,
  internal_depth_in numeric NOT NULL DEFAULT 0,
  internal_height_in numeric NOT NULL DEFAULT 0,
  max_weight_kg numeric NOT NULL DEFAULT 0,
  usable_volume_factor numeric NOT NULL DEFAULT 0.85,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.container_types TO authenticated;
GRANT ALL ON public.container_types TO service_role;

ALTER TABLE public.container_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team can view container types" ON public.container_types
FOR SELECT TO authenticated USING (public.is_admin_or_team(auth.uid()));

CREATE POLICY "Team can manage container types" ON public.container_types
FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE TRIGGER update_container_types_updated_at
BEFORE UPDATE ON public.container_types
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed standard dry containers (internal dims converted from cm to inches)
INSERT INTO public.container_types (name, internal_width_in, internal_depth_in, internal_height_in, max_weight_kg, usable_volume_factor, sort_order) VALUES
  ('20ft Standard', 92.52, 231.89, 94.09, 28200, 0.85, 1),
  ('40ft Standard', 92.52, 473.62, 94.09, 26700, 0.85, 2),
  ('40ft HC',       92.52, 473.62, 105.91, 26500, 0.85, 3);