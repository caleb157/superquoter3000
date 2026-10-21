CREATE TABLE public.learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  notes text,
  photo_urls text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'Idea' CHECK (status IN ('Idea','In Progress','Review','Done','Cancelled')),
  so_number text,
  so_label text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learnings TO authenticated;
GRANT ALL ON public.learnings TO service_role;
ALTER TABLE public.learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team manage learnings" ON public.learnings FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
CREATE TRIGGER learnings_updated BEFORE UPDATE ON public.learnings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.hr_note_tags (
  name text PRIMARY KEY CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_note_tags TO authenticated;
GRANT ALL ON public.hr_note_tags TO service_role;
ALTER TABLE public.hr_note_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage hr tags" ON public.hr_note_tags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.hr_note_tags (name) VALUES ('Feedback'),('Discipline'),('Development');

CREATE TABLE public.hr_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_odoo_id integer,
  employee_name text NOT NULL,
  tag text NOT NULL,
  title text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Resolved','Cancelled')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_notes TO authenticated;
GRANT ALL ON public.hr_notes TO service_role;
ALTER TABLE public.hr_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage hr notes" ON public.hr_notes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER hr_notes_updated BEFORE UPDATE ON public.hr_notes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();