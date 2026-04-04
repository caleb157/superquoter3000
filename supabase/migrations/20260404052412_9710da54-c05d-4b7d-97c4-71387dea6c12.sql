-- Product Assemblies: groups of component products sold as one SKU
CREATE TABLE public.product_assemblies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  sku text,
  photo_url text,
  quantity integer NOT NULL DEFAULT 100,
  moq integer DEFAULT 50,
  target_price_usd numeric,
  markup_percent numeric DEFAULT 0.20,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Assembly Components: links assemblies to their component products
CREATE TABLE public.assembly_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id uuid REFERENCES public.product_assemblies(id) ON DELETE CASCADE NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  quantity_per_assembly integer DEFAULT 1,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assembly_components ENABLE ROW LEVEL SECURITY;

-- RLS policies for assemblies
CREATE POLICY "Admin/team can manage assemblies"
  ON public.product_assemblies FOR ALL TO authenticated
  USING (is_admin_or_team(auth.uid()));

CREATE POLICY "Guests can view assemblies for invited projects"
  ON public.product_assemblies FOR SELECT TO authenticated
  USING (is_guest_for_project(auth.uid(), project_id));

-- RLS policies for assembly components
CREATE POLICY "Admin/team can manage assembly components"
  ON public.assembly_components FOR ALL TO authenticated
  USING (is_admin_or_team(auth.uid()));

CREATE POLICY "Guests can view assembly components"
  ON public.assembly_components FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.product_assemblies pa
    WHERE pa.id = assembly_components.assembly_id
    AND is_guest_for_project(auth.uid(), pa.project_id)
  ));

-- Indexes
CREATE INDEX idx_assemblies_project ON public.product_assemblies(project_id);
CREATE INDEX idx_assembly_components_assembly ON public.assembly_components(assembly_id);
CREATE INDEX idx_assembly_components_product ON public.assembly_components(product_id);

-- Trigger for updated_at
CREATE TRIGGER update_product_assemblies_updated_at
  BEFORE UPDATE ON public.product_assemblies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();