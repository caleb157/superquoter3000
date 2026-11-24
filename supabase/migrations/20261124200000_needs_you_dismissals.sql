-- Needs you: Done and Ignore.
-- One row per time Caleb (or a job) marks a Needs you item done or ignores it. The item stays hidden while the row is
-- active: not undone, its snooze date not reached, no new inbound message on the account after it, and (for account
-- items other than forgotten conversations) no stage move after it. The rules live in src/lib/sales/sales-core.ts
-- (isDismissalActive), shared with the connector, so the watchdog and Gmail sync see the same thing.

CREATE TABLE IF NOT EXISTS public.needs_you_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  -- 'forgotten' | 'qualified' | 'quiet' | 'back' for account items, 'task:<task id>' for a follow-up or due task
  item_key text NOT NULL,
  kind text NOT NULL,
  action text NOT NULL CHECK (action IN ('done', 'ignored')),
  note text,
  -- Ignored only: the item may show again from this date. Null = forever (until a new message arrives).
  until date,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  -- Done on a task closes it; this keeps what Undo puts back ({"status":"open","draft_status":"draft"}).
  task_prev jsonb,
  title text,
  detail text,
  actor text,
  dismissed_by uuid DEFAULT auth.uid(),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  undone_at timestamptz
);

CREATE INDEX IF NOT EXISTS needs_you_dismissals_live_idx ON public.needs_you_dismissals (customer_id, item_key) WHERE undone_at IS NULL;
CREATE INDEX IF NOT EXISTS needs_you_dismissals_recent_idx ON public.needs_you_dismissals (dismissed_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.needs_you_dismissals TO authenticated;
GRANT ALL ON public.needs_you_dismissals TO service_role;
ALTER TABLE public.needs_you_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team manage needs_you_dismissals" ON public.needs_you_dismissals;
CREATE POLICY "Admin/team manage needs_you_dismissals" ON public.needs_you_dismissals
  FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
