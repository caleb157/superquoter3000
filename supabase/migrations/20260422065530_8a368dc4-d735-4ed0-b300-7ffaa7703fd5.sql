ALTER TABLE public.customer_rfqs
  ADD COLUMN IF NOT EXISTS quoting_entity_id uuid REFERENCES public.company_entities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quoting_currency text;

-- Validation: only allow USD or INR (or null)
CREATE OR REPLACE FUNCTION public.validate_customer_rfq_currency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.quoting_currency IS NOT NULL AND NEW.quoting_currency NOT IN ('USD','INR') THEN
    RAISE EXCEPTION 'Invalid quoting_currency: %', NEW.quoting_currency;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS validate_customer_rfq_currency_trg ON public.customer_rfqs;
CREATE TRIGGER validate_customer_rfq_currency_trg
BEFORE INSERT OR UPDATE ON public.customer_rfqs
FOR EACH ROW EXECUTE FUNCTION public.validate_customer_rfq_currency();