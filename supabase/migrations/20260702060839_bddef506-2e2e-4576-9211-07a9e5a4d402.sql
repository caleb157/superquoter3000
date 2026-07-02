INSERT INTO public.finishing_difficulty (name, adjustment_factor, sort_order)
VALUES ('Wax', 0.3333, -1)
ON CONFLICT DO NOTHING;