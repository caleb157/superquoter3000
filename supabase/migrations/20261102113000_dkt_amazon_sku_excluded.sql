-- DKT Cash Flow: leave an Amazon SKU out of the projection without deleting it.
ALTER TABLE public.dkt_amazon_skus
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false;
