CREATE OR REPLACE FUNCTION public.validate_customer_lead_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_status NOT IN ('lead','active','won','inactive','churned') THEN
    RAISE EXCEPTION 'Invalid lead_status: %', NEW.lead_status;
  END IF;
  RETURN NEW;
END $function$;