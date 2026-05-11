-- Make task/qc/sample photo buckets private; replace public-read policies with admin/team-only SELECT
UPDATE storage.buckets SET public = false WHERE id IN ('task-photos','qc-photos','sample-photos');

-- Drop any public-read SELECT policies for these buckets
DROP POLICY IF EXISTS "Task photos are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Public read qc-photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view qc-photos" ON storage.objects;
DROP POLICY IF EXISTS "Public read sample-photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view sample-photos" ON storage.objects;

-- Add admin/team SELECT policies (idempotent)
DROP POLICY IF EXISTS "Admin/team can view task photos" ON storage.objects;
CREATE POLICY "Admin/team can view task photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'task-photos' AND public.is_admin_or_team(auth.uid()));

DROP POLICY IF EXISTS "Admin/team can view qc photos" ON storage.objects;
CREATE POLICY "Admin/team can view qc photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'qc-photos' AND public.is_admin_or_team(auth.uid()));

DROP POLICY IF EXISTS "Admin/team can view sample photos" ON storage.objects;
CREATE POLICY "Admin/team can view sample photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'sample-photos' AND public.is_admin_or_team(auth.uid()));