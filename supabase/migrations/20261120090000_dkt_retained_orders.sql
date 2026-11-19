-- DKT Cash Flow → Orders → Retained orders: a what-if list of orders DKT expects to keep getting
-- (CCT's quarterly container and last year's other customers again). Not HQ inquiries, not Odoo.
-- Every row starts unticked (counted = false), so the forecast doesn't change until rows are ticked.
-- Safe to run more than once: the starting list is added only while the table is empty.
CREATE TABLE IF NOT EXISTS public.dkt_retained_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  customer text,
  fob_usd numeric NOT NULL DEFAULT 0,
  margin_pct numeric NOT NULL DEFAULT 0.10,
  cust_deposit_pct numeric NOT NULL DEFAULT 0.30,
  advance_pct numeric NOT NULL DEFAULT 0.50,
  po_month date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE),
  ship_month date NOT NULL DEFAULT date_trunc('month', CURRENT_DATE) + interval '3 months',
  cust_lag_months integer NOT NULL DEFAULT 0 CHECK (cust_lag_months BETWEEN 0 AND 12),
  counted boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Access: admin/team, like the other DKT tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dkt_retained_orders TO authenticated;
GRANT ALL ON public.dkt_retained_orders TO service_role;
ALTER TABLE public.dkt_retained_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team manage dkt_retained_orders" ON public.dkt_retained_orders;
CREATE POLICY "Admin/team manage dkt_retained_orders" ON public.dkt_retained_orders
  FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));

-- Starting list (2026-11-19): CCT's container every quarter at 10%, no deposit, paid the month after
-- shipping; last year's other DKT customers in the same month a year on, at 10%, 30% deposit, 50% advance.
INSERT INTO public.dkt_retained_orders (name, customer, fob_usd, margin_pct, cust_deposit_pct, advance_pct, po_month, ship_month, cust_lag_months, sort)
SELECT * FROM (VALUES
    ('CCT container 2', 'Carolina Chair and Table', 33404, 0.1, 0, 0.5, DATE '2027-03-01', DATE '2027-06-01', 1, 0),
    ('CCT container 3', 'Carolina Chair and Table', 33404, 0.1, 0, 0.5, DATE '2027-06-01', DATE '2027-09-01', 1, 1),
    ('CCT container 4', 'Carolina Chair and Table', 33404, 0.1, 0, 0.5, DATE '2027-09-01', DATE '2027-12-01', 1, 2),
    ('CCT container 5', 'Carolina Chair and Table', 33404, 0.1, 0, 0.5, DATE '2027-12-01', DATE '2028-03-01', 1, 3),
    ('Repeat Hypernikao', 'Hypernikao', 6270, 0.1, 0.3, 0.5, DATE '2026-11-01', DATE '2027-01-01', 0, 4),
    ('Repeat Sooie Investments', 'Sooie Investments', 1890, 0.1, 0.3, 0.5, DATE '2026-11-01', DATE '2027-01-01', 0, 5),
    ('Repeat Sooie Investments', 'Sooie Investments', 4658, 0.1, 0.3, 0.5, DATE '2026-12-01', DATE '2027-02-01', 0, 6),
    ('Repeat Circa Loft', 'Circa Loft', 89, 0.1, 0.3, 0.5, DATE '2026-12-01', DATE '2027-02-01', 0, 7),
    ('Repeat Highridge', 'Highridge', 2484, 0.1, 0.3, 0.5, DATE '2027-04-01', DATE '2027-06-01', 0, 8),
    ('Repeat Hypernikao', 'Hypernikao', 850, 0.1, 0.3, 0.5, DATE '2027-04-01', DATE '2027-06-01', 0, 9),
    ('Repeat Hypernikao', 'Hypernikao', 5200, 0.1, 0.3, 0.5, DATE '2027-05-01', DATE '2027-07-01', 0, 10),
    ('Repeat Olive Ateliers', 'Olive Ateliers', 252, 0.1, 0.3, 0.5, DATE '2027-05-01', DATE '2027-07-01', 0, 11),
    ('Repeat Hypernikao', 'Hypernikao', 3102, 0.1, 0.3, 0.5, DATE '2027-06-01', DATE '2027-08-01', 0, 12),
    ('Repeat Joffa', 'Joffa', 4024, 0.1, 0.3, 0.5, DATE '2027-07-01', DATE '2027-09-01', 0, 13),
    ('Repeat Kurinam', 'Kurinam', 4387, 0.1, 0.3, 0.5, DATE '2027-07-01', DATE '2027-09-01', 0, 14),
    ('Repeat Open Door Presbyterian', 'Open Door Presbyterian', 3344, 0.1, 0.3, 0.5, DATE '2027-07-01', DATE '2027-09-01', 0, 15),
    ('Repeat Highridge', 'Highridge', 3245, 0.1, 0.3, 0.5, DATE '2027-08-01', DATE '2027-10-01', 0, 16),
    ('Repeat Hypernikao', 'Hypernikao', 13286, 0.1, 0.3, 0.5, DATE '2027-08-01', DATE '2027-10-01', 0, 17),
    ('Repeat Big Chicken', 'Big Chicken', 250, 0.1, 0.3, 0.5, DATE '2027-10-01', DATE '2027-12-01', 0, 18),
    ('Repeat Luxe Designs', 'Luxe Designs', 2097, 0.1, 0.3, 0.5, DATE '2027-10-01', DATE '2027-12-01', 0, 19),
    ('Repeat Sooie Investments', 'Sooie Investments', 2490, 0.1, 0.3, 0.5, DATE '2027-10-01', DATE '2027-12-01', 0, 20)
) AS seed(name, customer, fob_usd, margin_pct, cust_deposit_pct, advance_pct, po_month, ship_month, cust_lag_months, sort)
WHERE NOT EXISTS (SELECT 1 FROM public.dkt_retained_orders);
