ALTER TABLE public.customer_rfqs
  ADD COLUMN IF NOT EXISTS indirect_overhead_monthly_override numeric,
  ADD COLUMN IF NOT EXISTS available_hours_per_month_override numeric,
  ADD COLUMN IF NOT EXISTS num_laborers_override integer,
  ADD COLUMN IF NOT EXISTS packaging_cost_per_cbm_override numeric,
  ADD COLUMN IF NOT EXISTS auto_transport_cost_per_cbm_override numeric,
  ADD COLUMN IF NOT EXISTS local_transport_cost_per_cbm_override numeric,
  ADD COLUMN IF NOT EXISTS contractor_to_inhouse_decrease_override numeric;