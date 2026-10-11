ALTER TABLE public.quote_snapshots ADD COLUMN IF NOT EXISTS terms jsonb;

ALTER TABLE public.company_entities ADD COLUMN IF NOT EXISTS default_terms jsonb;