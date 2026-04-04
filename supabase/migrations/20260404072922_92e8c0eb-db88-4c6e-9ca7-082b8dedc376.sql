
-- Fix 1: Remove dangerous anon SELECT policies on rfqs and rfq_line_items
DROP POLICY IF EXISTS "Public can view rfqs by share token" ON rfqs;
DROP POLICY IF EXISTS "Public can view rfq line items by share token" ON rfq_line_items;

-- Create secure RPC functions that validate the share token
CREATE OR REPLACE FUNCTION public.get_rfq_by_share_token(_token text)
RETURNS SETOF rfqs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM rfqs WHERE share_token = _token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_rfq_line_items_by_share_token(_token text)
RETURNS SETOF rfq_line_items
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT li.* FROM rfq_line_items li
  JOIN rfqs r ON r.id = li.rfq_id
  WHERE r.share_token = _token
  ORDER BY li.sort_order;
$$;

-- Grant anon access to these functions
GRANT EXECUTE ON FUNCTION public.get_rfq_by_share_token(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_rfq_line_items_by_share_token(text) TO anon;

-- Fix 2: Restrict storage bucket write access to admin/team only
DROP POLICY IF EXISTS "Auth users can upload photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can update photos" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can delete photos" ON storage.objects;

CREATE POLICY "Admin/team can upload photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = ANY (ARRAY['product-photos', 'project-logos', 'entity-logos', 'customer-logos'])
    AND is_admin_or_team(auth.uid())
  );

CREATE POLICY "Admin/team can update photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = ANY (ARRAY['product-photos', 'project-logos', 'entity-logos', 'customer-logos'])
    AND is_admin_or_team(auth.uid())
  );

CREATE POLICY "Admin/team can delete photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = ANY (ARRAY['product-photos', 'project-logos', 'entity-logos', 'customer-logos'])
    AND is_admin_or_team(auth.uid())
  );
