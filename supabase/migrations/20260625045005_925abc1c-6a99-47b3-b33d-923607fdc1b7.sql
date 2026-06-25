ALTER TABLE public.customer_rfqs ADD COLUMN IF NOT EXISTS kanban_substage_override text NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_rfqs_kanban_substage_override_check') THEN
    ALTER TABLE public.customer_rfqs ADD CONSTRAINT customer_rfqs_kanban_substage_override_check CHECK (kanban_substage_override IN ('idea','costing','quoted','sampling') OR kanban_substage_override IS NULL);
  END IF;
END $$;