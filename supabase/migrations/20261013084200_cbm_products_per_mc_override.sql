-- Pieces per master carton typed by hand in the Costing Workspace (Packaging & CBM).
-- Null = use the calculated fit. Safe to run more than once.
ALTER TABLE public.cbm_estimates ADD COLUMN IF NOT EXISTS products_per_mc_override integer;
