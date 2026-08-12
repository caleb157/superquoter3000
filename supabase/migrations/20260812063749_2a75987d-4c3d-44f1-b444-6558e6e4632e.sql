CREATE OR REPLACE FUNCTION public.seed_product_defaults()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_cogs int;
  v_mc_buffer numeric;
BEGIN
  SELECT count(*) INTO v_existing_cogs FROM public.cogs_items WHERE product_id = NEW.id;
  IF v_existing_cogs > 0 THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(mc_height_buffer_inch, 2.5) INTO v_mc_buffer
  FROM public.global_settings LIMIT 1;
  IF v_mc_buffer IS NULL THEN v_mc_buffer := 2.5; END IF;

  -- 10 default COGS rows (mirrors src/lib/product-defaults.ts)
  INSERT INTO public.cogs_items
    (product_id, cogs_type, component_name, is_auto_calculated, waste_factor, sort_order)
  VALUES
    (NEW.id, 'Raw Piece',           'Raw Piece',         false, 0,    0),
    (NEW.id, 'Subcontracting',      'Subcontracting',    false, 0,    1),
    (NEW.id, 'Finishing Materials', 'Color',             true,  0,    4),
    (NEW.id, 'Finishing Materials', 'Sealer',            true,  0,    5),
    (NEW.id, 'Finishing Materials', 'Lacquer',           true,  0,    6),
    (NEW.id, 'Packaging',           'IC Box',            true,  0.05, 7),
    (NEW.id, 'Packaging',           'MC Box',            true,  0,    8),
    (NEW.id, 'Packaging',           'Other Packaging',   false, 0,    9),
    (NEW.id, 'Hardware',            'Hardware',          false, 0.05, 10),
    (NEW.id, 'Accessories',         'Accessory',         false, 0.05, 20);

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

  INSERT INTO public.cbm_estimates (product_id, mc_height_buffer_inch)
  SELECT NEW.id, v_mc_buffer
  WHERE NOT EXISTS (SELECT 1 FROM public.cbm_estimates WHERE product_id = NEW.id);

  INSERT INTO public.non_unit_cogs (product_id, name, total_quantity, cost_each_inr, include, sort_order)
  SELECT NEW.id, 'Auto Transport', 1, 0, 'Yes', 0
  WHERE NOT EXISTS (SELECT 1 FROM public.non_unit_cogs WHERE product_id = NEW.id);

  RETURN NEW;
END;
$function$;