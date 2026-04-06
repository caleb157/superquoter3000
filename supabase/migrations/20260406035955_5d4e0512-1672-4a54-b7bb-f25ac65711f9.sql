
-- QC Guides table
CREATE TABLE public.qc_guides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage qc_guides"
  ON public.qc_guides FOR ALL TO authenticated
  USING (is_admin_or_team(auth.uid()));

CREATE TRIGGER update_qc_guides_updated_at
  BEFORE UPDATE ON public.qc_guides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- QC Sections table
CREATE TABLE public.qc_sections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  guide_id uuid REFERENCES public.qc_guides(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage qc_sections"
  ON public.qc_sections FOR ALL TO authenticated
  USING (is_admin_or_team(auth.uid()));

-- QC Rows table
CREATE TABLE public.qc_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id uuid REFERENCES public.qc_sections(id) ON DELETE CASCADE NOT NULL,
  label text NOT NULL,
  text_content text,
  photo_urls jsonb DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.qc_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin/team can manage qc_rows"
  ON public.qc_rows FOR ALL TO authenticated
  USING (is_admin_or_team(auth.uid()));

-- Storage bucket for QC photos
INSERT INTO storage.buckets (id, name, public) VALUES ('qc-photos', 'qc-photos', true);

CREATE POLICY "Admin/team can upload qc photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'qc-photos' AND is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can update qc photos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'qc-photos' AND is_admin_or_team(auth.uid()));

CREATE POLICY "Admin/team can delete qc photos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'qc-photos' AND is_admin_or_team(auth.uid()));

CREATE POLICY "Public can view qc photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'qc-photos');
