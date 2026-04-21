-- 1. Restrict sensitive banking/tax fields on company_entities to admins only
-- Drop existing team SELECT policy and replace with one that excludes banking columns via column-level grant approach.
-- Simplest fix: drop the team SELECT and create an admin-only policy for full access; create a SECURITY DEFINER view for team-safe fields.

-- Create a safe view for team members (excludes banking/tax fields)
CREATE OR REPLACE VIEW public.company_entities_safe
WITH (security_invoker = true) AS
SELECT
  id, name, legal_name, entity_type, logo_url,
  address_line1, address_line2, city, state, postal_code, country,
  email, phone, website, created_at
FROM public.company_entities;

-- Replace the team SELECT policy with admin-only SELECT on the base table
DROP POLICY IF EXISTS "Admin/team can view entities" ON public.company_entities;

CREATE POLICY "Admins can view full entities"
ON public.company_entities
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Grant team SELECT through the view (RLS on base table prevents direct access, but security_invoker view enforces it)
-- Since team can no longer see base table, expose safe fields via a SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.get_company_entities_safe()
RETURNS TABLE (
  id uuid, name text, legal_name text, entity_type text, logo_url text,
  address_line1 text, address_line2 text, city text, state text, postal_code text, country text,
  email text, phone text, website text, created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id, name, legal_name, entity_type, logo_url,
    address_line1, address_line2, city, state, postal_code, country,
    email, phone, website, created_at
  FROM public.company_entities
  WHERE is_admin_or_team(auth.uid());
$$;

-- 2. Restrict listing of objects in public storage buckets (objects remain publicly readable by direct URL,
-- but enumeration via list is blocked unless admin/team).
-- Drop any overly broad SELECT policies on storage.objects for these buckets, then add scoped ones.

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
        'Public read product-photos','Public read project-logos','Public read entity-logos',
        'Public read customer-logos','Public read qc-photos','Public read sample-photos',
        'Anyone can view product-photos','Anyone can view project-logos','Anyone can view entity-logos',
        'Anyone can view customer-logos','Anyone can view qc-photos','Anyone can view sample-photos'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

-- Allow listing/SELECT only to authenticated admin/team for these buckets
CREATE POLICY "Team can list app buckets"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id IN ('product-photos','project-logos','entity-logos','customer-logos','qc-photos','sample-photos')
  AND is_admin_or_team(auth.uid())
);
