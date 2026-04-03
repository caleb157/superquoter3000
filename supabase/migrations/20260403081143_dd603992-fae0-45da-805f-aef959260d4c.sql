
CREATE TABLE public.project_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL UNIQUE,
  
  exchange_rate_override numeric,
  use_global_exchange_rate boolean DEFAULT true,
  
  quote_currency text DEFAULT 'USD',
  
  shipping_type_override text,
  use_global_shipping boolean DEFAULT true,
  
  rfq_discount_percent numeric DEFAULT 0.10,
  
  default_markup_override numeric,
  apply_uniform_markup boolean DEFAULT false,
  
  quote_title text,
  quote_notes text,
  quote_validity_days integer DEFAULT 30,
  show_cbm_on_quote boolean DEFAULT true,
  show_dimensions_on_quote boolean DEFAULT true,
  show_weight_on_quote boolean DEFAULT false,
  show_sku_on_quote boolean DEFAULT true,
  show_photos_on_quote boolean DEFAULT true,
  
  customer_logo_url text,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.project_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can do all on project_settings"
  ON public.project_settings FOR ALL
  TO authenticated
  USING (is_admin_or_team(auth.uid()));

CREATE POLICY "Guests can view project settings"
  ON public.project_settings FOR SELECT
  TO authenticated
  USING (is_guest_for_project(auth.uid(), project_id));

CREATE TRIGGER update_project_settings_updated_at
  BEFORE UPDATE ON public.project_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
