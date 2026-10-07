CREATE OR REPLACE FUNCTION public.run_hq_task_automation(_event text, _assoc_type text, _assoc_id uuid, _label text, _vars jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; t jsonb; ttl text; dsc text; k text; due date;
BEGIN
  FOR r IN SELECT id, tasks FROM task_automation_rules WHERE trigger_event = _event AND active LOOP
    FOR t IN SELECT * FROM jsonb_array_elements(COALESCE(r.tasks, '[]'::jsonb)) LOOP
      ttl := t->>'title';
      IF ttl IS NULL OR btrim(ttl) = '' THEN CONTINUE; END IF;
      dsc := t->>'description';
      FOR k IN SELECT jsonb_object_keys(_vars) LOOP
        ttl := regexp_replace(ttl, '\{\{\s*' || k || '\s*\}\}', COALESCE(_vars->>k, ''), 'g');
        IF dsc IS NOT NULL THEN dsc := regexp_replace(dsc, '\{\{\s*' || k || '\s*\}\}', COALESCE(_vars->>k, ''), 'g'); END IF;
      END LOOP;
      due := CASE WHEN jsonb_typeof(t->'due_offset_days') = 'number' THEN current_date + (t->>'due_offset_days')::int ELSE NULL END;
      INSERT INTO tasks (title, description, assignee, priority, due_date, status, association_type, association_id, association_label, inquiry_id, customer_id, source_event)
      VALUES (left(btrim(regexp_replace(ttl, '\s{2,}', ' ', 'g')), 500), dsc, NULLIF(t->>'assignee', ''),
        CASE WHEN t->>'priority' IN ('low','normal','high','urgent') THEN t->>'priority' ELSE 'normal' END,
        due, 'open', _assoc_type, _assoc_id::text, _label,
        CASE WHEN _assoc_type = 'inquiry' THEN _assoc_id END,
        CASE WHEN _assoc_type = 'customer' THEN _assoc_id END,
        _event || ':' || r.id);
    END LOOP;
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.run_hq_task_automation(text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_inquiry_created_tasks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cname text;
BEGIN
  SELECT COALESCE(NULLIF(company, ''), name) INTO cname FROM customers WHERE id = NEW.customer_id;
  PERFORM run_hq_task_automation('inquiry_created', 'inquiry', NEW.id,
    concat_ws(' · ', NEW.rfq_number, NEW.title),
    jsonb_build_object('rfq_number', NEW.rfq_number, 'inquiry_title', COALESCE(NEW.title, ''), 'customer', COALESCE(cname, '')));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inquiry_created_tasks ON public.customer_rfqs;
CREATE TRIGGER inquiry_created_tasks AFTER INSERT ON public.customer_rfqs FOR EACH ROW EXECUTE FUNCTION public.trg_inquiry_created_tasks();

CREATE OR REPLACE FUNCTION public.trg_customer_lead_tasks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.lead_status = 'lead' AND (TG_OP = 'INSERT' OR OLD.lead_status IS DISTINCT FROM 'lead') THEN
    PERFORM run_hq_task_automation('customer_status_lead', 'customer', NEW.id,
      COALESCE(NULLIF(NEW.company, ''), NEW.name),
      jsonb_build_object('customer', COALESCE(NEW.name, ''), 'company', COALESCE(NEW.company, NEW.name, '')));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS customer_lead_tasks ON public.customers;
CREATE TRIGGER customer_lead_tasks AFTER INSERT OR UPDATE OF lead_status ON public.customers FOR EACH ROW EXECUTE FUNCTION public.trg_customer_lead_tasks();
REVOKE EXECUTE ON FUNCTION public.trg_inquiry_created_tasks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_customer_lead_tasks() FROM PUBLIC, anon, authenticated;