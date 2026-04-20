-- Drop obsolete guest RLS policies that depend on project_id (guest system being removed)
DROP POLICY IF EXISTS "Guests can view invited project products" ON public.products;
DROP POLICY IF EXISTS "Guests can view variants" ON public.product_variants;
DROP POLICY IF EXISTS "Guests can view cbm" ON public.cbm_estimates;
DROP POLICY IF EXISTS "Guests can view assemblies for invited projects" ON public.product_assemblies;
DROP POLICY IF EXISTS "Guests can view assembly components" ON public.assembly_components;
DROP POLICY IF EXISTS "Guests can view project settings" ON public.project_settings;
DROP POLICY IF EXISTS "Guests can view invited projects" ON public.projects;
DROP POLICY IF EXISTS "Guests can view quote snapshots for their projects" ON public.quote_snapshots;
DROP POLICY IF EXISTS "Guests can view own invitations" ON public.project_invitations;

-- 5a. Add customer_rfq_id to tables that still reference projects
ALTER TABLE public.product_assemblies
  ADD COLUMN IF NOT EXISTS customer_rfq_id uuid REFERENCES public.customer_rfqs(id) ON DELETE CASCADE;

ALTER TABLE public.vendor_rfqs
  ADD COLUMN IF NOT EXISTS customer_rfq_id uuid REFERENCES public.customer_rfqs(id) ON DELETE SET NULL;

-- 5b. Backfill from projects linkage
UPDATE public.product_assemblies pa
SET customer_rfq_id = pr.customer_rfq_id
FROM public.projects pr
WHERE pa.project_id = pr.id
  AND pa.customer_rfq_id IS NULL
  AND pr.customer_rfq_id IS NOT NULL;

UPDATE public.vendor_rfqs v
SET customer_rfq_id = pr.customer_rfq_id
FROM public.projects pr
WHERE v.project_id = pr.id
  AND v.customer_rfq_id IS NULL
  AND pr.customer_rfq_id IS NOT NULL;

-- 5c. Indexes
CREATE INDEX IF NOT EXISTS idx_product_assemblies_customer_rfq_id
  ON public.product_assemblies(customer_rfq_id);
CREATE INDEX IF NOT EXISTS idx_vendor_rfqs_customer_rfq_id
  ON public.vendor_rfqs(customer_rfq_id);

-- 5d. Drop project_id columns
ALTER TABLE public.products DROP COLUMN IF EXISTS project_id;
ALTER TABLE public.quote_snapshots DROP COLUMN IF EXISTS project_id;
ALTER TABLE public.product_assemblies DROP COLUMN IF EXISTS project_id;
ALTER TABLE public.vendor_rfqs DROP COLUMN IF EXISTS project_id;

-- 5e. Drop project-only auxiliary tables
DROP TABLE IF EXISTS public.project_invitations CASCADE;
DROP TABLE IF EXISTS public.project_settings CASCADE;

-- 5f. Drop projects
DROP TABLE IF EXISTS public.projects CASCADE;

-- Drop the now-orphaned guest helper function
DROP FUNCTION IF EXISTS public.is_guest_for_project(uuid, uuid) CASCADE;

-- 5g. Normalize statuses + strict trigger
UPDATE public.customer_rfqs
SET status = CASE
  WHEN status IN ('active','paused','cancelled','po') THEN status
  WHEN status IN ('closed','archived') THEN 'cancelled'
  WHEN status = 'po_confirmed' THEN 'po'
  ELSE 'active'
END;

CREATE OR REPLACE FUNCTION public.validate_customer_rfq_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('active','paused','cancelled','po') THEN
    RAISE EXCEPTION 'Invalid inquiry status: %', NEW.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_customer_rfq_status ON public.customer_rfqs;
CREATE TRIGGER trg_validate_customer_rfq_status
  BEFORE INSERT OR UPDATE ON public.customer_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.validate_customer_rfq_status();