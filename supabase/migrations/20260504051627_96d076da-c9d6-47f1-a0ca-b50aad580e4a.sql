CREATE TABLE IF NOT EXISTS public.inquiry_received_rfs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inquiry_id uuid NOT NULL,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inquiry_received_rfs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage inquiry received rfs"
  ON public.inquiry_received_rfs FOR ALL TO authenticated
  USING (is_admin_or_team(auth.uid()))
  WITH CHECK (is_admin_or_team(auth.uid()));

CREATE TRIGGER trg_inquiry_received_rfs_updated_at
  BEFORE UPDATE ON public.inquiry_received_rfs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_inquiry_received_rfs_inquiry_id
  ON public.inquiry_received_rfs(inquiry_id);