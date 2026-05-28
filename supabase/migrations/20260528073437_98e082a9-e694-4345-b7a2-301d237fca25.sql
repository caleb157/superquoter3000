CREATE OR REPLACE FUNCTION public.validate_customer_rfq_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('active','paused','projected_po','po','complete','cancelled') THEN
    RAISE EXCEPTION 'Invalid inquiry status: %', NEW.status;
  END IF;
  RETURN NEW;
END $function$;