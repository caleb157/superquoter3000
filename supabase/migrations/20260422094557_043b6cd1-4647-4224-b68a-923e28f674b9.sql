-- Function: seed default costing rows for a newly inserted product.
-- Idempotent: only seeds if the product currently has zero cogs_items.
CREATE OR REPLACE FUNCTION public.seed_product_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_cogs int;
  v_mc_buffer numeric;
BEGIN
  -- Idempotency guard
  SELECT count(*) INTO v_existing_cogs FROM public.cogs_items WHERE product_id = NEW.id;
  IF v_existing_cogs > 0 THEN
    RETURN NEW;
  END IF;

  -- Pull global mc_height_buffer (fallback 2.5)
  SELECT COALESCE(mc_height_buffer_inch, 2.5) INTO v_mc_buffer
  FROM public.global_settings LIMIT 1;
  IF v_mc_buffer IS NULL THEN v_mc_buffer := 2.5; END IF;

  -- 14 default COGS rows (mirrors src/lib/product-defaults.ts)
  INSERT INTO public.cogs_items
    (product_id, cogs_type, component_name, is_auto_calculated, waste_factor, sort_order)
  VALUES
    (NEW.id, 'Raw Piece',           'Raw Piece 1',       false, 0,    0),
    (NEW.id, 'Raw Piece',           'Raw Piece 2',       false, 0,    1),
    (NEW.id, 'Subcontracting',      'Subcontracting 1',  false, 0,    2),
    (NEW.id, 'Subcontracting',      'Subcontracting 2',  false, 0,    3),
    (NEW.id, 'Finishing Materials', 'Color',             true,  0,    4),
    (NEW.id, 'Finishing Materials', 'Sealer',            true,  0,    5),
    (NEW.id, 'Finishing Materials', 'Lacquer',           true,  0,    6),
    (NEW.id, 'Packaging',           'IC Box',            true,  0.05, 7),
    (NEW.id, 'Packaging',           'MC Box',            true,  0,    8),
    (NEW.id, 'Packaging',           'Other Packaging',   false, 0,    9),
    (NEW.id, 'Hardware',            'Hardware 1',        false, 0.05, 10),
    (NEW.id, 'Hardware',            'Hardware 2',        false, 0.05, 11),
    (NEW.id, 'Accessories',         'Accessory 1',       false, 0.05, 20),
    (NEW.id, 'Accessories',         'Accessory 2',       false, 0.05, 21);

  -- 7 default Overhead rows
  INSERT INTO public.overhead_items
    (product_id, labor_type, man_hours_per_unit, is_auto_estimated, sort_order)
  VALUES
    (NEW.id, 'Manufacturing', 0,    false, 0),
    (NEW.id, 'QC',            0.05, false, 1),
    (NEW.id, 'Sanding',       0,    false, 2),
    (NEW.id, 'Finishing',     0,    true,  3),
    (NEW.id, 'Assembly',      0,    false, 4),
    (NEW.id, 'Packaging',     0,    true,  5),
    (NEW.id, 'Market',        0,    false, 6);

  -- CBM estimate (one per product, only if missing)
  INSERT INTO public.cbm_estimates (product_id, mc_height_buffer_inch)
  SELECT NEW.id, v_mc_buffer
  WHERE NOT EXISTS (SELECT 1 FROM public.cbm_estimates WHERE product_id = NEW.id);

  -- Non-Unit COGS Auto Transport row (only if no non_unit_cogs exist yet)
  INSERT INTO public.non_unit_cogs (product_id, name, total_quantity, cost_each_inr, include, sort_order)
  SELECT NEW.id, 'Auto Transport', 1, 0, 'Yes', 0
  WHERE NOT EXISTS (SELECT 1 FROM public.non_unit_cogs WHERE product_id = NEW.id);

  RETURN NEW;
END;
$$;

-- Drop & re-create the trigger (safe to re-run)
DROP TRIGGER IF EXISTS trg_seed_product_defaults ON public.products;
CREATE TRIGGER trg_seed_product_defaults
AFTER INSERT ON public.products
FOR EACH ROW
EXECUTE FUNCTION public.seed_product_defaults();