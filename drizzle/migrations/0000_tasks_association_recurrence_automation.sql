ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS association_type text,
  ADD COLUMN IF NOT EXISTS association_id text,
  ADD COLUMN IF NOT EXISTS association_label text,
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb,
  ADD COLUMN IF NOT EXISTS source_event text;

COMMENT ON COLUMN public.tasks.product_id IS 'DEPRECATED: tasks no longer link to products; use association_* columns';

UPDATE public.tasks SET association_type = 'inquiry', association_id = inquiry_id::text
  WHERE inquiry_id IS NOT NULL AND association_type IS NULL;
UPDATE public.tasks SET association_type = 'customer', association_id = customer_id::text
  WHERE customer_id IS NOT NULL AND association_type IS NULL;

CREATE INDEX IF NOT EXISTS tasks_association_idx ON public.tasks(association_type, association_id);

CREATE TABLE public.task_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  trigger_event text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_automation_rules TO authenticated;
GRANT ALL ON public.task_automation_rules TO service_role;

ALTER TABLE public.task_automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team manage automation rules" ON public.task_automation_rules
  FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE TRIGGER task_automation_rules_updated_at
  BEFORE UPDATE ON public.task_automation_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();