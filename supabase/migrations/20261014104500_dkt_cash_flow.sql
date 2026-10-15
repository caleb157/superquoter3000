-- DKT Cash Flow (Tools → DKT Cash Flow). DKT's own figures, typed in by hand and kept until
-- changed. DKT orders themselves are HQ inquiries whose selling entity is DKT: their DKT margin,
-- customer deposit % and advance % stay on inquiry_projections, so only DKT-side bookkeeping
-- (which payments already happened) lives here. Safe to run more than once.

-- 1. One settings row: current cash, minimum cash to keep, default DKT margin and the Allegro fund.
--    (The default advance % is Settings → Projections' inter-entity deposit %, shared with PV analytics.)
CREATE TABLE IF NOT EXISTS public.dkt_cash_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  cash_usd numeric NOT NULL DEFAULT 0,
  cash_as_of date,
  min_cash_usd numeric NOT NULL DEFAULT 5000,
  horizon_months integer NOT NULL DEFAULT 12,
  default_margin_pct numeric NOT NULL DEFAULT 0.05,
  allegro_balance_usd numeric NOT NULL DEFAULT 3200,
  allegro_as_of date DEFAULT CURRENT_DATE,
  allegro_monthly_usd numeric NOT NULL DEFAULT 500,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.dkt_cash_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Per order: which payments already happened, or leave the order out.
CREATE TABLE IF NOT EXISTS public.dkt_order_status (
  inquiry_id uuid PRIMARY KEY REFERENCES public.customer_rfqs(id) ON DELETE CASCADE,
  cust_deposit_done boolean NOT NULL DEFAULT false,
  advance_done boolean NOT NULL DEFAULT false,
  cust_balance_done boolean NOT NULL DEFAULT false,
  pv_balance_done boolean NOT NULL DEFAULT false,
  excluded boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Overhead, expenses and other income (monthly, quarterly, yearly or once).
CREATE TABLE IF NOT EXISTS public.dkt_cash_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'overhead' CHECK (kind IN ('overhead', 'expense', 'income')),
  amount_usd numeric NOT NULL DEFAULT 0,
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'yearly', 'once')),
  start_month date,
  end_month date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Loans: a payment schedule, or one lump sum paid in a month or with an order's balance.
