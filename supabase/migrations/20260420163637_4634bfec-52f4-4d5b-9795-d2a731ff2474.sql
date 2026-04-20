INSERT INTO storage.buckets (id, name, public)
VALUES ('sample-photos', 'sample-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admin/team can upload sample photos" ON storage.objects;
CREATE POLICY "Admin/team can upload sample photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sample-photos' AND public.is_admin_or_team(auth.uid()));

DROP POLICY IF EXISTS "Admin/team can update sample photos" ON storage.objects;
CREATE POLICY "Admin/team can update sample photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'sample-photos' AND public.is_admin_or_team(auth.uid()));

DROP POLICY IF EXISTS "Admin/team can delete sample photos" ON storage.objects;
CREATE POLICY "Admin/team can delete sample photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sample-photos' AND public.is_admin_or_team(auth.uid()));

DROP POLICY IF EXISTS "Public can read sample photos" ON storage.objects;
CREATE POLICY "Public can read sample photos"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'sample-photos');