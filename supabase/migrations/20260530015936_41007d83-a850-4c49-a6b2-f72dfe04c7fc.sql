ALTER TABLE public.inquiry_projections
  ADD COLUMN IF NOT EXISTS paying_shipping boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duration_months integer;