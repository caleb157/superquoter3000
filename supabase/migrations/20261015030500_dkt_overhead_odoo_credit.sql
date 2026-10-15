-- DKT Cash Flow follow-up. Safe to run more than once; each step only adds what is missing.

-- 1. Overhead is one monthly figure charged in every month, not a list of lines. When the column
--    is first added it takes the total of the existing monthly overhead lines still running this
--    month, and those overhead lines are then removed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dkt_cash_settings' AND column_name = 'monthly_overhead_usd'
  ) THEN
    ALTER TABLE public.dkt_cash_settings ADD COLUMN monthly_overhead_usd numeric NOT NULL DEFAULT 0;
    UPDATE public.dkt_cash_settings SET monthly_overhead_usd = COALESCE((
      SELECT sum(amount_usd) FROM public.dkt_cash_items
      WHERE kind = 'overhead' AND frequency = 'monthly'
        AND (start_month IS NULL OR start_month <= date_trunc('month', CURRENT_DATE))
        AND (end_month IS NULL OR end_month >= date_trunc('month', CURRENT_DATE))
    ), 0) WHERE id = 1;
    DELETE FROM public.dkt_cash_items WHERE kind = 'overhead';
  END IF;
END $$;

-- 2. DKT's terms on confirmed PV → DKT sales orders read live from Odoo (the orders themselves are
--    not copied): DKT margin, customer deposit %, ship month and which customer payments arrived.
CREATE TABLE IF NOT EXISTS public.dkt_odoo_order_terms (
  so_name text PRIMARY KEY,
  margin_pct numeric,
  cust_deposit_pct numeric,
  ship_month date,
  cust_deposit_done boolean NOT NULL DEFAULT false,
  cust_balance_done boolean NOT NULL DEFAULT false,
  excluded boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dkt_odoo_order_terms TO authenticated;
GRANT ALL ON public.dkt_odoo_order_terms TO service_role;
ALTER TABLE public.dkt_odoo_order_terms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team manage dkt_odoo_order_terms" ON public.dkt_odoo_order_terms;
CREATE POLICY "Admin/team manage dkt_odoo_order_terms" ON public.dkt_odoo_order_terms FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
DROP TRIGGER IF EXISTS trg_dkt_odoo_order_terms_updated_at ON public.dkt_odoo_order_terms;
CREATE TRIGGER trg_dkt_odoo_order_terms_updated_at BEFORE UPDATE ON public.dkt_odoo_order_terms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. A lump loan can be repaid with an Odoo sales order's final customer payment.
ALTER TABLE public.dkt_loans ADD COLUMN IF NOT EXISTS pay_with_so text;

-- 4. A credit line can have a maturity month, when everything drawn is repaid in full.
ALTER TABLE public.dkt_credit_lines ADD COLUMN IF NOT EXISTS maturity_month date;

-- 5. Credit lines Caleb has (nothing drawn yet). Rates are the yearly cost of a full draw from
--    each offer: Fundbox $16,000 over 52 weeks, Amex $15,300 in 6-month draws, OnDeck $12,000 over 12 months.
INSERT INTO public.dkt_credit_lines (name, limit_usd, drawn_usd, rate_pct, notes)
SELECT v.name, v.limit_usd, 0, v.rate, v.notes
FROM (VALUES
  ('Fundbox', 16000::numeric, 28.6::numeric, '52-week draws, weekly payments ($392.62/wk on a full $16,000 draw).'),
  ('Amex', 15300::numeric, 6.6::numeric, 'Business loan, 6-month draws ($504.90 fees on $15,300).'),
  ('OnDeck', 12000::numeric, 44.3::numeric, '12-month draws.')
) AS v(name, limit_usd, rate, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.dkt_credit_lines c WHERE lower(c.name) = lower(v.name));

--    Sooie Investments: revolving, $20,000 at 5% simple, unsecured, from 15 Sep 2026. $10,000 is
--    drawn; everything drawn plus interest is due in one payment on 15 Mar 2027.
INSERT INTO public.dkt_credit_lines (name, limit_usd, drawn_usd, rate_pct, maturity_month, notes)
SELECT 'Sooie Investments', 20000, 10000, 5, '2027-03-01',
  'Revolving, unsecured, 5% simple interest on what is drawn. All principal and interest due 15 Mar 2027; can prepay any time.'
WHERE NOT EXISTS (SELECT 1 FROM public.dkt_credit_lines c WHERE c.name ILIKE 'sooie%');

-- 6. Starting cash: $5,500 in the bank on 15 Oct 2026 (only if no balance has been typed yet).
UPDATE public.dkt_cash_settings SET cash_usd = 5500, cash_as_of = '2026-10-15'
WHERE id = 1 AND cash_usd = 0;
