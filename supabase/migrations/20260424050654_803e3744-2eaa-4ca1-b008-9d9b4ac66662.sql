-- Add photo_urls column to tasks for attachment URLs
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS photo_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Create public storage bucket for task photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-photos', 'task-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for task-photos bucket
CREATE POLICY "Task photos are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'task-photos');

CREATE POLICY "Admin/team can upload task photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'task-photos' AND public.is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can update task photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'task-photos' AND public.is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can delete task photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'task-photos' AND public.is_admin_or_team(auth.uid()));