-- Prospects: search, filters and list counts without per-row security checks.
-- With row security on, search_prospects and prospect_facets ran is_admin_or_team(auth.uid()) for every row they scanned
-- (prospect_facets scans prospects seven times), so with 64k+ companies they ran into the statement timeout while a load
-- was going. Like import_prospects, they now run as security definer with one admin/team check at the start.
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.search_prospects(
  p_q text DEFAULT NULL, p_lists text[] DEFAULT NULL, p_types text[] DEFAULT NULL, p_tiers text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL, p_tags text[] DEFAULT NULL, p_status text[] DEFAULT NULL,
  p_in_crm boolean DEFAULT NULL, p_has_people boolean DEFAULT NULL, p_sort text DEFAULT 'rank',
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE q text := nullif(trim(coalesce(p_q,'')), ''); tsq tsquery; total bigint; ids uuid[]; out jsonb;
        lim int := least(greatest(coalesce(p_limit, 50), 1), 500); off int := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can use Prospects'; END IF;
  IF q IS NOT NULL THEN
    tsq := nullif(array_to_string(ARRAY(SELECT regexp_replace(w, '[^a-z0-9]', '', 'g') || ':*'
             FROM unnest(regexp_split_to_array(lower(q), '\s+')) w WHERE regexp_replace(w, '[^a-z0-9]', '', 'g') <> ''), ' & '), '')::tsquery;
  END IF;
  SELECT count(*) INTO total FROM prospects p WHERE (q IS NULL OR (tsq IS NOT NULL AND p.search @@ tsq) OR p.name ILIKE '%' || q || '%' OR p.domain ILIKE '%' || q || '%')
      AND (p_lists IS NULL OR EXISTS (SELECT 1 FROM prospect_list_members m WHERE m.prospect_id = p.id AND m.list_id = ANY(p_lists)))
      AND (p_types IS NULL OR p.prospect_type = ANY(p_types))
      AND (p_tiers IS NULL OR p.effective_tier = ANY(p_tiers))
      AND (p_countries IS NULL OR p.country = ANY(p_countries))
      AND (p_tags IS NULL OR p.tags && p_tags)
      AND (p_status IS NULL OR p.status = ANY(p_status))
      AND (p_in_crm IS NULL OR (p.customer_id IS NOT NULL) = p_in_crm)
      AND (p_has_people IS NULL OR (p.people_count > 0) = p_has_people);
  -- one ORDER BY per sort so the default (rank) can walk idx_prospects_rank instead of sorting everything
  IF p_sort = 'name' THEN
    SELECT array_agg(id) INTO ids FROM (SELECT p.id FROM prospects p WHERE (q IS NULL OR (tsq IS NOT NULL AND p.search @@ tsq) OR p.name ILIKE '%' || q || '%' OR p.domain ILIKE '%' || q || '%')
      AND (p_lists IS NULL OR EXISTS (SELECT 1 FROM prospect_list_members m WHERE m.prospect_id = p.id AND m.list_id = ANY(p_lists)))
      AND (p_types IS NULL OR p.prospect_type = ANY(p_types))
      AND (p_tiers IS NULL OR p.effective_tier = ANY(p_tiers))
      AND (p_countries IS NULL OR p.country = ANY(p_countries))
      AND (p_tags IS NULL OR p.tags && p_tags)
      AND (p_status IS NULL OR p.status = ANY(p_status))
      AND (p_in_crm IS NULL OR (p.customer_id IS NOT NULL) = p_in_crm)
      AND (p_has_people IS NULL OR (p.people_count > 0) = p_has_people) ORDER BY p.name, p.id LIMIT lim OFFSET off) s;
  ELSIF p_sort = 'trade' THEN
    SELECT array_agg(id) INTO ids FROM (SELECT p.id FROM prospects p WHERE (q IS NULL OR (tsq IS NOT NULL AND p.search @@ tsq) OR p.name ILIKE '%' || q || '%' OR p.domain ILIKE '%' || q || '%')
      AND (p_lists IS NULL OR EXISTS (SELECT 1 FROM prospect_list_members m WHERE m.prospect_id = p.id AND m.list_id = ANY(p_lists)))
      AND (p_types IS NULL OR p.prospect_type = ANY(p_types))
      AND (p_tiers IS NULL OR p.effective_tier = ANY(p_tiers))
      AND (p_countries IS NULL OR p.country = ANY(p_countries))
      AND (p_tags IS NULL OR p.tags && p_tags)
      AND (p_status IS NULL OR p.status = ANY(p_status))
      AND (p_in_crm IS NULL OR (p.customer_id IS NOT NULL) = p_in_crm)
      AND (p_has_people IS NULL OR (p.people_count > 0) = p_has_people) ORDER BY p.trade_value_2025 DESC NULLS LAST, p.id LIMIT lim OFFSET off) s;
  ELSIF p_sort = 'recent' THEN
    SELECT array_agg(id) INTO ids FROM (SELECT p.id FROM prospects p WHERE (q IS NULL OR (tsq IS NOT NULL AND p.search @@ tsq) OR p.name ILIKE '%' || q || '%' OR p.domain ILIKE '%' || q || '%')
      AND (p_lists IS NULL OR EXISTS (SELECT 1 FROM prospect_list_members m WHERE m.prospect_id = p.id AND m.list_id = ANY(p_lists)))
      AND (p_types IS NULL OR p.prospect_type = ANY(p_types))
      AND (p_tiers IS NULL OR p.effective_tier = ANY(p_tiers))
      AND (p_countries IS NULL OR p.country = ANY(p_countries))
      AND (p_tags IS NULL OR p.tags && p_tags)
      AND (p_status IS NULL OR p.status = ANY(p_status))
      AND (p_in_crm IS NULL OR (p.customer_id IS NOT NULL) = p_in_crm)
      AND (p_has_people IS NULL OR (p.people_count > 0) = p_has_people) ORDER BY p.updated_at DESC, p.id LIMIT lim OFFSET off) s;
  ELSE
    SELECT array_agg(id) INTO ids FROM (SELECT p.id FROM prospects p WHERE (q IS NULL OR (tsq IS NOT NULL AND p.search @@ tsq) OR p.name ILIKE '%' || q || '%' OR p.domain ILIKE '%' || q || '%')
      AND (p_lists IS NULL OR EXISTS (SELECT 1 FROM prospect_list_members m WHERE m.prospect_id = p.id AND m.list_id = ANY(p_lists)))
      AND (p_types IS NULL OR p.prospect_type = ANY(p_types))
      AND (p_tiers IS NULL OR p.effective_tier = ANY(p_tiers))
      AND (p_countries IS NULL OR p.country = ANY(p_countries))
      AND (p_tags IS NULL OR p.tags && p_tags)
      AND (p_status IS NULL OR p.status = ANY(p_status))
      AND (p_in_crm IS NULL OR (p.customer_id IS NOT NULL) = p_in_crm)
      AND (p_has_people IS NULL OR (p.people_count > 0) = p_has_people) ORDER BY p.effective_tier, p.pinned DESC, p.score DESC NULLS LAST, p.id LIMIT lim OFFSET off) s;
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(x) - 'ord' ORDER BY x.ord), '[]'::jsonb) INTO out FROM (
    SELECT array_position(ids, p.id) AS ord, p.id, p.name, p.domain, p.website, p.country, p.state, p.city, p.prospect_type, p.tags, p.score, p.tier, p.rank,
           p.tier_override, p.pinned, p.effective_tier, p.status, p.excluded_reason, p.customer_id, p.dnc, p.people_count, p.best_contact,
           p.best_contact_title, p.trade_shipments, p.trade_value_2025, p.employees, p.linkedin_url, p.email, p.sources, p.products,
           (SELECT array_agg(m.list_id ORDER BY m.list_id) FROM prospect_list_members m WHERE m.prospect_id = p.id) AS lists
    FROM prospects p WHERE p.id = ANY(coalesce(ids, '{}'))
  ) x;
  RETURN jsonb_build_object('total', total, 'rows', out);
