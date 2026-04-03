
-- Create company_entities table
CREATE TABLE public.company_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text,
  entity_type text, -- 'US' or 'India'
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  country text,
  postal_code text,
  phone text,
  email text,
  website text,
  gst_number text,
  ein_number text,
  bank_name text,
  bank_branch text,
  account_name text,
  account_number text,
  routing_number text,
  ifsc_code text,
  swift_code text,
  logo_url text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.company_entities ENABLE ROW LEVEL SECURITY;

-- Admin can do everything
CREATE POLICY "Admin can manage entities"
  ON public.company_entities FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admin/team can view
CREATE POLICY "Admin/team can view entities"
  ON public.company_entities FOR SELECT
  TO authenticated
  USING (is_admin_or_team(auth.uid()));

-- Guests can view (needed for quote PDF/portal)
CREATE POLICY "Guests can view entities"
  ON public.company_entities FOR SELECT
  TO authenticated
  USING (true);

-- Seed two entities
INSERT INTO public.company_entities (name, legal_name, entity_type, country)
VALUES
  ('DKT', 'Desert Kingdom Traders LLC', 'US', 'United States'),
  ('Parable Ventures', 'Parable Ventures Private Limited', 'India', 'India');

-- Add quoting_entity_id to project_settings
ALTER TABLE public.project_settings
  ADD COLUMN quoting_entity_id uuid REFERENCES public.company_entities(id);

-- Create quote_snapshots table
CREATE TABLE public.quote_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  quote_number text,
  entity_id uuid REFERENCES public.company_entities(id),
  currency text DEFAULT 'USD',
  products jsonb,
  totals jsonb,
  customer_selections jsonb,
  status text DEFAULT 'sent',
  sent_at timestamptz,
  viewed_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  valid_until date,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.quote_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage quote snapshots"
  ON public.quote_snapshots FOR ALL
  TO authenticated
  USING (is_admin_or_team(auth.uid()));

CREATE POLICY "Guests can view quote snapshots for their projects"
  ON public.quote_snapshots FOR SELECT
  TO authenticated
  USING (is_guest_for_project(auth.uid(), project_id));

-- Create storage bucket for entity logos
INSERT INTO storage.buckets (id, name, public) VALUES ('entity-logos', 'entity-logos', true);

CREATE POLICY "Anyone can view entity logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'entity-logos');

CREATE POLICY "Admin can upload entity logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'entity-logos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin can update entity logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'entity-logos' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin can delete entity logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'entity-logos' AND has_role(auth.uid(), 'admin'::app_role));

-- Customer logos bucket (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('customer-logos', 'customer-logos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can view customer logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'customer-logos');

CREATE POLICY "Admin/team can upload customer logos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'customer-logos' AND is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can update customer logos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'customer-logos' AND is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can delete customer logos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'customer-logos' AND is_admin_or_team(auth.uid()));