CREATE TABLE IF NOT EXISTS public.dkt_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'lump' CHECK (kind IN ('schedule', 'lump')),
  balance_usd numeric NOT NULL DEFAULT 0,
  rate_pct numeric NOT NULL DEFAULT 0,
  due_month date,
  pay_with_inquiry_id uuid REFERENCES public.customer_rfqs(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.dkt_loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.dkt_loans(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  principal_usd numeric NOT NULL DEFAULT 0,
  interest_usd numeric NOT NULL DEFAULT 0,
  paid boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dkt_loan_payments_loan ON public.dkt_loan_payments (loan_id, due_date);

-- 5. Lines of credit and the draws/repayments planned on them (+ draw, − repay).
CREATE TABLE IF NOT EXISTS public.dkt_credit_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  limit_usd numeric NOT NULL DEFAULT 0,
  drawn_usd numeric NOT NULL DEFAULT 0,
  rate_pct numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.dkt_credit_draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL REFERENCES public.dkt_credit_lines(id) ON DELETE CASCADE,
  month date NOT NULL,
  amount_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Amazon: saved scenarios of SKUs. A scenario is in the DKT forecast or not, and is paid
--    for by DKT cash or by the Allegro fund.
CREATE TABLE IF NOT EXISTS public.dkt_amazon_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  notes text,
  in_forecast boolean NOT NULL DEFAULT false,
  funding text NOT NULL DEFAULT 'dkt' CHECK (funding IN ('dkt', 'allegro')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.dkt_amazon_skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES public.dkt_amazon_scenarios(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'inventory' CHECK (mode IN ('simple', 'inventory')),
  price_usd numeric NOT NULL DEFAULT 0,
  net_margin_pct numeric NOT NULL DEFAULT 0.2,
  units_per_month numeric NOT NULL DEFAULT 0,
  start_month date,
  unit_cost_usd numeric NOT NULL DEFAULT 0,
  freight_per_unit_usd numeric NOT NULL DEFAULT 0,
  order_qty integer NOT NULL DEFAULT 0,
  reorder_months numeric NOT NULL DEFAULT 4,
  make_months integer NOT NULL DEFAULT 2,
  ship_months integer NOT NULL DEFAULT 2,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Access: admin/team, like the rest of HQ.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dkt_cash_settings','dkt_order_status','dkt_cash_items','dkt_loans','dkt_loan_payments',
                           'dkt_credit_lines','dkt_credit_draws','dkt_amazon_scenarios','dkt_amazon_skus'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin/team manage %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Admin/team manage %s" ON public.%I FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()))', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['dkt_cash_settings','dkt_order_status','dkt_cash_items','dkt_loans','dkt_credit_lines',
                           'dkt_amazon_scenarios','dkt_amazon_skus'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;

-- 7. Starting data (only added once, matched by name).
--    ORG loan: the two tranches from the ORG schedule, remaining payments from Nov 2026 (7.5%).
DO $$
DECLARE l1 uuid; l2 uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.dkt_loans WHERE name = 'ORG loan (tranche 1)') THEN
    INSERT INTO public.dkt_loans (name, kind, balance_usd, rate_pct, notes)
    VALUES ('ORG loan (tranche 1)', 'schedule', 20833.33, 7.5, 'Originally $25,000. Payments on the 10th of May and November.')
    RETURNING id INTO l1;
    INSERT INTO public.dkt_loan_payments (loan_id, due_date, principal_usd, interest_usd) VALUES
      (l1, '2026-11-10', 0, 787.67), (l1, '2027-05-10', 0, 774.83), (l1, '2027-11-10', 4166.67, 787.67),
      (l1, '2028-05-10', 4166.67, 623.29), (l1, '2028-11-10', 4166.67, 472.60), (l1, '2029-05-10', 4166.67, 309.93),
      (l1, '2029-11-10', 4166.65, 157.53);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.dkt_loans WHERE name = 'ORG loan (tranche 2)') THEN
    INSERT INTO public.dkt_loans (name, kind, balance_usd, rate_pct, notes)
    VALUES ('ORG loan (tranche 2)', 'schedule', 23000, 7.5, 'Payments on the 1st of May and November.')
    RETURNING id INTO l2;
    INSERT INTO public.dkt_loan_payments (loan_id, due_date, principal_usd, interest_usd) VALUES
      (l2, '2026-11-01', 0, 869.59), (l2, '2027-05-01', 0, 855.41), (l2, '2027-11-01', 3833.33, 869.59),
      (l2, '2028-05-01', 3833.33, 716.78), (l2, '2028-11-01', 3833.33, 579.73), (l2, '2029-05-01', 3833.33, 427.71),
      (l2, '2029-11-01', 3833.33, 289.86), (l2, '2030-05-01', 3833.35, 142.57);
  END IF;
END $$;

INSERT INTO public.dkt_loans (name, kind, balance_usd, notes)
SELECT v.name, 'lump', v.amount, v.notes
FROM (VALUES
  ('Steve Presswood', 5000::numeric, 'No set terms.'),
  ('Perriens', 8000::numeric, NULL),
  ('Caleb Q loan (107040)', 8000::numeric, 'Owed to ourselves. Plan to repay with the current large order''s final payment.'),
  ('Parker Hoye loan (107050)', 9985::numeric, 'Owed to ourselves. Plan to repay with the current large order''s final payment.')
) AS v(name, amount, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.dkt_loans l WHERE l.name = v.name);

INSERT INTO public.dkt_amazon_scenarios (name, in_forecast, funding, notes)
SELECT 'Current Amazon sales', true, 'dkt', 'What Amazon earns today. In the DKT forecast.'
WHERE NOT EXISTS (SELECT 1 FROM public.dkt_amazon_scenarios);
