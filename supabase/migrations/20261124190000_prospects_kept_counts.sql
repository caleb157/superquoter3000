-- Prospects: counts kept as rows change, so the page never counts 100k+ companies on load.
-- After 0024 the live prospect_facets still hit the 8 s statement timeout (it scans prospects seven times).
-- prospect_facet_counts holds one row per filter value (type, tier, country, status, in CRM, tag, plus the total).
-- Statement-level triggers add each batch's change, so a 500-row import costs one small grouped insert.
-- prospect_lists.member_count is kept the same way. search_prospects counts at most 10,001 rows ("capped").
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.prospect_facet_counts (
  dim text NOT NULL,
  v text NOT NULL,
  n bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (dim, v)
);
ALTER TABLE public.prospect_facet_counts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team read prospect_facet_counts" ON public.prospect_facet_counts;
CREATE POLICY "Admin/team read prospect_facet_counts" ON public.prospect_facet_counts FOR SELECT TO authenticated USING (public.is_admin_or_team(auth.uid()));
GRANT SELECT ON public.prospect_facet_counts TO authenticated;

CREATE OR REPLACE FUNCTION public.prospects_counts_ins()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO prospect_facet_counts (dim, v, n)
  WITH d AS (SELECT 1 AS s, prospect_type, effective_tier, country, status, customer_id, tags FROM new_rows),
  e AS (
    SELECT 'total'::text AS dim, ''::text AS v, s FROM d
    UNION ALL SELECT 'type', prospect_type, s FROM d WHERE prospect_type IS NOT NULL
    UNION ALL SELECT 'tier', effective_tier, s FROM d WHERE effective_tier IS NOT NULL
    UNION ALL SELECT 'country', country, s FROM d WHERE country IS NOT NULL
    UNION ALL SELECT 'status', status, s FROM d WHERE status IS NOT NULL
    UNION ALL SELECT 'in_crm', (customer_id IS NOT NULL)::text, s FROM d
    UNION ALL SELECT 'tag', t, s FROM d, unnest(coalesce(tags, '{}'::text[])) t WHERE t IS NOT NULL)
  SELECT dim, v, sum(s) FROM e GROUP BY dim, v HAVING sum(s) <> 0
  ON CONFLICT (dim, v) DO UPDATE SET n = prospect_facet_counts.n + EXCLUDED.n;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.prospects_counts_upd()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO prospect_facet_counts (dim, v, n)
  WITH d AS (SELECT 1 AS s, prospect_type, effective_tier, country, status, customer_id, tags FROM new_rows UNION ALL SELECT -1, prospect_type, effective_tier, country, status, customer_id, tags FROM old_rows),
  e AS (
    SELECT 'total'::text AS dim, ''::text AS v, s FROM d
    UNION ALL SELECT 'type', prospect_type, s FROM d WHERE prospect_type IS NOT NULL
    UNION ALL SELECT 'tier', effective_tier, s FROM d WHERE effective_tier IS NOT NULL
    UNION ALL SELECT 'country', country, s FROM d WHERE country IS NOT NULL
    UNION ALL SELECT 'status', status, s FROM d WHERE status IS NOT NULL
    UNION ALL SELECT 'in_crm', (customer_id IS NOT NULL)::text, s FROM d
    UNION ALL SELECT 'tag', t, s FROM d, unnest(coalesce(tags, '{}'::text[])) t WHERE t IS NOT NULL)
  SELECT dim, v, sum(s) FROM e GROUP BY dim, v HAVING sum(s) <> 0
  ON CONFLICT (dim, v) DO UPDATE SET n = prospect_facet_counts.n + EXCLUDED.n;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.prospects_counts_del()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO prospect_facet_counts (dim, v, n)
  WITH d AS (SELECT -1 AS s, prospect_type, effective_tier, country, status, customer_id, tags FROM old_rows),
  e AS (
    SELECT 'total'::text AS dim, ''::text AS v, s FROM d
    UNION ALL SELECT 'type', prospect_type, s FROM d WHERE prospect_type IS NOT NULL
    UNION ALL SELECT 'tier', effective_tier, s FROM d WHERE effective_tier IS NOT NULL
    UNION ALL SELECT 'country', country, s FROM d WHERE country IS NOT NULL
    UNION ALL SELECT 'status', status, s FROM d WHERE status IS NOT NULL
    UNION ALL SELECT 'in_crm', (customer_id IS NOT NULL)::text, s FROM d
    UNION ALL SELECT 'tag', t, s FROM d, unnest(coalesce(tags, '{}'::text[])) t WHERE t IS NOT NULL)
  SELECT dim, v, sum(s) FROM e GROUP BY dim, v HAVING sum(s) <> 0
  ON CONFLICT (dim, v) DO UPDATE SET n = prospect_facet_counts.n + EXCLUDED.n;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.prospect_members_count_ins()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE prospect_lists l SET member_count = coalesce(l.member_count, 0) + x.n
  FROM (SELECT list_id, count(*) AS n FROM new_rows GROUP BY list_id) x WHERE l.id = x.list_id;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.prospect_members_count_del()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  UPDATE prospect_lists l SET member_count = greatest(coalesce(l.member_count, 0) - x.n, 0)
  FROM (SELECT list_id, count(*) AS n FROM old_rows GROUP BY list_id) x WHERE l.id = x.list_id;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.prospects_counts_ins(), public.prospects_counts_upd(), public.prospects_counts_del(),
  public.prospect_members_count_ins(), public.prospect_members_count_del() FROM PUBLIC, anon, authenticated;

