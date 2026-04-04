CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  address text,
  category text DEFAULT 'general',
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage vendors"
  ON public.vendors FOR ALL TO authenticated
  USING (is_admin_or_team(auth.uid()));
