-- Manual cash-flow entries: one-off or spread income/expense lines typed under the cash flow chart,
-- on PV's analytics dashboard (scope 'pv') and on DKT Cash Flow (scope 'dkt').
-- With only a date the whole amount lands in that month; with an end date it is split evenly
-- across every month from the date's month to the end date's month. Safe to run more than once.
CREATE TABLE IF NOT EXISTS public.cash_flow_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'pv' CHECK (scope IN ('pv', 'dkt')),
  name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'expense' CHECK (kind IN ('income', 'expense')),
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'INR')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_flow_manual_entries_scope ON public.cash_flow_manual_entries (scope, start_date);

ALTER TABLE public.cash_flow_manual_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team manage cash_flow_manual_entries" ON public.cash_flow_manual_entries;
CREATE POLICY "Admin/team manage cash_flow_manual_entries" ON public.cash_flow_manual_entries
  FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
