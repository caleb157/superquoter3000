-- Sales section, Phase 1: CRM core.
-- customers stays the account record; new contacts, sales_touches, sales_stage_events, send_blocks and job_runs.
-- Do not contact is one master flag: on a contact, or on the account (which covers all its contacts).
-- Safe to run more than once.

-- 1. Accounts: sales columns on customers, and a 'prospect' lead status that fires no Lead task rules.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS domain text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS persona text,
  ADD COLUMN IF NOT EXISTS customer_type text,
  ADD COLUMN IF NOT EXISTS fit_score integer,
  ADD COLUMN IF NOT EXISTS owner text,
  ADD COLUMN IF NOT EXISTS sales_stage text,
  ADD COLUMN IF NOT EXISTS sales_stage_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS not_now_until date,
  ADD COLUMN IF NOT EXISTS next_step text,
  ADD COLUMN IF NOT EXISTS next_step_date date,
  ADD COLUMN IF NOT EXISTS brief jsonb,
  ADD COLUMN IF NOT EXISTS brief_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS dnc boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dnc_at timestamptz,
  ADD COLUMN IF NOT EXISTS dnc_source text,
  ADD COLUMN IF NOT EXISTS dnc_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_domain ON public.customers (lower(domain)) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_sales_stage ON public.customers (sales_stage) WHERE sales_stage IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_customer_lead_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_status NOT IN ('prospect','lead','active','won','inactive','churned') THEN
    RAISE EXCEPTION 'Invalid lead_status: %', NEW.lead_status;
  END IF;
  RETURN NEW;
END $function$;

-- Stage rules: valid stages, Not now needs a date, the stage time stamps itself.
CREATE OR REPLACE FUNCTION public.validate_customer_sales_stage()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.sales_stage IS NOT NULL AND NEW.sales_stage NOT IN
     ('queued','in_outreach','responded','in_conversation','inquiry','customer','not_now','not_a_fit','dnc') THEN
    RAISE EXCEPTION 'Invalid sales_stage: %', NEW.sales_stage;
  END IF;
  IF NEW.sales_stage = 'not_now' AND NEW.not_now_until IS NULL THEN
    RAISE EXCEPTION 'Not now needs a follow-up date (not_now_until)';
  END IF;
  IF NEW.fit_score IS NOT NULL AND (NEW.fit_score < 0 OR NEW.fit_score > 100) THEN
    RAISE EXCEPTION 'fit_score must be 0 to 100';
  END IF;
  IF NEW.dnc THEN
    NEW.sales_stage := 'dnc';
    NEW.dnc_at := coalesce(NEW.dnc_at, now());
  END IF;
  IF TG_OP = 'INSERT' OR NEW.sales_stage IS DISTINCT FROM OLD.sales_stage THEN
    NEW.sales_stage_changed_at := now();
  END IF;
  -- Only an admin can take an account off do not contact.
  IF TG_OP = 'UPDATE' AND OLD.dnc AND NOT NEW.dnc
     AND auth.uid() IS NOT NULL AND NOT coalesce(public.has_role(auth.uid(), 'admin'), false) THEN
    RAISE EXCEPTION 'Only an admin can clear do not contact';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_customer_sales_stage ON public.customers;
CREATE TRIGGER trg_validate_customer_sales_stage
  BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.validate_customer_sales_stage();

-- Every stage move is logged with who moved it; set_sales_stage then writes the one-line reason on that row.
CREATE TABLE IF NOT EXISTS public.sales_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text,
  actor text,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_stage_events_customer ON public.sales_stage_events (customer_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.emit_sales_stage_event()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.sales_stage IS NOT NULL)
     OR (TG_OP = 'UPDATE' AND NEW.sales_stage IS DISTINCT FROM OLD.sales_stage) THEN
    INSERT INTO public.sales_stage_events (customer_id, from_stage, to_stage, actor, reason)
    VALUES (
      NEW.id,
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.sales_stage END,
      NEW.sales_stage,
      coalesce(current_setting('request.jwt.claim.email', true), 'system'),
      CASE WHEN NEW.sales_stage = 'dnc' THEN coalesce(NEW.dnc_reason, 'do not contact') END
    );
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_emit_sales_stage_event ON public.customers;
CREATE TRIGGER trg_emit_sales_stage_event
  AFTER INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.emit_sales_stage_event();

