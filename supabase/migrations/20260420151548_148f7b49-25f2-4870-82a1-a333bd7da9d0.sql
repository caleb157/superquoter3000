ALTER TABLE public.rfs
  ADD COLUMN IF NOT EXISTS finishes_used text,
  ADD COLUMN IF NOT EXISTS vendors_used text;