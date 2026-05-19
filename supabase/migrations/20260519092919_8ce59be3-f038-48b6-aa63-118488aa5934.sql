ALTER TABLE public.currencies
  ADD COLUMN IF NOT EXISTS symbol text;

UPDATE public.currencies SET symbol = '₹' WHERE code = 'INR' AND symbol IS NULL;
UPDATE public.currencies SET symbol = '$' WHERE code = 'USD' AND symbol IS NULL;
UPDATE public.currencies SET symbol = '€' WHERE code = 'EUR' AND symbol IS NULL;
UPDATE public.currencies SET symbol = '£' WHERE code = 'GBP' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'A$' WHERE code = 'AUD' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'C$' WHERE code = 'CAD' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'AED' WHERE code = 'AED' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'R' WHERE code = 'ZAR' AND symbol IS NULL;
UPDATE public.currencies SET symbol = '¥' WHERE code = 'JPY' AND symbol IS NULL;
UPDATE public.currencies SET symbol = '₩' WHERE code = 'KRW' AND symbol IS NULL;
UPDATE public.currencies SET symbol = '¥' WHERE code = 'CNY' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'HK$' WHERE code = 'HKD' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'NZ$' WHERE code = 'NZD' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'S$' WHERE code = 'SGD' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'Fr' WHERE code = 'CHF' AND symbol IS NULL;
UPDATE public.currencies SET symbol = 'kr' WHERE code IN ('DKK','NOK','SEK') AND symbol IS NULL;
UPDATE public.currencies SET symbol = '₺' WHERE code = 'TRY' AND symbol IS NULL;

ALTER TABLE public.quote_snapshots
  ADD COLUMN IF NOT EXISTS currency_rate_inr_per_unit numeric;

UPDATE public.quote_snapshots
SET currency_rate_inr_per_unit = CASE
  WHEN currency = 'INR' THEN 1
  ELSE NULL
END
WHERE currency_rate_inr_per_unit IS NULL;