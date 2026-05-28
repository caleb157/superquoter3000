DELETE FROM public.overhead_items WHERE labor_type = 'Sanding';
UPDATE public.labor_employees SET designations = array_remove(designations, 'Sanding') WHERE 'Sanding' = ANY(designations);