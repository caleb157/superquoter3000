ALTER TABLE public.finishing_difficulty ADD COLUMN IF NOT EXISTS rupees_per_ri numeric;
UPDATE public.finishing_difficulty SET rupees_per_ri = CASE name
  WHEN 'Wax' THEN 5 WHEN 'Extremely Easy' THEN 5 WHEN 'Very Easy' THEN 5
  WHEN 'Easy' THEN 6 WHEN 'Medium' THEN 7 WHEN 'Hard' THEN 8 WHEN 'Very Hard' THEN 8
  ELSE 7 END
WHERE rupees_per_ri IS NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS running_inches_override numeric;