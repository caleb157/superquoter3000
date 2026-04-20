-- ============================================================
-- Phase 1: Schema foundation for Inquiry-centered architecture
-- ============================================================

-- 1. Products: link directly to inquiries, add stage tracking, add notes
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS customer_rfq_id uuid REFERENCES public.customer_rfqs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS design_stage text,
  ADD COLUMN IF NOT EXISTS quote_stage text,
  ADD COLUMN IF NOT EXISTS sample_stage text,
  ADD COLUMN IF NOT EXISTS notes_finishes text,
  ADD COLUMN IF NOT EXISTS notes_vendors text,
  ADD COLUMN IF NOT EXISTS notes_issues text;

CREATE INDEX IF NOT EXISTS idx_products_customer_rfq_id ON public.products(customer_rfq_id);
CREATE INDEX IF NOT EXISTS idx_products_design_stage ON public.products(design_stage);
CREATE INDEX IF NOT EXISTS idx_products_quote_stage ON public.products(quote_stage);
CREATE INDEX IF NOT EXISTS idx_products_sample_stage ON public.products(sample_stage);

UPDATE public.products p
SET customer_rfq_id = pr.customer_rfq_id
FROM public.projects pr
WHERE p.project_id = pr.id
  AND p.customer_rfq_id IS NULL
  AND pr.customer_rfq_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_product_stages()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.design_stage IS NOT NULL AND NEW.design_stage NOT IN ('need_design','designed') THEN
    RAISE EXCEPTION 'Invalid design_stage: %', NEW.design_stage;
  END IF;
  IF NEW.quote_stage IS NOT NULL AND NEW.quote_stage NOT IN ('quoting','ready_for_quote','quoted') THEN
    RAISE EXCEPTION 'Invalid quote_stage: %', NEW.quote_stage;
  END IF;
  IF NEW.sample_stage IS NOT NULL AND NEW.sample_stage NOT IN ('sampling','sample_sent') THEN
    RAISE EXCEPTION 'Invalid sample_stage: %', NEW.sample_stage;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_product_stages ON public.products;
CREATE TRIGGER trg_validate_product_stages
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.validate_product_stages();

-- 2. Product stage event log
CREATE TABLE IF NOT EXISTS public.product_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  track text NOT NULL,
  from_stage text,
  to_stage text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text,
  CONSTRAINT product_stage_events_track_chk CHECK (track IN ('design','quote','sample'))
);

CREATE INDEX IF NOT EXISTS idx_pse_product_track_time
  ON public.product_stage_events(product_id, track, occurred_at DESC);

ALTER TABLE public.product_stage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage product stage events"
  ON public.product_stage_events FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE OR REPLACE FUNCTION public.emit_product_stage_events()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_actor text := coalesce(current_setting('request.jwt.claim.email', true), 'system');
BEGIN
  IF NEW.design_stage IS DISTINCT FROM OLD.design_stage THEN
    INSERT INTO public.product_stage_events (product_id, track, from_stage, to_stage, actor)
    VALUES (NEW.id, 'design', OLD.design_stage, NEW.design_stage, v_actor);
  END IF;
  IF NEW.quote_stage IS DISTINCT FROM OLD.quote_stage THEN
    INSERT INTO public.product_stage_events (product_id, track, from_stage, to_stage, actor)
    VALUES (NEW.id, 'quote', OLD.quote_stage, NEW.quote_stage, v_actor);
  END IF;
  IF NEW.sample_stage IS DISTINCT FROM OLD.sample_stage THEN
    INSERT INTO public.product_stage_events (product_id, track, from_stage, to_stage, actor)
    VALUES (NEW.id, 'sample', OLD.sample_stage, NEW.sample_stage, v_actor);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emit_product_stage_events ON public.products;
CREATE TRIGGER trg_emit_product_stage_events
  AFTER UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.emit_product_stage_events();

-- 3. Quote snapshots: link to inquiry directly
ALTER TABLE public.quote_snapshots
  ADD COLUMN IF NOT EXISTS customer_rfq_id uuid REFERENCES public.customer_rfqs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quote_snapshots_customer_rfq_id
  ON public.quote_snapshots(customer_rfq_id);

UPDATE public.quote_snapshots qs
SET customer_rfq_id = pr.customer_rfq_id
FROM public.projects pr
WHERE qs.project_id = pr.id
  AND qs.customer_rfq_id IS NULL
  AND pr.customer_rfq_id IS NOT NULL;

-- 4. Customer RFQs: change default status to 'active'
ALTER TABLE public.customer_rfqs ALTER COLUMN status SET DEFAULT 'active';

-- 5. Tasks
CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid REFERENCES public.customer_rfqs(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  assignee text,
  due_date date,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'open',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_anchor_chk CHECK (
    ((inquiry_id IS NOT NULL)::int + (customer_id IS NOT NULL)::int) = 1
  ),
  CONSTRAINT tasks_product_requires_inquiry_chk CHECK (
    product_id IS NULL OR inquiry_id IS NOT NULL
  ),
  CONSTRAINT tasks_priority_chk CHECK (priority IN ('low','normal','high','urgent')),
  CONSTRAINT tasks_status_chk CHECK (status IN ('open','done'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_inquiry_id ON public.tasks(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_tasks_customer_id ON public.tasks(customer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_product_id ON public.tasks(product_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON public.tasks(status, due_date);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage tasks"
  ON public.tasks FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.stamp_task_completed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'done' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_task_completed_at ON public.tasks;
CREATE TRIGGER trg_stamp_task_completed_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.stamp_task_completed_at();

-- 6. Samples: allow linking directly to a product
ALTER TABLE public.samples
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_samples_product_id ON public.samples(product_id);

-- 7. Inquiry received RFQs
CREATE TABLE IF NOT EXISTS public.inquiry_received_rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquiry_id uuid NOT NULL REFERENCES public.customer_rfqs(id) ON DELETE CASCADE,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_irr_inquiry_id
  ON public.inquiry_received_rfqs(inquiry_id);

ALTER TABLE public.inquiry_received_rfqs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage inquiry received rfqs"
  ON public.inquiry_received_rfqs FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE TRIGGER trg_irr_updated_at
  BEFORE UPDATE ON public.inquiry_received_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();