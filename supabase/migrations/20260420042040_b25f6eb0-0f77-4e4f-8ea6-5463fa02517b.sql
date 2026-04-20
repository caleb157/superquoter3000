-- 1. CRM lead fields on customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS lead_status text NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS lead_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;

-- Validation trigger (CHECK constraints can't reference enum-like text well; use trigger)
CREATE OR REPLACE FUNCTION public.validate_customer_lead_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.lead_status NOT IN ('lead','active','inactive','churned') THEN
    RAISE EXCEPTION 'Invalid lead_status: %', NEW.lead_status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_customer_lead_status ON public.customers;
CREATE TRIGGER trg_validate_customer_lead_status
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.validate_customer_lead_status();

-- 2. Customer RFQs (Inquiries)
CREATE SEQUENCE IF NOT EXISTS public.customer_rfq_seq;

CREATE OR REPLACE FUNCTION public.generate_crfq_number()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n int;
BEGIN
  n := nextval('public.customer_rfq_seq');
  RETURN 'CRFQ-' || to_char(now(),'YYYY') || '-' || lpad(n::text, 3, '0');
END $$;

CREATE TABLE IF NOT EXISTS public.customer_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  rfq_number text UNIQUE NOT NULL DEFAULT public.generate_crfq_number(),
  title text,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  requirements text,
  target_completion_date date DEFAULT (CURRENT_DATE + INTERVAL '7 days'),
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  assigned_to text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_rfqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage customer rfqs"
  ON public.customer_rfqs FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE TRIGGER trg_customer_rfqs_updated_at
  BEFORE UPDATE ON public.customer_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Link projects to inquiries
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS customer_rfq_id uuid REFERENCES public.customer_rfqs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_customer_rfq_id ON public.projects(customer_rfq_id);

-- 4. RFS (Request for Sample)
CREATE SEQUENCE IF NOT EXISTS public.rfs_seq;

CREATE OR REPLACE FUNCTION public.generate_rfs_number()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n int;
BEGIN
  n := nextval('public.rfs_seq');
  RETURN 'RFS-' || to_char(now(),'YYYY') || '-' || lpad(n::text, 3, '0');
END $$;

CREATE TABLE IF NOT EXISTS public.rfs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_rfq_id uuid REFERENCES public.customer_rfqs(id) ON DELETE CASCADE,
  rfs_number text UNIQUE NOT NULL DEFAULT public.generate_rfs_number(),
  title text,
  requested_date date NOT NULL DEFAULT CURRENT_DATE,
  required_by_date date,
  status text NOT NULL DEFAULT 'pending',
  requirements text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rfs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage rfs"
  ON public.rfs FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE TRIGGER trg_rfs_updated_at
  BEFORE UPDATE ON public.rfs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Samples
CREATE TABLE IF NOT EXISTS public.samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfs_id uuid REFERENCES public.rfs(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  vendor_name text,
  status text NOT NULL DEFAULT 'requested',
  requested_date date,
  initial_ready_date date,
  final_ready_date date,
  dimensions_inch text,
  weight_kg numeric,
  finish text,
  photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  feedback text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage samples"
  ON public.samples FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE TRIGGER trg_samples_updated_at
  BEFORE UPDATE ON public.samples
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_samples_rfs_id ON public.samples(rfs_id);
CREATE INDEX IF NOT EXISTS idx_rfs_customer_rfq_id ON public.rfs(customer_rfq_id);
CREATE INDEX IF NOT EXISTS idx_customer_rfqs_customer_id ON public.customer_rfqs(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_rfqs_status ON public.customer_rfqs(status);
CREATE INDEX IF NOT EXISTS idx_customers_lead_status ON public.customers(lead_status);