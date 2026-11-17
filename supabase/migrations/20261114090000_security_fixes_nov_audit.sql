-- Records the two fixes from the Nov 10 security audit, which were run by hand
-- on the live database. Without this file a database rebuilt from the
-- migrations would bring both holes back. Safe to run more than once.

-- 1) Old vendor RFQ function returned estimated_cost and vendor_price to anyone
--    with the link. The vendor page uses
--    get_rfq_line_items_with_responses_by_share_token instead.
DROP FUNCTION IF EXISTS public.get_rfq_line_items_by_share_token(text);

-- 2) Stop anyone listing whole photo/logo buckets. Public buckets still serve
--    files by direct link; the signed-in team keeps "Team can list app buckets".
DROP POLICY IF EXISTS "Public can read product photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can read entity logos"   ON storage.objects;
DROP POLICY IF EXISTS "Public can read customer logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view customer logos" ON storage.objects;

-- 3) Dead function from the old guest flow. It reads tables that no longer
--    exist and was still callable by logged-out visitors.
DROP FUNCTION IF EXISTS public.get_entity_for_guest(text);
