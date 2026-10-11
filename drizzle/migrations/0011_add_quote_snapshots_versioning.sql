ALTER TABLE public.quote_snapshots ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE public.quote_snapshots ADD COLUMN IF NOT EXISTS version_of uuid REFERENCES public.quote_snapshots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS quote_snapshots_version_of_idx ON public.quote_snapshots(version_of);