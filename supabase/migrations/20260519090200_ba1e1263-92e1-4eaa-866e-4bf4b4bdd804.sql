
-- 1. Currencies
CREATE TABLE IF NOT EXISTS public.currencies (
  code text PRIMARY KEY,
  name text NOT NULL,
  units_per_inr_base numeric NOT NULL DEFAULT 1,
  import_rate numeric,
  export_rate numeric,
  effective_start_date date,
  sort_priority integer NOT NULL DEFAULT 100,
  is_featured boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.currencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/team can manage currencies" ON public.currencies FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
CREATE TRIGGER trg_currencies_updated_at BEFORE UPDATE ON public.currencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.currencies (code, name, units_per_inr_base, import_rate, export_rate, effective_start_date, sort_priority, is_featured) VALUES
  ('INR','Indian Rupee',1,1,1,'2026-05-12',1,true),
  ('USD','US Dollars',1,95.15,93.45,'2026-05-12',2,true),
  ('EUR','Euro',1,111.95,108.25,'2026-05-12',3,true),
  ('GBP','Pound Sterling',1,128.9,124.85,'2026-05-12',4,true),
  ('AUD','Australian Dollar',1,68.6,65.65,'2026-05-12',5,true),
  ('CAD','Canadian Dollar',1,69.9,67.65,'2026-05-12',6,true),
  ('AED','UAE Dirham',1,26.45,24.95,'2026-05-12',7,true),
  ('ZAR','South African Rand',1,5.8,5.5,'2026-05-12',8,true),
  ('BHD','Bahraini Dinar',1,NULL,NULL,'2026-05-12',100,false),
  ('CHF','Swiss Franc',1,NULL,NULL,'2026-05-12',100,false),
  ('CNY','Chinese Yuan',1,NULL,NULL,'2026-05-12',100,false),
  ('DKK','Danish Krone',1,NULL,NULL,'2026-05-12',100,false),
  ('HKD','Hong Kong Dollar',1,NULL,NULL,'2026-05-12',100,false),
  ('JPY','Japanese Yen',100,NULL,NULL,'2026-05-12',100,false),
  ('KRW','South Korean Won',100,NULL,NULL,'2026-05-12',100,false),
  ('KWD','Kuwaiti Dinar',1,NULL,NULL,'2026-05-12',100,false),
  ('NOK','Norwegian Krone',1,NULL,NULL,'2026-05-12',100,false),
  ('NZD','New Zealand Dollar',1,NULL,NULL,'2026-05-12',100,false),
  ('QAR','Qatari Riyal',1,NULL,NULL,'2026-05-12',100,false),
  ('SAR','Saudi Riyal',1,NULL,NULL,'2026-05-12',100,false),
  ('SEK','Swedish Krona',1,NULL,NULL,'2026-05-12',100,false),
  ('SGD','Singapore Dollar',1,NULL,NULL,'2026-05-12',100,false),
  ('TRY','Turkish Lira',1,NULL,NULL,'2026-05-12',100,false);

-- 2. Finishing difficulty
CREATE TABLE IF NOT EXISTS public.finishing_difficulty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  adjustment_factor numeric NOT NULL DEFAULT 1.0,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.finishing_difficulty ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/team can manage finishing difficulty" ON public.finishing_difficulty FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
CREATE TRIGGER trg_finishing_difficulty_updated_at BEFORE UPDATE ON public.finishing_difficulty
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.finishing_difficulty (name, adjustment_factor, sort_order) VALUES
  ('Very Easy',0.7,1),('Easy',0.9,2),('Medium',1.0,3),('Hard',1.1,4),('Very Hard',1.3,5);

-- 3. COGS categories (mirror actual strings in use)
CREATE TABLE IF NOT EXISTS public.cogs_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  default_unit_type text,
  sort_order integer NOT NULL DEFAULT 100,
  is_subcontracting boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cogs_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/team can manage cogs categories" ON public.cogs_categories FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));

INSERT INTO public.cogs_categories (name, default_unit_type, sort_order, is_subcontracting) VALUES
  ('Raw Piece','pc',1,false),
  ('Wood','CFT',2,false),
  ('Finishing Materials','L',3,false),
  ('Hardware','pc',4,false),
  ('Accessories','pc',5,false),
  ('Subcontracting','pc',6,true),
  ('Packaging','pc',7,false),
  ('Components','pc',8,false),
  ('Other','pc',999,false);

-- 4. Raw material costs
CREATE TABLE IF NOT EXISTS public.raw_material_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  name text NOT NULL,
  cost numeric NOT NULL DEFAULT 0,
  unit_type text NOT NULL DEFAULT 'pc',
  currency text NOT NULL DEFAULT 'INR',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_raw_material_costs_category ON public.raw_material_costs(category);
CREATE INDEX IF NOT EXISTS idx_raw_material_costs_active ON public.raw_material_costs(active);
ALTER TABLE public.raw_material_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/team can manage raw material costs" ON public.raw_material_costs FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
CREATE TRIGGER trg_raw_material_costs_updated_at BEFORE UPDATE ON public.raw_material_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Backfill from existing pricing tables (COPY only)
INSERT INTO public.raw_material_costs (category, name, cost, unit_type, currency, notes)
SELECT 'Hardware', name, unit_cost_inr, COALESCE(units,'pc'), 'INR', 'Backfilled from hardware_prices'
FROM public.hardware_prices;

INSERT INTO public.raw_material_costs (category, name, cost, unit_type, currency, notes)
SELECT 'Finishing Materials', COALESCE(category,'') || CASE WHEN category IS NOT NULL THEN ' - ' ELSE '' END || name, price_per_litre_inr, 'L', 'INR', 'Backfilled from chemical_prices'
FROM public.chemical_prices;

INSERT INTO public.raw_material_costs (category, name, cost, unit_type, currency, notes)
SELECT 'Wood', wood_type, price_per_cft_inr, 'CFT', 'INR', 'Backfilled from wood_prices'
FROM public.wood_prices;

-- 5. Local transport locations
CREATE TABLE IF NOT EXISTS public.local_transport_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  cost_per_cbm_inr numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.local_transport_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin/team can manage local transport locations" ON public.local_transport_locations FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
CREATE TRIGGER trg_ltl_updated_at BEFORE UPDATE ON public.local_transport_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.local_transport_locations (name, cost_per_cbm_inr, sort_order) VALUES
  ('Moradabad',3000,1),('Agra',3000,2),('Saharanpur',3000,3),('Bareilly',2000,4);

-- 6. Box data (existing table) — add OD offset columns, backfill by ply parsed from box_type
ALTER TABLE public.box_data
  ADD COLUMN IF NOT EXISTS od_length_add_in numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS od_width_add_in numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS od_height_add_in numeric NOT NULL DEFAULT 0;

UPDATE public.box_data
SET
  od_length_add_in = CASE
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 3 THEN 0.125
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 5 THEN 0.25
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 7 THEN 0.375
    ELSE 0.5
  END,
  od_width_add_in = CASE
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 3 THEN 0.125
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 5 THEN 0.25
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 7 THEN 0.375
    ELSE 0.5
  END,
  od_height_add_in = CASE
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 3 THEN 0.25
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 5 THEN 0.75
    WHEN (substring(box_type from '(\d+)\s*ply'))::int <= 7 THEN 1.25
    ELSE 1.75
  END
WHERE od_length_add_in = 0 AND od_width_add_in = 0 AND od_height_add_in = 0;

-- 7. Product types — new columns + backfills from existing
ALTER TABLE public.product_types
  ADD COLUMN IF NOT EXISTS finishing_mh_per_100ri numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finishing_sealer_l_per_100ri numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pkg_ic_add_per_side_in numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pkg_corrugate_bubble_rate_mh_per_cbm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pkg_ic_rate_mh_per_cbm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pkg_ic_mc_rate_mh_per_cbm numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_percent_wood_for_finishing numeric DEFAULT 1.0;

UPDATE public.product_types SET finishing_sealer_l_per_100ri = COALESCE(finishing_sealer_per_100ri, 0) WHERE finishing_sealer_l_per_100ri = 0;
UPDATE public.product_types SET pkg_corrugate_bubble_rate_mh_per_cbm = COALESCE(packaging_mh_per_cbm, 0) WHERE pkg_corrugate_bubble_rate_mh_per_cbm = 0;
UPDATE public.product_types SET pkg_ic_add_per_side_in = COALESCE(ic_addition_per_side_inch, 0) WHERE pkg_ic_add_per_side_in = 0;

UPDATE public.product_types SET default_percent_wood_for_finishing = 1.0 WHERE name ILIKE '%wood%';
UPDATE public.product_types SET default_percent_wood_for_finishing = 0.0 WHERE name ILIKE '%metal%';
UPDATE public.product_types SET default_percent_wood_for_finishing = 0.5 WHERE name ILIKE '%mixed%';

-- 8. Global settings — total available mh per month
ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS total_available_mh_per_month numeric;

UPDATE public.global_settings
SET total_available_mh_per_month = COALESCE(num_laborers,0) * COALESCE(available_hours_per_month,0)
WHERE total_available_mh_per_month IS NULL;
