-- =========================================================================
-- Customer status events
-- =========================================================================
CREATE TABLE public.customer_status_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  actor TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_status_events_customer ON public.customer_status_events(customer_id, occurred_at DESC);

ALTER TABLE public.customer_status_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage customer status events"
ON public.customer_status_events
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()))
WITH CHECK (is_admin_or_team(auth.uid()));

-- =========================================================================
-- Inquiry status events
-- =========================================================================
CREATE TABLE public.inquiry_status_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inquiry_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  actor TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_inquiry_status_events_inquiry ON public.inquiry_status_events(inquiry_id, occurred_at DESC);

ALTER TABLE public.inquiry_status_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage inquiry status events"
ON public.inquiry_status_events
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()))
WITH CHECK (is_admin_or_team(auth.uid()));

-- =========================================================================
-- Trigger: emit customer status events
-- =========================================================================
CREATE OR REPLACE FUNCTION public.emit_customer_status_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor text := coalesce(current_setting('request.jwt.claim.email', true), 'system');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.customer_status_events (customer_id, from_status, to_status, actor)
    VALUES (NEW.id, NULL, NEW.lead_status, v_actor);
  ELSIF TG_OP = 'UPDATE' AND NEW.lead_status IS DISTINCT FROM OLD.lead_status THEN
    INSERT INTO public.customer_status_events (customer_id, from_status, to_status, actor)
    VALUES (NEW.id, OLD.lead_status, NEW.lead_status, v_actor);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_emit_customer_status_event
AFTER INSERT OR UPDATE OF lead_status ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.emit_customer_status_event();

-- =========================================================================
-- Trigger: emit inquiry status events
-- =========================================================================
CREATE OR REPLACE FUNCTION public.emit_inquiry_status_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_actor text := coalesce(current_setting('request.jwt.claim.email', true), 'system');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.inquiry_status_events (inquiry_id, from_status, to_status, actor)
    VALUES (NEW.id, NULL, NEW.status, v_actor);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.inquiry_status_events (inquiry_id, from_status, to_status, actor)
    VALUES (NEW.id, OLD.status, NEW.status, v_actor);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_emit_inquiry_status_event
AFTER INSERT OR UPDATE OF status ON public.customer_rfqs
FOR EACH ROW EXECUTE FUNCTION public.emit_inquiry_status_event();

-- =========================================================================
-- Backfill existing customers + inquiries with an initial event
-- (using created_at so the history doesn't appear empty)
-- =========================================================================
INSERT INTO public.customer_status_events (customer_id, from_status, to_status, occurred_at, actor, note)
SELECT id, NULL, lead_status, COALESCE(created_at, now()), 'system', 'Backfilled initial status'
FROM public.customers;

INSERT INTO public.inquiry_status_events (inquiry_id, from_status, to_status, occurred_at, actor, note)
SELECT id, NULL, status, COALESCE(created_at, now()), 'system', 'Backfilled initial status'
FROM public.customer_rfqs;