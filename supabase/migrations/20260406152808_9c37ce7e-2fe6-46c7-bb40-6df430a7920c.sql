
CREATE TABLE public.pipeline_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  who TEXT,
  design_done BOOLEAN NOT NULL DEFAULT false,
  photo_done BOOLEAN NOT NULL DEFAULT false,
  rfq_date DATE,
  initial_quote_date DATE,
  sample_request_date DATE,
  initial_sample_date DATE,
  final_sample_date DATE,
  finish TEXT,
  dimensions_inch TEXT,
  weight_kg NUMERIC,
  status TEXT NOT NULL DEFAULT 'active',
  is_foak BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage pipeline items"
ON public.pipeline_items
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()));

CREATE POLICY "Guests can view pipeline items for invited projects"
ON public.pipeline_items
FOR SELECT
TO authenticated
USING (project_id IS NOT NULL AND is_guest_for_project(auth.uid(), project_id));

CREATE TRIGGER update_pipeline_items_updated_at
BEFORE UPDATE ON public.pipeline_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pipeline_items_customer ON public.pipeline_items(customer_id);
CREATE INDEX idx_pipeline_items_project ON public.pipeline_items(project_id);
CREATE INDEX idx_pipeline_items_status ON public.pipeline_items(status);
