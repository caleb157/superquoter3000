ALTER TABLE public.quote_snapshots
  ADD COLUMN IF NOT EXISTS customer jsonb,
  ADD COLUMN IF NOT EXISTS entity jsonb,
  ADD COLUMN IF NOT EXISTS inquiry jsonb;