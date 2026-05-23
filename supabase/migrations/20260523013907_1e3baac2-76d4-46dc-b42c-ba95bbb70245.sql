ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS projections_sheet_id text,
  ADD COLUMN IF NOT EXISTS projections_sheet_tab_name text DEFAULT 'Projections';

CREATE TABLE IF NOT EXISTS public.projection_push_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by uuid,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  status_filter text[],
  starting_month date,
  months_count integer,
  rows_written integer,
  success boolean NOT NULL,
  error_message text
);

ALTER TABLE public.projection_push_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/team can view push log" ON public.projection_push_log;
CREATE POLICY "Admin/team can view push log"
  ON public.projection_push_log FOR SELECT TO authenticated
  USING (public.is_admin_or_team(auth.uid()));

DROP POLICY IF EXISTS "Admin/team can insert push log" ON public.projection_push_log;
CREATE POLICY "Admin/team can insert push log"
  ON public.projection_push_log FOR INSERT TO authenticated
  WITH CHECK (public.is_admin_or_team(auth.uid()));