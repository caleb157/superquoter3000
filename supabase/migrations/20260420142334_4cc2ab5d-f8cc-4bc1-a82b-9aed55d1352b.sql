-- Rename rfqs → vendor_rfqs and rfq_line_items → vendor_rfq_line_items
ALTER TABLE public.rfqs RENAME TO vendor_rfqs;
ALTER TABLE public.rfq_line_items RENAME TO vendor_rfq_line_items;
ALTER TABLE public.vendor_rfq_line_items RENAME COLUMN rfq_id TO vendor_rfq_id;

-- Rename indexes / constraints
ALTER INDEX public.rfqs_pkey RENAME TO vendor_rfqs_pkey;
ALTER INDEX public.rfqs_share_token_key RENAME TO vendor_rfqs_share_token_key;
ALTER INDEX public.idx_rfqs_project_id RENAME TO idx_vendor_rfqs_project_id;
ALTER INDEX public.idx_rfqs_share_token RENAME TO idx_vendor_rfqs_share_token;
ALTER INDEX public.rfq_line_items_pkey RENAME TO vendor_rfq_line_items_pkey;
ALTER INDEX public.idx_rfq_line_items_rfq_id RENAME TO idx_vendor_rfq_line_items_vendor_rfq_id;
ALTER INDEX public.idx_rfq_line_items_product_id RENAME TO idx_vendor_rfq_line_items_product_id;

-- Rename trigger
ALTER TRIGGER update_rfqs_updated_at ON public.vendor_rfqs RENAME TO update_vendor_rfqs_updated_at;

-- Drop old policies and recreate against renamed tables
DROP POLICY IF EXISTS "Admin/team can manage rfqs" ON public.vendor_rfqs;
CREATE POLICY "Admin/team can manage vendor rfqs"
ON public.vendor_rfqs
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()))
WITH CHECK (is_admin_or_team(auth.uid()));

DROP POLICY IF EXISTS "Admin/team can manage rfq line items" ON public.vendor_rfq_line_items;
CREATE POLICY "Admin/team can manage vendor rfq line items"
ON public.vendor_rfq_line_items
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()))
WITH CHECK (is_admin_or_team(auth.uid()));

-- Update share-token RPC functions to point at the renamed tables
CREATE OR REPLACE FUNCTION public.get_rfq_by_share_token(_token text)
RETURNS SETOF public.vendor_rfqs
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.vendor_rfqs WHERE share_token = _token LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_rfq_line_items_by_share_token(_token text)
RETURNS SETOF public.vendor_rfq_line_items
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT li.* FROM public.vendor_rfq_line_items li
  JOIN public.vendor_rfqs r ON r.id = li.vendor_rfq_id
  WHERE r.share_token = _token
  ORDER BY li.sort_order;
$$;