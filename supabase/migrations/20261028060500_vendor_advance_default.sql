-- Vendor payment split: default vendor advance % in Settings → Projections defaults (seeded at 50%),
-- and existing inquiries moved onto it. Safe to run more than once.

-- 1. New setting, seeded at 50%.
ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS default_vendor_deposit_pct numeric NOT NULL DEFAULT 0.5;

-- 2. New inquiries start empty so they follow the setting (the old column default was 30/70).
ALTER TABLE public.inquiry_projections ALTER COLUMN vendor_deposit_pct DROP DEFAULT;
ALTER TABLE public.inquiry_projections ALTER COLUMN vendor_balance_pct DROP DEFAULT;

-- 3. Existing inquiries: the stored 30/70 was only ever the old column default (there was no way
--    to edit it), so clear it and let them follow the 50% setting. Any other split is left alone.
UPDATE public.inquiry_projections
   SET vendor_deposit_pct = NULL, vendor_balance_pct = NULL
 WHERE vendor_deposit_pct = 0.30
   AND (vendor_balance_pct = 0.70 OR vendor_balance_pct IS NULL);

-- Check: how many inquiries still have their own vendor split (expect 0 right after running).
SELECT count(*) AS own_vendor_split FROM public.inquiry_projections WHERE vendor_deposit_pct IS NOT NULL;
