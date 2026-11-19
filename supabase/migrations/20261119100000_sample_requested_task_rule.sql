-- "Sample requested" task rules. Adds the database side of the new trigger event in
-- src/lib/task-automation.ts: when a sample request is created on an inquiry, every active
-- task_automation_rules row with trigger_event = 'sample_requested' adds its tasks to that inquiry.
-- Same pattern as inquiry_created (drizzle/migrations/0005_hq_task_automations.sql).
-- One request makes one set of tasks, however many products it has. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.trg_sample_requested_tasks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inq record; cname text;
BEGIN
  IF NEW.customer_rfq_id IS NULL THEN RETURN NEW; END IF;
  SELECT id, rfq_number, title, customer_id INTO inq FROM customer_rfqs WHERE id = NEW.customer_rfq_id;
  IF inq.id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(company, ''), name) INTO cname FROM customers WHERE id = inq.customer_id;
  PERFORM run_hq_task_automation('sample_requested', 'inquiry', inq.id,
    concat_ws(' · ', inq.rfq_number, inq.title),
    jsonb_build_object(
      'rfq_number', inq.rfq_number,
      'inquiry_title', COALESCE(inq.title, ''),
      'customer', COALESCE(cname, ''),
      'request_number', COALESCE(NEW.request_number, '')));
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sample_requested_tasks ON public.sample_requests;
CREATE TRIGGER sample_requested_tasks AFTER INSERT ON public.sample_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_sample_requested_tasks();
REVOKE EXECUTE ON FUNCTION public.trg_sample_requested_tasks() FROM PUBLIC, anon, authenticated;
