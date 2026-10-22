ALTER TABLE public.tasks ALTER COLUMN due_date SET DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata')::date);
CREATE OR REPLACE FUNCTION public.ensure_task_due_date() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Legacy automation templates with no offset are due on the event day.
  IF NEW.due_date IS NULL AND NEW.source_event IS NOT NULL AND TG_OP = 'INSERT' THEN
    NEW.due_date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;
  IF NEW.due_date IS NULL THEN
    RAISE EXCEPTION 'Due date is required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tasks_require_due_date BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.ensure_task_due_date();
ALTER TABLE public.tasks ADD CONSTRAINT tasks_due_date_required CHECK (due_date IS NOT NULL);
COMMENT ON COLUMN public.tasks.due_date IS 'Required for every task; automation templates with no offset default to the event date in Asia/Kolkata.';