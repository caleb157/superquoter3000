-- Sample requests: one request per batch of samples, with the existing `samples` rows as its lines.
-- Replaces the separate "received sample request" log (inquiry_received_rfs) and the hand-set product
-- sample stage. Line statuses keep their stored values: pending = requested, completed = received at
-- our factory (completed_at = when it arrived), cancelled. Nothing is deleted.

CREATE SEQUENCE IF NOT EXISTS public.sample_request_seq;

CREATE OR REPLACE FUNCTION public.generate_sample_request_number()
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  n := nextval('public.sample_request_seq');
  RETURN 'SR-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 3, '0');
END $$;

CREATE TABLE IF NOT EXISTS public.sample_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE NOT NULL DEFAULT public.generate_sample_request_number(),
  customer_rfq_id uuid REFERENCES public.customer_rfqs(id) ON DELETE CASCADE,
  customer_requested_date date,          -- when the customer asked for samples, if known
  requested_date date NOT NULL DEFAULT current_date,  -- when we asked for them; the sample clock starts here
  required_by_date date,
  notes text,
  legacy_rfs_id uuid,                     -- the inquiry_received_rfs row this was moved from, if any
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sample_requests_inquiry_idx ON public.sample_requests(customer_rfq_id);

ALTER TABLE public.sample_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team can manage sample requests" ON public.sample_requests;
CREATE POLICY "Admin/team can manage sample requests"
  ON public.sample_requests FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

ALTER TABLE public.samples ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES public.sample_requests(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS samples_request_idx ON public.samples(request_id);

-- 1. Each logged customer sample request becomes a request; its samples become its lines.
INSERT INTO public.sample_requests (customer_rfq_id, customer_requested_date, requested_date, notes, legacy_rfs_id, created_at)
SELECT r.inquiry_id, r.received_date, r.received_date, r.notes, r.id, r.created_at
FROM public.inquiry_received_rfs r
WHERE NOT EXISTS (SELECT 1 FROM public.sample_requests sr WHERE sr.legacy_rfs_id = r.id);

UPDATE public.samples s SET request_id = sr.id
FROM public.sample_requests sr
WHERE s.request_id IS NULL AND s.rfs_id IS NOT NULL AND sr.legacy_rfs_id = s.rfs_id;

-- 2. Remaining samples: one request per inquiry and requested date.
INSERT INTO public.sample_requests (customer_rfq_id, requested_date, created_at)
SELECT s.customer_rfq_id, coalesce(s.requested_date, s.created_at::date), min(s.created_at)
FROM public.samples s
WHERE s.request_id IS NULL
GROUP BY s.customer_rfq_id, coalesce(s.requested_date, s.created_at::date);

UPDATE public.samples s SET request_id = sr.id
FROM public.sample_requests sr
WHERE s.request_id IS NULL
  AND sr.legacy_rfs_id IS NULL
  AND sr.customer_rfq_id IS NOT DISTINCT FROM s.customer_rfq_id
  AND sr.requested_date = coalesce(s.requested_date, s.created_at::date);

-- 3. The product sample stage follows its sample lines from now on: any open line -> 'sampling',
--    otherwise any received line -> 'sampled'. Products with no lines keep whatever they had.
CREATE OR REPLACE FUNCTION public.sync_product_sample_stage(p_product_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stage text;
BEGIN
  IF p_product_id IS NULL THEN RETURN; END IF;
  SELECT CASE
           WHEN bool_or(status = 'pending') THEN 'sampling'
           WHEN bool_or(status = 'completed') THEN 'sampled'
         END
    INTO v_stage
  FROM public.samples WHERE product_id = p_product_id;
  IF v_stage IS NOT NULL THEN
    UPDATE public.products SET sample_stage = v_stage
    WHERE id = p_product_id AND sample_stage IS DISTINCT FROM v_stage;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.samples_sync_stage_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN PERFORM public.sync_product_sample_stage(OLD.product_id); END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.sync_product_sample_stage(NEW.product_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS samples_sync_stage ON public.samples;
CREATE TRIGGER samples_sync_stage
  AFTER INSERT OR UPDATE OR DELETE ON public.samples
  FOR EACH ROW EXECUTE FUNCTION public.samples_sync_stage_trigger();
