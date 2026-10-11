-- Terms and policies on the quote: frozen onto each quote_snapshot when it is created, so old
-- quotes keep the terms they were sent with. Each selling entity can override the built-in
-- default list (null = use the defaults in src/lib/quote-terms.ts).
ALTER TABLE public.quote_snapshots ADD COLUMN IF NOT EXISTS terms jsonb;  -- [{ key, title, text }]
ALTER TABLE public.company_entities ADD COLUMN IF NOT EXISTS default_terms jsonb;
