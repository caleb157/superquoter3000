-- DKT Cash Flow: pin an Allegro launch to a PO month and say who pays for it.
-- launch_month blank = Allegro sets it; launch_paid_by blank = Allegro if it has the full amount, else DKT.
ALTER TABLE public.dkt_amazon_skus
  ADD COLUMN IF NOT EXISTS launch_month date,
  ADD COLUMN IF NOT EXISTS launch_paid_by text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dkt_amazon_skus_launch_paid_by_check') THEN
    ALTER TABLE public.dkt_amazon_skus
      ADD CONSTRAINT dkt_amazon_skus_launch_paid_by_check CHECK (launch_paid_by IS NULL OR launch_paid_by IN ('allegro', 'dkt'));
  END IF;
END $$;