END $$;

CREATE OR REPLACE FUNCTION public.prospect_facets()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can use Prospects'; END IF;
  RETURN (
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM prospects),
    'lists', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'n', member_count, 'run_date', run_date, 'description', description) ORDER BY sort_order, run_date DESC NULLS LAST, name), '[]') FROM prospect_lists WHERE NOT archived),
    'types', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY n DESC), '[]') FROM (SELECT prospect_type v, count(*) n FROM prospects WHERE prospect_type IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 30) t),
    'tiers', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY v), '[]') FROM (SELECT effective_tier v, count(*) n FROM prospects GROUP BY 1) t),
    'countries', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY n DESC), '[]') FROM (SELECT country v, count(*) n FROM prospects WHERE country IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 25) t),
    'tags', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY n DESC), '[]') FROM (SELECT t v, count(*) n FROM prospects, unnest(tags) t GROUP BY 1 ORDER BY 2 DESC LIMIT 25) t),
    'status', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n)), '[]') FROM (SELECT status v, count(*) n FROM prospects GROUP BY 1) t),
    'in_crm', (SELECT count(*) FROM prospects WHERE customer_id IS NOT NULL)
  )
  );
END $$;

CREATE OR REPLACE FUNCTION public.refresh_prospect_counts()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can use Prospects'; END IF;
  UPDATE prospect_lists l SET member_count = coalesce((SELECT count(*) FROM prospect_list_members m WHERE m.list_id = l.id), 0);
END $$;

CREATE OR REPLACE FUNCTION public.upsert_prospect_lists(p_lists jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can use Prospects'; END IF;
  WITH up AS (
    INSERT INTO prospect_lists (id, name, kind, description, source_file, run_date, sort_order)
    SELECT e->>'id', e->>'name', coalesce(e->>'kind','custom'), e->>'description', e->>'source_file', nullif(e->>'run_date','')::date,
           coalesce(nullif(e->>'sort_order','')::int, 100)
    FROM jsonb_array_elements(p_lists) e WHERE coalesce(e->>'id','') <> '' AND coalesce(e->>'name','') <> ''
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, description = EXCLUDED.description,
      source_file = EXCLUDED.source_file, run_date = EXCLUDED.run_date, sort_order = EXCLUDED.sort_order
    RETURNING 1)
  SELECT count(*)::int INTO n FROM up;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.search_prospects(text, text[], text[], text[], text[], text[], text[], boolean, boolean, text, integer, integer),
  public.prospect_facets(), public.refresh_prospect_counts(), public.upsert_prospect_lists(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_prospects(text, text[], text[], text[], text[], text[], text[], boolean, boolean, text, integer, integer),
  public.prospect_facets(), public.refresh_prospect_counts(), public.upsert_prospect_lists(jsonb) TO authenticated;

-- the first live load stopped before it counted list members; count them now
UPDATE public.prospect_lists l SET member_count = coalesce((SELECT count(*) FROM public.prospect_list_members m WHERE m.list_id = l.id), 0);
