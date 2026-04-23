CREATE OR REPLACE FUNCTION public.validate_product_stages()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.design_stage IS NOT NULL AND NEW.design_stage NOT IN ('need_design','designed') THEN
    RAISE EXCEPTION 'Invalid design_stage: %', NEW.design_stage;
  END IF;
  IF NEW.quote_stage IS NOT NULL AND NEW.quote_stage NOT IN ('quoting','ready_for_quote','quoted') THEN
    RAISE EXCEPTION 'Invalid quote_stage: %', NEW.quote_stage;
  END IF;
  IF NEW.sample_stage IS NOT NULL AND NEW.sample_stage NOT IN ('sampling','sampled') THEN
    RAISE EXCEPTION 'Invalid sample_stage: %', NEW.sample_stage;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.update_product_sample_stage_on_sample_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id uuid;
  v_pending_count int;
  v_any_count int;
  v_current_stage text;
BEGIN
  v_product_id := COALESCE(NEW.product_id, OLD.product_id);
  IF v_product_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT sample_stage INTO v_current_stage FROM public.products WHERE id = v_product_id;
  -- Don't override manual 'sampled' state
  IF v_current_stage = 'sampled' THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT
    count(*) FILTER (WHERE status = 'pending'),
    count(*)
  INTO v_pending_count, v_any_count
  FROM public.samples
  WHERE product_id = v_product_id;
  IF v_pending_count > 0 THEN
    UPDATE public.products SET sample_stage = 'sampling' WHERE id = v_product_id AND sample_stage IS DISTINCT FROM 'sampling';
  ELSIF v_any_count > 0 THEN
    UPDATE public.products SET sample_stage = NULL WHERE id = v_product_id AND sample_stage = 'sampling';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;