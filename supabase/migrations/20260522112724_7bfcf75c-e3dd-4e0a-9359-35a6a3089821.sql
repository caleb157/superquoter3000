CREATE OR REPLACE FUNCTION public.validate_customer_rfq_currency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.quoting_currency IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.currencies WHERE code = NEW.quoting_currency
  ) THEN
    RAISE EXCEPTION 'Invalid quoting_currency: %', NEW.quoting_currency;
  END IF;
  RETURN NEW;
END $function$;