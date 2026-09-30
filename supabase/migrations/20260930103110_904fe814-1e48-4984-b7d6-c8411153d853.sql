
CREATE TABLE public.fq_vendors (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, type text NOT NULL DEFAULT 'forwarder', notes text, owner_id uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.fq_customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, notes text, owner_id uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.fq_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, category text, notes text, owner_id uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.fq_fx_rates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), currency text NOT NULL, rate_to_usd numeric NOT NULL, effective_date date NOT NULL DEFAULT current_date, owner_id uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.fq_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), default_wm_kg_per_cbm numeric NOT NULL DEFAULT 1000, keyword_map jsonb NOT NULL DEFAULT '[]'::jsonb, owner_id uuid DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.fq_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES public.fq_vendors(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.fq_customers(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.fq_products(id) ON DELETE SET NULL,
  quote_date date, valid_until date, reference_no text,
  direction text NOT NULL DEFAULT 'export',
  origin_city text, origin_port text, destination_city text, destination_port text, destination_country text,
  mode text NOT NULL DEFAULT 'LCL', container_size text,
  cbm numeric, gross_weight_kg numeric, pallet_count numeric,
  wm_kg_per_cbm numeric NOT NULL DEFAULT 1000, chargeable_wm numeric,
  declared_invoice_value_usd numeric, duty_estimate_usd numeric, insurance_usd numeric,
  fx_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'received',
  notes text, source_file_path text, raw_text text,
  fob_usd numeric, cif_usd numeric, ddp_usd numeric, has_unpriced boolean NOT NULL DEFAULT false,
  owner_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.fq_quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.fq_quotes(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  raw_label text, normalized_name text,
  bucket text NOT NULL DEFAULT 'OTHER', charge_basis text NOT NULL DEFAULT 'flat',
  rate numeric, currency text NOT NULL DEFAULT 'USD', minimum_amount numeric, quantity_override numeric,
  applicable boolean NOT NULL DEFAULT true, applicable_reason text,
  is_optional boolean NOT NULL DEFAULT false, optional_included boolean NOT NULL DEFAULT true,
  user_estimate numeric, amount_original numeric, amount_usd numeric,
  owner_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.fq_quote_lines(quote_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fq_vendors','fq_customers','fq_products','fq_fx_rates','fq_settings','fq_quotes','fq_quote_lines'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Admin/team manage %s" ON public.%I FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()))', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;

CREATE POLICY "Admin/team read fq docs" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'fq-documents' AND public.is_admin_or_team(auth.uid()));
CREATE POLICY "Admin/team upload fq docs" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'fq-documents' AND public.is_admin_or_team(auth.uid()));
CREATE POLICY "Admin/team delete fq docs" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'fq-documents' AND public.is_admin_or_team(auth.uid()));
