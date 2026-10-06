CREATE TABLE public.task_automation_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  webhook_token text NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.task_automation_config TO authenticated;
GRANT ALL ON public.task_automation_config TO service_role;
ALTER TABLE public.task_automation_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read automation config" ON public.task_automation_config
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update automation config" ON public.task_automation_config
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.task_automation_config (id) VALUES (1) ON CONFLICT DO NOTHING;