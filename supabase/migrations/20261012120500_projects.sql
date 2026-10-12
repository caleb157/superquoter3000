-- Projects: a short list of pieces of work, each with a status, dates and notes.
-- Tasks link to a project through the existing association columns
-- (association_type = 'project', association_id = projects.id), so tasks need no change.
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  start_date date,
  end_date date,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_status_check') THEN
    ALTER TABLE public.projects ADD CONSTRAINT projects_status_check
      CHECK (status IN ('in_progress', 'paused', 'done', 'cancelled'));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/team manage projects" ON public.projects;
CREATE POLICY "Admin/team manage projects" ON public.projects FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));

DROP TRIGGER IF EXISTS trg_projects_updated_at ON public.projects;
CREATE TRIGGER trg_projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_tasks_association ON public.tasks (association_type, association_id);
