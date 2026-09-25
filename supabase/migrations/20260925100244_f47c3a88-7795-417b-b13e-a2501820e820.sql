ALTER TABLE public.customer_rfqs
  ADD COLUMN IF NOT EXISTS fob_pool_cbm_override numeric,
  ADD COLUMN IF NOT EXISTS fob_pool_cartons_override integer,
  ADD COLUMN IF NOT EXISTS fob_mode_override text;

CREATE OR REPLACE FUNCTION public.validate_fob_mode_override()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.fob_mode_override IS NOT NULL AND NEW.fob_mode_override NOT IN ('LCL','FCL_20ST','FCL_40HC') THEN
    RAISE EXCEPTION 'Invalid fob_mode_override: %', NEW.fob_mode_override;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_validate_fob_mode_override
BEFORE INSERT OR UPDATE ON public.customer_rfqs
FOR EACH ROW EXECUTE FUNCTION public.validate_fob_mode_override();