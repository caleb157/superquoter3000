-- One status per customer: the sales stage.
-- Before this, a customer had two statuses that could disagree (Lead status "Inactive" next to Sales stage
-- "Not a fit"). From here on sales_stage is the only one people and tools set. lead_status stays as a
-- read-only mirror the database keeps in step, because older code, imports and exports still read it.
--
-- STEP 1 (no data changes): the two maps and stage_unify_plan(), which shows what Step 2 will do.
--   Dry run: SELECT * FROM public.stage_unify_plan() WHERE changes ORDER BY rule, account;
-- STEP 2 (writes): backs every customer up into customer_stage_unify_backup, applies the plan, then
--   installs the triggers that keep the two in step. Undo SQL: see the end of this file.
-- Safe to run more than once: the backup keeps the first snapshot, the plan is a no-op once applied.

-- =====================================================================================
-- STEP 1
-- =====================================================================================

-- Keep both maps identical to LEAD_STATUS_FROM_STAGE / STAGE_FROM_LEAD_STATUS in src/lib/sales/sales-core.ts.
CREATE OR REPLACE FUNCTION public.lead_status_from_sales_stage(p_stage text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE p_stage
    WHEN 'queued' THEN 'prospect'
    WHEN 'in_outreach' THEN 'prospect'
    WHEN 'responded' THEN 'lead'
    WHEN 'in_conversation' THEN 'lead'
    WHEN 'inquiry' THEN 'active'
    WHEN 'customer' THEN 'won'
    WHEN 'not_now' THEN 'inactive'
    WHEN 'not_a_fit' THEN 'inactive'
    WHEN 'dnc' THEN 'inactive'
  END
$$;

CREATE OR REPLACE FUNCTION public.sales_stage_from_lead_status(p_status text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE lower(coalesce(p_status, ''))
    WHEN 'prospect' THEN 'queued'
    WHEN 'lead' THEN 'responded'
    WHEN 'active' THEN 'inquiry'
    WHEN 'won' THEN 'customer'
    WHEN 'inactive' THEN 'not_now'
    WHEN 'churned' THEN 'not_now'
    ELSE 'responded'
  END
$$;

-- What Step 2 does to each customer, and why (first rule that fits wins):
--   dnc          do not contact flag set                          -> Do not contact
--   placeholder  "Ops and Non Sales Tasks", "SALES DEV" rows       -> Not a fit (task holders, not companies)
--   exit kept    stage already Not a fit / Do not contact          -> unchanged (a deliberate call)
--   po           an inquiry at PO or Complete                       -> Customer (same as the inquiry hand-off trigger)
--   from lead    no stage yet                                       -> from lead status: Prospect=Queued, Lead=Responded,
--                                                                      Live inquiry=Inquiry, Customer=Customer,
--                                                                      Inactive/Churned=Not now until 24 May 2027
--   won          lead status Customer, stage an earlier pipeline step -> Customer (set by hand; the stage came from a bulk load)
--   stage kept   everything else                                    -> stage unchanged, lead status re-derived from it
-- check_me marks rows where the stage was kept but the old lead status said something different, for a look.
CREATE OR REPLACE FUNCTION public.stage_unify_plan()
 RETURNS TABLE (
   customer_id uuid, account text, lead_status text, sales_stage text, new_stage text,
   not_now_until date, new_not_now_until date, new_lead_status text, rule text, changes boolean, check_me boolean
 )
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  WITH inq AS (
    SELECT r.customer_id, bool_or(r.status IN ('po','complete')) AS has_po
      FROM public.customer_rfqs r WHERE r.customer_id IS NOT NULL GROUP BY r.customer_id
  ), ruled AS (
    SELECT c.id, coalesce(nullif(c.company, ''), c.name) AS account, c.lead_status, c.sales_stage, c.not_now_until,
      CASE
        WHEN c.dnc THEN 'dnc'
        WHEN coalesce(nullif(c.company, ''), c.name) IN ('Ops and Non Sales Tasks', 'SALES DEV') THEN 'placeholder'
        WHEN c.sales_stage IN ('not_a_fit', 'dnc') THEN 'exit kept'
        WHEN coalesce(i.has_po, false) AND c.sales_stage IS DISTINCT FROM 'customer' THEN 'po'
        WHEN c.sales_stage IS NULL THEN 'from lead'
        WHEN c.lead_status = 'won' AND c.sales_stage IN ('queued','in_outreach','responded','in_conversation','inquiry') THEN 'won'
        ELSE 'stage kept'
      END AS rule
    FROM public.customers c LEFT JOIN inq i ON i.customer_id = c.id
  ), staged AS (
    SELECT r.*,
      CASE r.rule
        WHEN 'dnc' THEN 'dnc'
        WHEN 'placeholder' THEN 'not_a_fit'
        WHEN 'exit kept' THEN r.sales_stage
        WHEN 'po' THEN 'customer'
        WHEN 'from lead' THEN public.sales_stage_from_lead_status(r.lead_status)
        WHEN 'won' THEN 'customer'
        ELSE r.sales_stage
      END AS new_stage
    FROM ruled r
  )
  SELECT s.id, s.account, s.lead_status, s.sales_stage, s.new_stage,
    s.not_now_until,
    CASE WHEN s.new_stage = 'not_now' THEN coalesce(s.not_now_until, DATE '2027-05-24') END,
    public.lead_status_from_sales_stage(s.new_stage),
    s.rule,
    (s.sales_stage IS DISTINCT FROM s.new_stage
      OR s.lead_status IS DISTINCT FROM public.lead_status_from_sales_stage(s.new_stage)
      OR s.not_now_until IS DISTINCT FROM CASE WHEN s.new_stage = 'not_now' THEN coalesce(s.not_now_until, DATE '2027-05-24') END),
    (s.rule IN ('stage kept', 'exit kept') AND s.lead_status IS DISTINCT FROM public.lead_status_from_sales_stage(s.new_stage)
      AND NOT (s.lead_status = 'prospect' AND s.new_stage IN ('queued','in_outreach','responded','in_conversation','not_now','not_a_fit'))
      AND NOT (s.lead_status = 'inactive' AND s.new_stage IN ('not_now','not_a_fit','dnc')))
  FROM staged s
$$;

-- =====================================================================================
-- STEP 2
-- =====================================================================================

-- Reversible record: every customer's old values, taken once (a re-run keeps the first snapshot).
CREATE TABLE IF NOT EXISTS public.customer_stage_unify_backup (
  customer_id uuid PRIMARY KEY,
  account text,
  lead_status text,
  sales_stage text,
  not_now_until date,
  sales_stage_changed_at timestamptz,
  new_stage text,
  rule text,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz
);
ALTER TABLE public.customer_stage_unify_backup ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team read stage unify backup" ON public.customer_stage_unify_backup;
CREATE POLICY "Admin/team read stage unify backup" ON public.customer_stage_unify_backup
  FOR SELECT TO authenticated USING (public.is_admin_or_team(auth.uid()));
GRANT SELECT ON public.customer_stage_unify_backup TO authenticated;
GRANT ALL ON public.customer_stage_unify_backup TO service_role;

INSERT INTO public.customer_stage_unify_backup (customer_id, account, lead_status, sales_stage, not_now_until, sales_stage_changed_at, new_stage, rule)
SELECT c.id, p.account, c.lead_status, c.sales_stage, c.not_now_until, c.sales_stage_changed_at, p.new_stage, p.rule
  FROM public.customers c JOIN public.stage_unify_plan() p ON p.customer_id = c.id
ON CONFLICT (customer_id) DO NOTHING;

-- Stage moves log who moved them: app.actor / app.reason (set by bulk jobs like this one) win over the signed-in email.
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
      coalesce(nullif(current_setting('app.actor', true), ''), current_setting('request.jwt.claim.email', true), 'system'),
      coalesce(nullif(current_setting('app.reason', true), ''), CASE WHEN NEW.sales_stage = 'dnc' THEN coalesce(NEW.dnc_reason, 'do not contact') END)
    );
  END IF;
  RETURN NEW;
END $$;

-- The one stage rule on customers, now also keeping lead_status in step:
--   * a new customer with no stage gets one from its lead status (older code and imports still send lead_status);
--   * an update that changes only lead_status (older code) moves the stage to match, unless the stage already maps to it;
--   * stage Do not contact and the dnc flag always agree;
--   * lead_status is then always rewritten from the stage, so the two can never disagree.
CREATE OR REPLACE FUNCTION public.validate_customer_sales_stage()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.sales_stage IS NULL THEN
    NEW.sales_stage := public.sales_stage_from_lead_status(NEW.lead_status);
  ELSIF TG_OP = 'UPDATE' AND NEW.sales_stage IS NOT DISTINCT FROM OLD.sales_stage
        AND NEW.lead_status IS DISTINCT FROM OLD.lead_status
        AND NEW.lead_status IS DISTINCT FROM public.lead_status_from_sales_stage(OLD.sales_stage) THEN
    NEW.sales_stage := public.sales_stage_from_lead_status(NEW.lead_status);
  END IF;
  IF NEW.sales_stage IS NULL THEN
    NEW.sales_stage := coalesce(public.sales_stage_from_lead_status(NEW.lead_status), 'responded');
  END IF;
  -- Older paths that park a customer give no date: about 6 months out, like the app's Not now.
  IF NEW.sales_stage = 'not_now' AND NEW.not_now_until IS NULL
     AND (TG_OP = 'INSERT' OR OLD.sales_stage IS DISTINCT FROM 'not_now' OR NEW.lead_status IS DISTINCT FROM OLD.lead_status) THEN
    NEW.not_now_until := (now() AT TIME ZONE 'Asia/Kolkata')::date + 182;
  END IF;
  IF NEW.sales_stage NOT IN
     ('queued','in_outreach','responded','in_conversation','inquiry','customer','not_now','not_a_fit','dnc') THEN
    RAISE EXCEPTION 'Invalid sales_stage: %', NEW.sales_stage;
  END IF;
  IF NEW.sales_stage = 'not_now' AND NEW.not_now_until IS NULL THEN
    RAISE EXCEPTION 'Not now needs a follow-up date (not_now_until)';
  END IF;
  IF NEW.fit_score IS NOT NULL AND (NEW.fit_score < 0 OR NEW.fit_score > 100) THEN
    RAISE EXCEPTION 'fit_score must be 0 to 100';
  END IF;
  -- Only an admin can take an account off do not contact.
  IF TG_OP = 'UPDATE' AND OLD.dnc AND NOT NEW.dnc
     AND auth.uid() IS NOT NULL AND NOT coalesce(public.has_role(auth.uid(), 'admin'), false) THEN
    RAISE EXCEPTION 'Only an admin can clear do not contact';
  END IF;
  -- Stage Do not contact and the flag always agree: setting either sets both; clearing the flag leaves Not a fit.
  IF NEW.sales_stage = 'dnc' AND NOT NEW.dnc AND (TG_OP = 'INSERT' OR NOT OLD.dnc) THEN
    NEW.dnc := true;
  END IF;
  IF NEW.dnc THEN
    NEW.sales_stage := 'dnc';
    NEW.dnc_at := coalesce(NEW.dnc_at, now());
  ELSIF NEW.sales_stage = 'dnc' THEN
    NEW.sales_stage := 'not_a_fit';
  END IF;
  IF NEW.sales_stage <> 'not_now' THEN
    NEW.not_now_until := NULL;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.sales_stage IS DISTINCT FROM OLD.sales_stage THEN
    NEW.sales_stage_changed_at := now();
  END IF;
  NEW.lead_status := public.lead_status_from_sales_stage(NEW.sales_stage);
  RETURN NEW;
END $$;

-- lead_status is now written by the trigger above, so "UPDATE OF lead_status" triggers would miss most changes.
-- Fire them on any update instead (their functions already skip rows where lead_status did not change).
DO $$
BEGIN
  IF to_regprocedure('public.emit_customer_status_event()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_emit_customer_status_event ON public.customers';
    EXECUTE 'CREATE TRIGGER trg_emit_customer_status_event AFTER INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.emit_customer_status_event()';
  END IF;
  IF to_regprocedure('public.emit_customer_lifecycle_event()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_emit_customer_lifecycle_event ON public.customers';
    EXECUTE 'CREATE TRIGGER trg_emit_customer_lifecycle_event AFTER INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.emit_customer_lifecycle_event()';
  END IF;
  -- Same for the do not contact cascade: the flag is now also set by the stage rule, so fire on any update
  -- (the function only acts when dnc turns on).
  IF to_regprocedure('public.customers_dnc_cascade()') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_customers_dnc_cascade ON public.customers';
    EXECUTE 'CREATE TRIGGER trg_customers_dnc_cascade AFTER INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.customers_dnc_cascade()';
  END IF;
  -- "Customer becomes a lead" task rules: fire when an account reaches Responded or In conversation as a new
  -- customer or from Queued, In outreach, Not now or Not a fit. Skipped while app.stage_sync is on, so this
  -- one-off clean-up never creates tasks.
  IF to_regprocedure('public.trg_customer_lead_tasks()') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION public.trg_customer_lead_tasks()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $b$
      BEGIN
        IF coalesce(current_setting('app.stage_sync', true), '') = 'on' THEN RETURN NEW; END IF;
        -- New, or coming from Prospect / Not now / Not a fit. Falling back from an inquiry or a customer is not a new lead.
        IF NEW.lead_status = 'lead' AND (TG_OP = 'INSERT' OR OLD.lead_status NOT IN ('lead','active','won')) THEN
          PERFORM run_hq_task_automation('customer_status_lead', 'customer', NEW.id,
            COALESCE(NULLIF(NEW.company, ''), NEW.name),
            jsonb_build_object('customer', COALESCE(NEW.name, ''), 'company', COALESCE(NEW.company, NEW.name, '')));
        END IF;
        RETURN NEW;
      END $b$
    $f$;
    EXECUTE 'DROP TRIGGER IF EXISTS customer_lead_tasks ON public.customers';
    EXECUTE 'CREATE TRIGGER customer_lead_tasks AFTER INSERT OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.trg_customer_lead_tasks()';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.trg_customer_lead_tasks() FROM PUBLIC, anon, authenticated';
  END IF;
END $$;

-- Inquiry hand-off now covers every account (all have a stage) and one more case: when an account's last open
-- inquiry is cancelled and it has no PO, it goes back to In conversation instead of sitting on Inquiry.
CREATE OR REPLACE FUNCTION public.customer_rfqs_sales_handoff()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE v_stage text;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  SELECT sales_stage INTO v_stage FROM public.customers WHERE id = NEW.customer_id;
  IF v_stage IS NULL OR v_stage IN ('dnc','not_a_fit') THEN RETURN NEW; END IF;
  IF NEW.status IN ('po','complete') AND v_stage <> 'customer' THEN
    PERFORM set_config('app.reason', 'Inquiry ' || coalesce(NEW.rfq_number, '') || ' reached ' || NEW.status, true);
    UPDATE public.customers SET sales_stage = 'customer', not_now_until = NULL WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'INSERT' AND v_stage IN ('queued','in_outreach','responded','in_conversation','not_now') THEN
    PERFORM set_config('app.reason', 'Inquiry ' || coalesce(NEW.rfq_number, '') || ' created', true);
    UPDATE public.customers SET sales_stage = 'inquiry', not_now_until = NULL WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' AND v_stage = 'inquiry'
        AND NOT EXISTS (SELECT 1 FROM public.customer_rfqs r WHERE r.customer_id = NEW.customer_id AND r.id <> NEW.id
                          AND r.status IN ('active','paused','projected_po','po','complete')) THEN
    PERFORM set_config('app.reason', 'Inquiry ' || coalesce(NEW.rfq_number, '') || ' cancelled, no other open inquiry', true);
    UPDATE public.customers SET sales_stage = 'in_conversation' WHERE id = NEW.customer_id;
  END IF;
  PERFORM set_config('app.reason', '', true);
  RETURN NEW;
END $$;

-- Apply the plan. Bulk-load actor, so the Command center keeps these moves out of the week's funnel arrows.
SELECT set_config('app.stage_sync', 'on', false), set_config('app.actor', 'stage-sync (lead status merge)', false);
UPDATE public.customers c
   SET sales_stage = p.new_stage, not_now_until = p.new_not_now_until
  FROM public.stage_unify_plan() p
 WHERE p.customer_id = c.id AND p.changes;
-- Write each move's rule as its reason.
UPDATE public.sales_stage_events e
   SET reason = 'Lead status merge: ' || b.rule || ' (lead status was ' || coalesce(b.lead_status, 'none') || ')'
  FROM public.customer_stage_unify_backup b
 WHERE e.customer_id = b.customer_id AND e.actor = 'stage-sync (lead status merge)' AND e.reason IS NULL;
SELECT set_config('app.stage_sync', '', false), set_config('app.actor', '', false);

-- Every customer has a stage from here on.
ALTER TABLE public.customers ALTER COLUMN sales_stage SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_sales_stage_all ON public.customers (sales_stage);

-- =====================================================================================
-- UNDO (only if needed; not run by this migration). Puts every customer's stage, date and lead status back
-- as they were before Step 2. The triggers stay; lead_status will again follow the restored stage.
--
--   ALTER TABLE public.customers ALTER COLUMN sales_stage DROP NOT NULL;
--   SELECT set_config('app.stage_sync', 'on', false), set_config('app.actor', 'stage-sync undo', false);
--   ALTER TABLE public.customers DISABLE TRIGGER trg_validate_customer_sales_stage;
--   UPDATE public.customers c SET sales_stage = b.sales_stage, not_now_until = b.not_now_until,
--          lead_status = b.lead_status, sales_stage_changed_at = b.sales_stage_changed_at
--     FROM public.customer_stage_unify_backup b WHERE b.customer_id = c.id;
--   ALTER TABLE public.customers ENABLE TRIGGER trg_validate_customer_sales_stage;
--   UPDATE public.customer_stage_unify_backup SET restored_at = now();
--   SELECT set_config('app.stage_sync', '', false), set_config('app.actor', '', false);
-- =====================================================================================
