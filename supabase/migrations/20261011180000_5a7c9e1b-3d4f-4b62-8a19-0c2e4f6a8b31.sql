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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sample_requests TO authenticated;
GRANT ALL ON public.sample_requests TO service_role;

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

-- 3. The product sample stage follows its sample lines (this replaces the existing trigger's body):
--    any open line -> 'sampling'; otherwise any line received at the factory -> 'sampled';
--    only cancelled lines -> cleared. Products with no lines keep whatever they had.
CREATE OR REPLACE FUNCTION public.update_product_sample_stage_on_sample_change()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE
  v_product_id uuid;
  v_stage text;
  v_any int;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  IF v_product_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT CASE
           WHEN bool_or(status = 'pending') THEN 'sampling'
           WHEN bool_or(status = 'completed') THEN 'sampled'
         END,
         count(*)
    INTO v_stage, v_any
  FROM public.samples WHERE product_id = v_product_id;
  IF v_any > 0 THEN
    UPDATE public.products SET sample_stage = v_stage
    WHERE id = v_product_id AND sample_stage IS DISTINCT FROM v_stage;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;