-- 2. Contacts: many per account. LinkedIn URL and email are the matching keys.
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  title text,
  persona text,
  email text,
  email_source text,
  email_check_result text,
  email_checked_at timestamptz,
  lookup_cost_usd numeric(10,4),
  linkedin_url text,
  phone text,
  whatsapp text,
  engaged boolean NOT NULL DEFAULT false,
  engaged_at timestamptz,
  never_email boolean NOT NULL DEFAULT false,
  dnc boolean NOT NULL DEFAULT false,
  dnc_at timestamptz,
  dnc_source text,
  dnc_reason text,
  drip_enrolled boolean NOT NULL DEFAULT false,
  drip_enrolled_at timestamptz,
  drip_track text,
  drip_paused_reason text,
  waalaxy_prospect_id text,
  apollo_contact_id text,
  linkedin_account text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON public.contacts (customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_linkedin ON public.contacts (lower(linkedin_url)) WHERE linkedin_url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_email ON public.contacts (lower(email)) WHERE email IS NOT NULL;

-- Do not contact on a contact: stop the drip, never email, stamp it, and only an admin can clear it.
CREATE OR REPLACE FUNCTION public.contacts_before_write()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.dnc THEN
    NEW.dnc_at := coalesce(NEW.dnc_at, now());
    NEW.never_email := true;
    IF NEW.drip_enrolled THEN
      NEW.drip_enrolled := false;
      NEW.drip_paused_reason := 'do not contact';
    END IF;
  END IF;
  IF NEW.drip_enrolled AND NEW.drip_enrolled_at IS NULL THEN NEW.drip_enrolled_at := now(); END IF;
  IF NEW.engaged AND NEW.engaged_at IS NULL THEN NEW.engaged_at := now(); END IF;
  IF TG_OP = 'UPDATE' AND OLD.dnc AND NOT NEW.dnc
     AND auth.uid() IS NOT NULL AND NOT coalesce(public.has_role(auth.uid(), 'admin'), false) THEN
    RAISE EXCEPTION 'Only an admin can clear do not contact';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contacts_before_write ON public.contacts;
CREATE TRIGGER trg_contacts_before_write
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_before_write();

-- Account set to do not contact: every contact there follows.
CREATE OR REPLACE FUNCTION public.customers_dnc_cascade()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.dnc AND (TG_OP = 'INSERT' OR NOT OLD.dnc) THEN
    UPDATE public.contacts
       SET dnc = true, dnc_source = coalesce(dnc_source, NEW.dnc_source, 'account'),
           dnc_reason = coalesce(dnc_reason, NEW.dnc_reason)
     WHERE customer_id = NEW.id AND NOT dnc;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customers_dnc_cascade ON public.customers;
CREATE TRIGGER trg_customers_dnc_cascade
  AFTER INSERT OR UPDATE OF dnc ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_dnc_cascade();

-- 3. Touches: every message in or out, on any channel. external_id makes syncs safe to repeat.
CREATE TABLE IF NOT EXISTS public.sales_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('linkedin','email','whatsapp','call','meeting','other')),
  direction text NOT NULL CHECK (direction IN ('out','in')),
  sender_account text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  subject text,
  body text,
  external_id text,
  auto_sent boolean NOT NULL DEFAULT false,
  is_drip boolean NOT NULL DEFAULT false,
  drip_issue text,
  opened_at timestamptz,
  replied_at timestamptz,
  variant text,
  test_name text,
  angle text,
  persona text,
  step integer,
  opener_type text,
  word_count integer,
  logged_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_touches_customer ON public.sales_touches (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_touches_contact ON public.sales_touches (contact_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_touches_external ON public.sales_touches (channel, external_id) WHERE external_id IS NOT NULL;

-- Outbound to a do-not-contact person or account is refused at the database, whatever sent it.
CREATE OR REPLACE FUNCTION public.sales_touches_before_insert()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE
  v_customer uuid := NEW.customer_id;
BEGIN
  IF NEW.contact_id IS NOT NULL AND v_customer IS NULL THEN
    SELECT customer_id INTO v_customer FROM public.contacts WHERE id = NEW.contact_id;
    NEW.customer_id := v_customer;
  END IF;
  IF NEW.direction = 'out' AND (
       EXISTS (SELECT 1 FROM public.contacts WHERE id = NEW.contact_id AND dnc)
    OR EXISTS (SELECT 1 FROM public.customers WHERE id = v_customer AND dnc)
    OR (NEW.channel = 'email' AND EXISTS (SELECT 1 FROM public.contacts WHERE id = NEW.contact_id AND never_email))
  ) THEN
    RAISE EXCEPTION 'Do not contact: outbound % touch refused', NEW.channel;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sales_touches_before_insert ON public.sales_touches;
CREATE TRIGGER trg_sales_touches_before_insert
  BEFORE INSERT ON public.sales_touches
  FOR EACH ROW EXECUTE FUNCTION public.sales_touches_before_insert();

CREATE OR REPLACE FUNCTION public.sales_touches_after_insert()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE public.customers
       SET last_contacted_at = greatest(coalesce(last_contacted_at, NEW.occurred_at), NEW.occurred_at)
     WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sales_touches_after_insert ON public.sales_touches;
CREATE TRIGGER trg_sales_touches_after_insert
  AFTER INSERT ON public.sales_touches
  FOR EACH ROW EXECUTE FUNCTION public.sales_touches_after_insert();

-- Sends a sender skipped because of do not contact.
CREATE TABLE IF NOT EXISTS public.send_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  channel text NOT NULL,
  sender text,
  reason text NOT NULL,
  blocked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_send_blocks_time ON public.send_blocks (blocked_at DESC);

-- 4. Job runs: one row each time a playbook job runs (watchdog, outreach, list building ...).
CREATE TABLE IF NOT EXISTS public.job_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job text NOT NULL,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','partial','failed','skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary text,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  credits jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_usd numeric(10,2),
  needs_review integer NOT NULL DEFAULT 0,
  run_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job_time ON public.job_runs (job, started_at DESC);

-- 5. Follow-ups stay ordinary tasks; these columns carry the nudge step and the drafted reply.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nudge_step integer,
  ADD COLUMN IF NOT EXISTS draft_text text,
  ADD COLUMN IF NOT EXISTS draft_channel text,
  ADD COLUMN IF NOT EXISTS draft_status text;

DO $$ BEGIN
  ALTER TABLE public.tasks ADD CONSTRAINT tasks_nudge_step_range CHECK (nudge_step IS NULL OR nudge_step BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.tasks ADD CONSTRAINT tasks_draft_status_values CHECK (draft_status IS NULL OR draft_status IN ('draft','approved','sent','skipped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. Inquiries remember which traction channel (and community) brought them.
ALTER TABLE public.customer_rfqs
  ADD COLUMN IF NOT EXISTS source_channel text,
  ADD COLUMN IF NOT EXISTS source_community text;

-- 7. Access: admin and team, like the rest of PD HQ.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','sales_touches','sales_stage_events','send_blocks','job_runs'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin/team manage %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Admin/team manage %s" ON public.%I FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()))', t, t);
  END LOOP;
END $$;
