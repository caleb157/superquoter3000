ALTER TABLE public.products ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS idx_products_archived_at ON public.products (customer_rfq_id, archived_at);