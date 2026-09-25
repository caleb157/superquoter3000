CREATE TABLE public.fob_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL UNIQUE,
  vendor text,
  rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fob_rates TO authenticated;
GRANT ALL ON public.fob_rates TO service_role;
ALTER TABLE public.fob_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team can read fob rates" ON public.fob_rates FOR SELECT TO authenticated USING (public.is_admin_or_team(auth.uid()));
CREATE POLICY "Admins manage fob rates" ON public.fob_rates FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_fob_rates_updated_at BEFORE UPDATE ON public.fob_rates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_fob_rates_mode() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.mode NOT IN ('LCL','FCL') THEN RAISE EXCEPTION 'Invalid fob mode: %', NEW.mode; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_fob_rates_mode BEFORE INSERT OR UPDATE ON public.fob_rates FOR EACH ROW EXECUTE FUNCTION public.validate_fob_rates_mode();

ALTER TABLE public.customer_rfqs ADD COLUMN fob_fumigation text NOT NULL DEFAULT 'none', ADD COLUMN fob_wlc text NOT NULL DEFAULT 'none';
CREATE OR REPLACE FUNCTION public.validate_fob_inquiry_fields() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.fob_fumigation NOT IN ('none','normal','ispm') THEN RAISE EXCEPTION 'Invalid fob_fumigation: %', NEW.fob_fumigation; END IF;
  IF NEW.fob_wlc NOT IN ('none','leather','bone_mop') THEN RAISE EXCEPTION 'Invalid fob_wlc: %', NEW.fob_wlc; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_fob_inquiry_fields BEFORE INSERT OR UPDATE ON public.customer_rfqs FOR EACH ROW EXECUTE FUNCTION public.validate_fob_inquiry_fields();