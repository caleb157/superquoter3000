-- Hand-entered quoted date for an inquiry, for quotes that went out before (or outside) the app.
-- When set, the inquiry clock and the Inquiry → quote KPI stop here instead of at the first
-- saved quote. Safe to run more than once.
ALTER TABLE public.customer_rfqs ADD COLUMN IF NOT EXISTS quoted_date date;
