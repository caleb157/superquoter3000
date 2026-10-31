CREATE TABLE public.late_report_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  late_start time NOT NULL DEFAULT '09:15',
  late_end time NOT NULL DEFAULT '09:45',
  very_late_start time NOT NULL DEFAULT '09:45',
  very_late_limit integer NOT NULL DEFAULT 2,
  grace_count integer NOT NULL DEFAULT 0,
  penalty_inr numeric NOT NULL DEFAULT 100,
  hr_tag text NOT NULL DEFAULT 'Discipline',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.late_report_settings TO authenticated;
GRANT ALL ON public.late_report_settings TO service_role;
ALTER TABLE public.late_report_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage late report settings" ON public.late_report_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.late_report_settings (id) VALUES (true);
ALTER TABLE public.hr_notes ADD COLUMN source_key text UNIQUE;