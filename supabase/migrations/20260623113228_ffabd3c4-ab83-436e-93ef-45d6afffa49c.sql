
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS bulk_pieces_per_box integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS bulk_shrink_factor numeric NOT NULL DEFAULT 1.0;