-- rebuild every count from the tables, with writers held off so no batch is missed
CREATE OR REPLACE FUNCTION public.prospect_counts_rebuild()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  LOCK TABLE prospects, prospect_list_members IN SHARE MODE;
  DELETE FROM prospect_facet_counts;
  INSERT INTO prospect_facet_counts (dim, v, n)
  WITH d AS (SELECT 1 AS s, prospect_type, effective_tier, country, status, customer_id, tags FROM prospects),
  e AS (
    SELECT 'total'::text AS dim, ''::text AS v, s FROM d
    UNION ALL SELECT 'type', prospect_type, s FROM d WHERE prospect_type IS NOT NULL
    UNION ALL SELECT 'tier', effective_tier, s FROM d WHERE effective_tier IS NOT NULL
    UNION ALL SELECT 'country', country, s FROM d WHERE country IS NOT NULL
    UNION ALL SELECT 'status', status, s FROM d WHERE status IS NOT NULL
    UNION ALL SELECT 'in_crm', (customer_id IS NOT NULL)::text, s FROM d
    UNION ALL SELECT 'tag', t, s FROM d, unnest(coalesce(tags, '{}'::text[])) t WHERE t IS NOT NULL)
  SELECT dim, v, sum(s) FROM e GROUP BY dim, v;
  UPDATE prospect_lists l SET member_count = coalesce((SELECT count(*) FROM prospect_list_members m WHERE m.list_id = l.id), 0);
END $$;
REVOKE ALL ON FUNCTION public.prospect_counts_rebuild() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prospects_counts_ins ON public.prospects;
DROP TRIGGER IF EXISTS trg_prospects_counts_upd ON public.prospects;
DROP TRIGGER IF EXISTS trg_prospects_counts_del ON public.prospects;
CREATE TRIGGER trg_prospects_counts_ins AFTER INSERT ON public.prospects REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.prospects_counts_ins();
CREATE TRIGGER trg_prospects_counts_upd AFTER UPDATE ON public.prospects REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.prospects_counts_upd();
CREATE TRIGGER trg_prospects_counts_del AFTER DELETE ON public.prospects REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.prospects_counts_del();
DROP TRIGGER IF EXISTS trg_prospect_members_count_ins ON public.prospect_list_members;
DROP TRIGGER IF EXISTS trg_prospect_members_count_del ON public.prospect_list_members;
CREATE TRIGGER trg_prospect_members_count_ins AFTER INSERT ON public.prospect_list_members REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.prospect_members_count_ins();
CREATE TRIGGER trg_prospect_members_count_del AFTER DELETE ON public.prospect_list_members REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.prospect_members_count_del();

SELECT public.prospect_counts_rebuild();

