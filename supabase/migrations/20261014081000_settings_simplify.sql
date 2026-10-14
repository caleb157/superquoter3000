-- Settings simplification (Employees → fallback labor rates, Hardware prices → Materials & hardware,
-- no below-MOQ surcharge). Safe to run more than once: each step only adds what is missing.

-- 1. Fallback ₹/hr per labor type (Settings → General → Live rates), used when LaborTrax has no
--    rate for a type. Seeded once from today's Labor Directory averages, so costs don't move.
ALTER TABLE public.global_settings ADD COLUMN IF NOT EXISTS fallback_direct_rates jsonb;
UPDATE public.global_settings gs
SET fallback_direct_rates = COALESCE((
  SELECT jsonb_object_agg(a.labor_type, a.rate)
  FROM (
    SELECT t.labor_type, round(avg(e.hourly_rate_inr)::numeric, 2) AS rate
    FROM unnest(ARRAY['Manufacturing','Finishing','Assembly','Packaging','QC','Market']) AS t(labor_type)
    JOIN public.labor_employees e ON t.labor_type = ANY(e.designations)
    GROUP BY t.labor_type
  ) a
), '{}'::jsonb)
WHERE gs.fallback_direct_rates IS NULL;

-- 2. Hardware prices move into raw_material_costs (Settings → Materials & hardware) under
--    "Other Hardware"; names already there are skipped.
DO $$
BEGIN
  IF to_regclass('public.hardware_prices') IS NOT NULL THEN
    INSERT INTO public.raw_material_costs (category, name, cost, unit_type, currency, active)
    SELECT 'Other Hardware', h.name, h.unit_cost_inr, COALESCE(NULLIF(h.units, ''), 'pc'), 'INR', true
    FROM public.hardware_prices h
    WHERE NOT EXISTS (
      SELECT 1 FROM public.raw_material_costs r
      WHERE lower(trim(r.name)) = lower(trim(h.name))
        AND r.category IN ('Inserts + Instructions','Handles + Knobs','Feet/Buffers','Handles/Latches','Other Hardware','Accessories','Hardware')
    );
  END IF;
END $$;

-- 3. The "Minimum order" quote term no longer offers a below-MOQ surcharge. Entities with their
--    own terms list get the new wording, logged in the Quote Terms changelog.
WITH updated AS (
  UPDATE public.company_entities ce
  SET default_terms = (
    SELECT jsonb_agg(CASE WHEN c->>'key' = 'moq' AND c->>'text' ILIKE '%surcharge%'
      THEN jsonb_set(c, '{text}', to_jsonb('Quoted MOQs apply. Where a quote shows a lower minimum, a first order can go down to it at the quoted price.'::text))
      ELSE c END ORDER BY ord)
    FROM jsonb_array_elements(ce.default_terms) WITH ORDINALITY AS x(c, ord)
  )
  WHERE jsonb_typeof(ce.default_terms) = 'array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(ce.default_terms) c WHERE c->>'key' = 'moq' AND c->>'text' ILIKE '%surcharge%')
  RETURNING ce.id, ce.default_terms
)
INSERT INTO public.quote_terms_changes (entity_id, changed_by_name, changes, terms)
SELECT id, 'Settings cleanup', '["Changed the text of \"Minimum order\" (below-MOQ surcharge removed)"]'::jsonb, default_terms
FROM updated;
