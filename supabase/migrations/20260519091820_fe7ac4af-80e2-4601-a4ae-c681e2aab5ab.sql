ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS source_location_id uuid REFERENCES public.local_transport_locations(id) ON DELETE SET NULL;

UPDATE public.products
SET source_location_id = (SELECT id FROM public.local_transport_locations WHERE name = 'Moradabad' LIMIT 1)
WHERE sourced_externally = true AND source_location_id IS NULL;