
ALTER TABLE public.samples
  ADD COLUMN IF NOT EXISTS customer_rfq_id uuid REFERENCES public.customer_rfqs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS required_by_date date;

UPDATE public.samples s
SET customer_rfq_id = r.customer_rfq_id
FROM public.rfs r
WHERE s.rfs_id = r.id AND s.customer_rfq_id IS NULL;

UPDATE public.samples s
SET customer_rfq_id = p.customer_rfq_id
FROM public.products p
WHERE s.product_id = p.id AND s.customer_rfq_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_samples_customer_rfq_id ON public.samples(customer_rfq_id);

UPDATE public.samples SET status = CASE
  WHEN status IN ('pending','completed','cancelled') THEN status
  WHEN status IN ('approved','received') THEN 'completed'
  WHEN status = 'rejected' THEN 'cancelled'
  WHEN status IN ('requested','in_production','ready') THEN 'pending'
  ELSE 'pending'
END;

CREATE OR REPLACE FUNCTION public.validate_sample_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('pending','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid sample status: %', NEW.status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_sample_status ON public.samples;
CREATE TRIGGER trg_validate_sample_status
  BEFORE INSERT OR UPDATE ON public.samples
  FOR EACH ROW EXECUTE FUNCTION public.validate_sample_status();

CREATE OR REPLACE FUNCTION public.stamp_sample_completed_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    NEW.completed_at := now();
  ELSIF NEW.status <> 'completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_stamp_sample_completed_at ON public.samples;
CREATE TRIGGER trg_stamp_sample_completed_at
  BEFORE UPDATE ON public.samples
  FOR EACH ROW EXECUTE FUNCTION public.stamp_sample_completed_at();

UPDATE public.samples
SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;

ALTER TABLE public.samples ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.samples ALTER COLUMN requested_date SET DEFAULT CURRENT_DATE;

DROP TABLE IF EXISTS public.rfs CASCADE;
DROP SEQUENCE IF EXISTS public.rfs_seq;
DROP FUNCTION IF EXISTS public.generate_rfs_number();

UPDATE public.products SET sample_stage = 'sampling' WHERE sample_stage = 'sample_sent';

CREATE OR REPLACE FUNCTION public.validate_product_stages()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.design_stage IS NOT NULL AND NEW.design_stage NOT IN ('need_design','designed') THEN
    RAISE EXCEPTION 'Invalid design_stage: %', NEW.design_stage;
  END IF;
  IF NEW.quote_stage IS NOT NULL AND NEW.quote_stage NOT IN ('quoting','ready_for_quote','quoted') THEN
    RAISE EXCEPTION 'Invalid quote_stage: %', NEW.quote_stage;
  END IF;
  IF NEW.sample_stage IS NOT NULL AND NEW.sample_stage NOT IN ('sampling') THEN
    RAISE EXCEPTION 'Invalid sample_stage: %', NEW.sample_stage;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.update_product_sample_stage_on_sample_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_product_id uuid;
  v_pending_count int;
  v_any_count int;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  IF v_product_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT
    count(*) FILTER (WHERE status = 'pending'),
    count(*)
  INTO v_pending_count, v_any_count
  FROM public.samples
  WHERE product_id = v_product_id;
  IF v_pending_count > 0 THEN
    UPDATE public.products SET sample_stage = 'sampling' WHERE id = v_product_id AND sample_stage IS DISTINCT FROM 'sampling';
  ELSIF v_any_count > 0 THEN
    UPDATE public.products SET sample_stage = NULL WHERE id = v_product_id AND sample_stage = 'sampling';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_update_product_sample_stage ON public.samples;
CREATE TRIGGER trg_update_product_sample_stage
  AFTER INSERT OR UPDATE OR DELETE ON public.samples
  FOR EACH ROW EXECUTE FUNCTION public.update_product_sample_stage_on_sample_change();
