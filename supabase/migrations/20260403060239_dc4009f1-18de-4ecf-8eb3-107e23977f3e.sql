
-- 1. Create customers table
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  company text,
  logo_url text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can modify customers"
  ON public.customers FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin/team can view customers"
  ON public.customers FOR SELECT
  TO authenticated
  USING (is_admin_or_team(auth.uid()));

-- 2. Add customer_id to projects
ALTER TABLE public.projects ADD COLUMN customer_id uuid REFERENCES public.customers(id);

-- 3. Add sourced_externally to products
ALTER TABLE public.products ADD COLUMN sourced_externally boolean DEFAULT false;

-- 4. Add local_transport_cost_per_cbm to global_settings
ALTER TABLE public.global_settings ADD COLUMN local_transport_cost_per_cbm numeric DEFAULT 3500;
