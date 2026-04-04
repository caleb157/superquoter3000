
-- Fix 1: Remove dangerous anon policies on quote_snapshots
DROP POLICY IF EXISTS "Public can view quotes by share token" ON quote_snapshots;
DROP POLICY IF EXISTS "Public can update customer selections by share token" ON quote_snapshots;

-- Fix 2: Remove overly permissive guest policy on company_entities
DROP POLICY IF EXISTS "Guests can view entities" ON company_entities;

-- Create a secure function for guests to view only non-sensitive entity fields
-- for entities linked to projects they're invited to
CREATE OR REPLACE FUNCTION public.get_entity_for_guest(_entity_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  legal_name text,
  logo_url text,
  entity_type text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  email text,
  phone text,
  website text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    ce.id, ce.name, ce.legal_name, ce.logo_url, ce.entity_type,
    ce.address_line1, ce.address_line2, ce.city, ce.state, ce.postal_code, ce.country,
    ce.email, ce.phone, ce.website
  FROM company_entities ce
  WHERE ce.id = _entity_id
  AND EXISTS (
    SELECT 1 FROM project_settings ps
    JOIN project_invitations pi ON pi.project_id = ps.project_id
    WHERE ps.quoting_entity_id = ce.id
    AND lower(pi.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    AND pi.accepted = true
  )
  LIMIT 1;
$$;
