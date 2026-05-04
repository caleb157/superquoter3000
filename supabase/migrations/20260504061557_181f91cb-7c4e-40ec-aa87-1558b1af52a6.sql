CREATE TABLE IF NOT EXISTS public.customer_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text,
  note text
);

CREATE INDEX IF NOT EXISTS idx_cle_customer_time
  ON public.customer_lifecycle_events(customer_id, occurred_at DESC);

ALTER TABLE public.customer_lifecycle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/team can manage customer lifecycle events" ON public.customer_lifecycle_events;
CREATE POLICY "Admin/team can manage customer lifecycle events"
  ON public.customer_lifecycle_events FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE OR REPLACE FUNCTION public.emit_customer_lifecycle_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_actor text := coalesce(current_setting('request.jwt.claim.email', true), 'system');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.customer_lifecycle_events (customer_id, from_status, to_status, actor)
    VALUES (NEW.id, NULL, NEW.lead_status, v_actor);
  ELSIF NEW.lead_status IS DISTINCT FROM OLD.lead_status THEN
    INSERT INTO public.customer_lifecycle_events (customer_id, from_status, to_status, actor)
    VALUES (NEW.id, OLD.lead_status, NEW.lead_status, v_actor);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emit_customer_lifecycle_event ON public.customers;
CREATE TRIGGER trg_emit_customer_lifecycle_event
  AFTER INSERT OR UPDATE OF lead_status ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.emit_customer_lifecycle_event();

INSERT INTO public.customer_lifecycle_events (customer_id, from_status, to_status, occurred_at, actor)
SELECT id, NULL, lead_status, created_at, 'backfill'
FROM public.customers c
WHERE NOT EXISTS (
  SELECT 1 FROM public.customer_lifecycle_events e WHERE e.customer_id = c.id
);

ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS slow_quote_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS slow_sample_days integer NOT NULL DEFAULT 14;