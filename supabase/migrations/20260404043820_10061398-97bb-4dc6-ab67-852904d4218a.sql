
-- Create RFQs table
CREATE TABLE public.rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  rfq_number text,
  rfq_type text NOT NULL,
  title text,
  vendor_name text,
  vendor_email text,
  vendor_phone text,
  vendor_address text,
  status text DEFAULT 'draft',
  discount_percent numeric,
  notes text,
  delivery_deadline text,
  payment_terms text,
  sent_at timestamptz,
  response_due date,
  share_token text UNIQUE DEFAULT gen_random_uuid()::text,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create RFQ line items table
CREATE TABLE public.rfq_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id uuid REFERENCES public.rfqs(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text,
  product_photo_url text,
  item_name text NOT NULL,
  description text,
  dimensions text,
  quantity numeric NOT NULL DEFAULT 0,
  units text,
  estimated_cost numeric,
  target_price numeric,
  vendor_price numeric,
  notes text,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_line_items ENABLE ROW LEVEL SECURITY;

-- RFQ policies
CREATE POLICY "Admin/team can manage rfqs"
  ON public.rfqs FOR ALL
  TO authenticated
  USING (is_admin_or_team(auth.uid()));

CREATE POLICY "Public can view rfqs by share token"
  ON public.rfqs FOR SELECT
  TO anon
  USING (share_token IS NOT NULL);

-- RFQ line items policies
CREATE POLICY "Admin/team can manage rfq line items"
  ON public.rfq_line_items FOR ALL
  TO authenticated
  USING (is_admin_or_team(auth.uid()));

CREATE POLICY "Public can view rfq line items by share token"
  ON public.rfq_line_items FOR SELECT
  TO anon
  USING (EXISTS (
    SELECT 1 FROM public.rfqs
    WHERE rfqs.id = rfq_line_items.rfq_id
    AND rfqs.share_token IS NOT NULL
  ));

-- Auto-update trigger for rfqs
CREATE TRIGGER update_rfqs_updated_at
  BEFORE UPDATE ON public.rfqs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes for performance
CREATE INDEX idx_rfqs_project_id ON public.rfqs(project_id);
CREATE INDEX idx_rfqs_share_token ON public.rfqs(share_token);
CREATE INDEX idx_rfq_line_items_rfq_id ON public.rfq_line_items(rfq_id);
CREATE INDEX idx_rfq_line_items_product_id ON public.rfq_line_items(product_id);
