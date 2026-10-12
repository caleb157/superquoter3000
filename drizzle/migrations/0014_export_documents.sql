CREATE TABLE IF NOT EXISTS public.customs_exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency text NOT NULL DEFAULT 'USD',
  rate numeric NOT NULL CHECK (rate > 0),
  notification_no text,
  effective_from date NOT NULL DEFAULT current_date,
  source_url text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customs_exchange_rates_currency_from_idx
  ON public.customs_exchange_rates (currency, effective_from DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.export_packing_profiles (
  sku text PRIMARY KEY,
  units_per_package numeric,
  package_dims_in text,
  package_kind text,
  net_weight_kg numeric,
  gross_weight_kg numeric,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.export_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL,
  odoo_invoice_id integer,
  entity_id uuid REFERENCES public.company_entities(id) ON DELETE SET NULL,
  exchange_rate numeric,
  notification_no text,
  total_usd numeric,
  payload jsonb NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS export_documents_invoice_idx ON public.export_documents (invoice_no, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customs_exchange_rates', 'export_packing_profiles', 'export_documents'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin/team manage %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Admin/team manage %s" ON public.%I FOR ALL TO authenticated '
                   'USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()))', t, t);
  END LOOP;
END $$;