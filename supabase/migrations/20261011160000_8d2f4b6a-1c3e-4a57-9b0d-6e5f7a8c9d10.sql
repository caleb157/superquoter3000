-- Quote versions: editing a sent quote saves a new draft version instead of changing the sent copy.
-- version_of points every later version at the first one; the first has version 1 and no version_of.
ALTER TABLE public.quote_snapshots ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.quote_snapshots ADD COLUMN IF NOT EXISTS version_of uuid REFERENCES public.quote_snapshots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS quote_snapshots_version_of_idx ON public.quote_snapshots(version_of);
