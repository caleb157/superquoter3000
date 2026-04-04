
-- The customer-logos policies already existed, drop and recreate with correct checks
DROP POLICY IF EXISTS "Admin/team can upload customer logos" ON storage.objects;
DROP POLICY IF EXISTS "Admin/team can update customer logos" ON storage.objects;
DROP POLICY IF EXISTS "Admin/team can delete customer logos" ON storage.objects;

CREATE POLICY "Admin/team can upload customer logos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'customer-logos' AND public.is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can update customer logos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'customer-logos' AND public.is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can delete customer logos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'customer-logos' AND public.is_admin_or_team(auth.uid()));
