CREATE TABLE public.analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  synced_by uuid,
  status text NOT NULL DEFAULT 'ok',
  error_message text,
  duration_ms integer
);
GRANT SELECT ON public.analytics_snapshots TO authenticated;
GRANT ALL ON public.analytics_snapshots TO service_role;
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/team read snapshots" ON public.analytics_snapshots FOR SELECT TO authenticated USING (public.is_admin_or_team(auth.uid()));
CREATE INDEX analytics_snapshots_synced_idx ON public.analytics_snapshots (synced_at DESC);

CREATE TABLE public.customer_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_logged date NOT NULL DEFAULT CURRENT_DATE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name_manual text,
  issue_summary text NOT NULL,
  potential_resolution text,
  google_drive_url text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  date_closed date,
  actions_captured boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_complaints TO authenticated;
GRANT ALL ON public.customer_complaints TO service_role;
ALTER TABLE public.customer_complaints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/team manage complaints" ON public.customer_complaints FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
CREATE TRIGGER customer_complaints_updated BEFORE UPDATE ON public.customer_complaints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS overhead_avg_months integer NOT NULL DEFAULT 3;
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS opening_cash_inr numeric NOT NULL DEFAULT 0;