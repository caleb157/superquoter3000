
CREATE TABLE IF NOT EXISTS public.inquiry_projections (
  inquiry_id uuid PRIMARY KEY REFERENCES public.customer_rfqs(id) ON DELETE CASCADE,
  selling_entity_id uuid REFERENCES public.company_entities(id),
  producing_entity_id uuid REFERENCES public.company_entities(id),
  repeat_order boolean DEFAULT false,
  shipping_method text CHECK (shipping_method IN ('air', 'sea', 'ground') OR shipping_method IS NULL),
  projected_fob_revenue_usd numeric,
  project_gpm numeric,
  certainty_override numeric,
  estimated_man_hours numeric,
  inter_entity_markup_pct numeric,
  start_month date,
  shipping_month date,
  delivery_month date,
  committed_days integer,
  actual_po_date date,
  actual_ready_date date,
  cust_deposit_pct numeric DEFAULT 0.30,
  cust_deposit_month date,
  cust_final_pct numeric DEFAULT 0.70,
  cust_final_month date,
  cust_other_pct numeric,
  cust_other_month date,
  ie_deposit_pct numeric DEFAULT 0.30,
  ie_deposit_month date,
  ie_balance_pct numeric DEFAULT 0.70,
  ie_balance_month date,
  vendor_deposit_pct numeric DEFAULT 0.30,
  vendor_deposit_month date,
  vendor_balance_pct numeric DEFAULT 0.70,
  vendor_balance_month date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ip_selling_entity ON public.inquiry_projections(selling_entity_id);
CREATE INDEX IF NOT EXISTS idx_ip_producing_entity ON public.inquiry_projections(producing_entity_id);
CREATE INDEX IF NOT EXISTS idx_ip_start_month ON public.inquiry_projections(start_month);
CREATE INDEX IF NOT EXISTS idx_ip_shipping_month ON public.inquiry_projections(shipping_month);

ALTER TABLE public.inquiry_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage inquiry projections"
  ON public.inquiry_projections FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));

CREATE TRIGGER trg_ip_updated_at
  BEFORE UPDATE ON public.inquiry_projections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.inquiry_projections (inquiry_id, projected_fob_revenue_usd, start_month, cust_deposit_pct, cust_final_pct)
SELECT
  id,
  po_total_value_usd,
  CASE WHEN po_received_date IS NOT NULL THEN date_trunc('month', po_received_date)::date END,
  COALESCE(payment_terms_deposit_pct, 30) / 100.0,
  1.0 - (COALESCE(payment_terms_deposit_pct, 30) / 100.0)
FROM public.customer_rfqs
WHERE status = 'po'
  AND po_total_value_usd IS NOT NULL
ON CONFLICT (inquiry_id) DO NOTHING;
