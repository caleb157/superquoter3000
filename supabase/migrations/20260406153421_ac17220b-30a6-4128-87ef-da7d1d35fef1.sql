
CREATE TABLE public.pipeline_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_item_id UUID NOT NULL REFERENCES public.pipeline_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assigned_to TEXT,
  due_date DATE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage pipeline tasks"
ON public.pipeline_tasks
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()));

CREATE INDEX idx_pipeline_tasks_item ON public.pipeline_tasks(pipeline_item_id);
CREATE INDEX idx_pipeline_tasks_due ON public.pipeline_tasks(due_date) WHERE completed = false;

CREATE TRIGGER update_pipeline_tasks_updated_at
BEFORE UPDATE ON public.pipeline_tasks
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.pipeline_activity (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pipeline_item_id UUID NOT NULL REFERENCES public.pipeline_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage pipeline activity"
ON public.pipeline_activity
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()));

CREATE INDEX idx_pipeline_activity_item ON public.pipeline_activity(pipeline_item_id);
