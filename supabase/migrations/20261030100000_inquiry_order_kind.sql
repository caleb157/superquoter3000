-- Trading or manufacturing, picked on the inquiry's Projection tab. NULL = auto (labour man-hours = manufacturing).
ALTER TABLE public.inquiry_projections ADD COLUMN IF NOT EXISTS order_kind text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inquiry_projections_order_kind_check') THEN
    ALTER TABLE public.inquiry_projections
      ADD CONSTRAINT inquiry_projections_order_kind_check CHECK (order_kind IS NULL OR order_kind IN ('trading', 'manufacturing'));
  END IF;
END $$;