-- the page's counts: read from the kept rows, no scan of prospects
CREATE OR REPLACE FUNCTION public.prospect_facets()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can use Prospects'; END IF;
  RETURN jsonb_build_object(
    'total', coalesce((SELECT n FROM prospect_facet_counts WHERE dim = 'total' AND v = ''), 0),
    'lists', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'n', member_count, 'run_date', run_date, 'description', description) ORDER BY sort_order, run_date DESC NULLS LAST, name), '[]') FROM prospect_lists WHERE NOT archived),
    'types', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY n DESC), '[]') FROM (SELECT v, n FROM prospect_facet_counts WHERE dim = 'type' AND n > 0 ORDER BY n DESC LIMIT 30) t),
    'tiers', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY v), '[]') FROM prospect_facet_counts WHERE dim = 'tier' AND n > 0),
    'countries', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY n DESC), '[]') FROM (SELECT v, n FROM prospect_facet_counts WHERE dim = 'country' AND n > 0 ORDER BY n DESC LIMIT 25) t),
    'tags', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n) ORDER BY n DESC), '[]') FROM (SELECT v, n FROM prospect_facet_counts WHERE dim = 'tag' AND n > 0 ORDER BY n DESC LIMIT 25) t),
    'status', (SELECT coalesce(jsonb_agg(jsonb_build_object('v', v, 'n', n)), '[]') FROM prospect_facet_counts WHERE dim = 'status' AND n > 0),
    'in_crm', coalesce((SELECT n FROM prospect_facet_counts WHERE dim = 'in_crm' AND v = 'true'), 0)
  );
END $$;

-- kept for the loader and the connector; the counts are already current, so this only re-checks the list totals
CREATE OR REPLACE FUNCTION public.refresh_prospect_counts()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can use Prospects'; END IF;
  UPDATE prospect_lists l SET member_count = coalesce((SELECT count(*) FROM prospect_list_members m WHERE m.list_id = l.id), 0);
END $$;

CREATE OR REPLACE FUNCTION public.search_prospects(
  p_q text DEFAULT NULL, p_lists text[] DEFAULT NULL, p_types text[] DEFAULT NULL, p_tiers text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL, p_tags text[] DEFAULT NULL, p_status text[] DEFAULT NULL,
  p_in_crm boolean DEFAULT NULL, p_has_people boolean DEFAULT NULL, p_sort text DEFAULT 'rank',
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE capped boolean := false; q text := nullif(trim(coalesce(p_q,'')), ''); tsq tsquery; total bigint; ids uuid[]; out jsonb;
        lim int := least(greatest(coalesce(p_limit, 50), 1), 500); off int := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can use Prospects'; END IF;
  IF q IS NOT NULL THEN
    tsq := nullif(array_to_string(ARRAY(SELECT regexp_replace(w, '[^a-z0-9]', '', 'g') || ':*'
             FROM unnest(regexp_split_to_array(lower(q), '\s+')) w WHERE regexp_replace(w, '[^a-z0-9]', '', 'g') <> ''), ' & '), '')::tsquery;
  END IF;
  -- count at most 10,001 rows so a page load never walks the whole table; the plain default view takes its total from the kept counts
  IF q IS NULL AND p_lists IS NULL AND p_types IS NULL AND p_tiers IS NULL AND p_countries IS NULL AND p_tags IS NULL AND p_in_crm IS NULL AND p_has_people IS NULL THEN
    SELECT coalesce(sum(n), 0) INTO total FROM prospect_facet_counts WHERE dim = 'status' AND (p_status IS NULL OR v = ANY(p_status));
  ELSE
    SELECT count(*) INTO total FROM (SELECT 1 FROM prospects p WHERE (q IS NULL OR (tsq IS NOT NULL AND p.search @@ tsq) OR p.name ILIKE '%' || q || '%' OR p.domain ILIKE '%' || q || '%')
      AND (p_lists IS NULL OR EXISTS (SELECT 1 FROM prospect_list_members m WHERE m.prospect_id = p.id AND m.list_id = ANY(p_lists)))
      AND (p_types IS NULL OR p.prospect_type = ANY(p_types))
      AND (p_tiers IS NULL OR p.effective_tier = ANY(p_tiers))
      AND (p_countries IS NULL OR p.country = ANY(p_countries))
      AND (p_tags IS NULL OR p.tags && p_tags)
      AND (p_status IS NULL OR p.status = ANY(p_status))
      AND (p_in_crm IS NULL OR (p.customer_id IS NOT NULL) = p_in_crm)
      AND (p_has_people IS NULL OR (p.people_count > 0) = p_has_people) LIMIT 10001) c;
    capped := total > 10000;
  END IF;
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
  RETURN jsonb_build_object('total', total, 'capped', capped, 'rows', out);
END $$;

REVOKE ALL ON FUNCTION public.search_prospects(text, text[], text[], text[], text[], text[], text[], boolean, boolean, text, integer, integer),
  public.prospect_facets(), public.refresh_prospect_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_prospects(text, text[], text[], text[], text[], text[], text[], boolean, boolean, text, integer, integer),
  public.prospect_facets(), public.refresh_prospect_counts() TO authenticated;
