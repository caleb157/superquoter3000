-- Prospects load: the first live load stopped at about 45,000 records with "canceling statement due to statement timeout".
-- Root cause, reproduced locally under the app's role: with row-level security on, Postgres cannot use an expression
-- index (lower(domain), the normalized name) ahead of the policy check, so every company scanned all customers (and
-- every person all contacts), calling the policy function per row: about 11 s for 500 companies with 3,000 customers.
-- The two load functions now run as the table owner (SECURITY DEFINER) after one admin/team check at the start, so
-- the indexes are used and the policy is checked once per call, not once per row. Who made a change is still read
-- from the signed-in user.
-- Cause: each new company was matched against every customer with an OR over domain and a normalized name, which no
-- index could serve, and each person against every contact the same way. This adds the index for the name match,
-- splits both lookups so they use indexes, and turns off GIN fast update on the prospects text indexes so a batch never
-- pays for flushing a large pending list. Safe to re-run; changes no data.

CREATE INDEX IF NOT EXISTS idx_customers_prospect_norm_name ON public.customers (public.prospect_norm_name(coalesce(company, name)));

ALTER INDEX IF EXISTS public.idx_prospects_search SET (fastupdate = off);
ALTER INDEX IF EXISTS public.idx_prospects_name_trgm SET (fastupdate = off);
ALTER INDEX IF EXISTS public.idx_prospects_domain_trgm SET (fastupdate = off);
ALTER INDEX IF EXISTS public.idx_prospect_people_name_trgm SET (fastupdate = off);

CREATE OR REPLACE FUNCTION public.import_prospects(p_list_id text, p_rows jsonb, p_source text DEFAULT NULL, p_replace_list boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r jsonb; k text; d text; pid uuid; was_new boolean; created int := 0; updated int := 0; linked int := 0; skipped int := 0;
        cust record;
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can load prospects'; END IF;
  IF p_list_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prospect_lists WHERE id = p_list_id) THEN
    RAISE EXCEPTION 'No prospect list %', p_list_id;
  END IF;
  PERFORM set_config('app.importing', 'on', true);
  IF p_replace_list AND p_list_id IS NOT NULL THEN DELETE FROM prospect_list_members WHERE list_id = p_list_id; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF nullif(trim(coalesce(r->>'name','')), '') IS NULL THEN skipped := skipped + 1; CONTINUE; END IF;
    d := prospect_norm_domain(coalesce(nullif(r->>'domain',''), nullif(r->>'website','')));
    IF d ~ '(gmail|yahoo|hotmail|outlook|aol|icloud|linkedin|facebook|amazon|instagram)\.' THEN d := NULL; END IF;
    k := CASE WHEN d IS NOT NULL THEN 'd:' || d ELSE 'n:' || prospect_norm_name(r->>'name') || '|' || lower(coalesce(r->>'country','')) END;
    -- a name-keyed row that now has a domain: reuse the name-keyed prospect
    SELECT id INTO pid FROM prospects WHERE match_key = k;
    IF pid IS NULL AND d IS NOT NULL THEN
      SELECT id INTO pid FROM prospects WHERE match_key = 'n:' || prospect_norm_name(r->>'name') || '|' || lower(coalesce(r->>'country',''));
      IF pid IS NOT NULL THEN UPDATE prospects SET match_key = k WHERE id = pid; END IF;
    END IF;
    was_new := pid IS NULL;
    IF was_new THEN
      INSERT INTO prospects (match_key, name, domain) VALUES (k, trim(r->>'name'), d) RETURNING id INTO pid;
      created := created + 1;
    ELSE
      updated := updated + 1;
    END IF;
    UPDATE prospects p SET
      domain = coalesce(p.domain, d),
      website = coalesce(nullif(r->>'website',''), p.website),
      country = coalesce(nullif(r->>'country',''), p.country),
      state = coalesce(nullif(r->>'state',''), p.state),
      city = coalesce(nullif(r->>'city',''), p.city),
      prospect_type = coalesce(nullif(r->>'prospect_type',''), p.prospect_type),
      tags = (SELECT coalesce(array_agg(DISTINCT t ORDER BY t), '{}') FROM unnest(p.tags || coalesce(ARRAY(SELECT jsonb_array_elements_text(r->'tags')), '{}')) t WHERE t <> ''),
      industry = coalesce(nullif(r->>'industry',''), p.industry),
      employees = coalesce(nullif(r->>'employees','')::numeric::integer, p.employees),
      revenue = coalesce(nullif(r->>'revenue',''), p.revenue),
      linkedin_url = coalesce(nullif(r->>'linkedin_url',''), p.linkedin_url),
      email = coalesce(nullif(r->>'email',''), p.email),
      phone = coalesce(nullif(r->>'phone',''), p.phone),
      products = coalesce(nullif(r->>'products',''), p.products),
      trade_shipments = coalesce(nullif(r->>'trade_shipments','')::numeric::integer, p.trade_shipments),
      trade_value_2025 = coalesce(nullif(r->>'trade_value_2025','')::numeric, p.trade_value_2025),
      trade_last_shipment = coalesce(nullif(r->>'trade_last_shipment','')::date, p.trade_last_shipment),
      apollo_org_id = coalesce(nullif(r->>'apollo_org_id',''), p.apollo_org_id),
      best_contact = coalesce(nullif(r->>'best_contact',''), p.best_contact),
      best_contact_title = coalesce(nullif(r->>'best_contact_title',''), p.best_contact_title),
      score = coalesce(nullif(r->>'score','')::numeric, p.score),
      tier = coalesce(nullif(r->>'tier',''), p.tier),
      rank = coalesce(nullif(r->>'rank','')::numeric::integer, p.rank),
      scored_at = CASE WHEN nullif(r->>'score','') IS NOT NULL THEN now() ELSE p.scored_at END,
      sources = CASE WHEN p_source IS NULL OR p_source = ANY(p.sources) THEN p.sources ELSE p.sources || p_source END,
      data = p.data || coalesce(r->'data', '{}'::jsonb),
      dnc = p.dnc OR coalesce((r->>'dnc')::boolean, false),
      -- the source says excluded (failed the fit gate) or back in: only moves new <-> excluded, never a manual status
      status = CASE WHEN r->>'status' = 'excluded' AND p.status = 'new' THEN 'excluded'
                    WHEN r->>'status' = 'new' AND p.status = 'excluded' AND p.excluded_reason IS NOT DISTINCT FROM p.data->>'drop_reason' THEN 'new'
                    ELSE p.status END,
      excluded_reason = CASE WHEN r->>'status' = 'excluded' AND p.status IN ('new','excluded') THEN coalesce(nullif(r->>'excluded_reason',''), p.excluded_reason)
                             WHEN r->>'status' = 'new' AND p.status = 'excluded' THEN NULL ELSE p.excluded_reason END
    WHERE p.id = pid;
    IF p_list_id IS NOT NULL THEN
      INSERT INTO prospect_list_members (list_id, prospect_id, list_rank)
      VALUES (p_list_id, pid, nullif(r->>'list_rank','')::numeric::integer)
      ON CONFLICT (list_id, prospect_id) DO UPDATE SET list_rank = coalesce(EXCLUDED.list_rank, prospect_list_members.list_rank);
    END IF;
    -- per-row lists: [{"id": "...", "rank": n}] or ["..."]; unknown list ids are skipped
    INSERT INTO prospect_list_members (list_id, prospect_id, list_rank)
    SELECT l.lid, pid, l.lrank FROM (
      SELECT CASE WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}' ELSE e->>'id' END AS lid,
             CASE WHEN jsonb_typeof(e) = 'object' THEN nullif(e->>'rank','')::numeric::integer END AS lrank
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r->'lists') = 'array' THEN r->'lists' ELSE '[]'::jsonb END) e) l
    WHERE EXISTS (SELECT 1 FROM prospect_lists pl WHERE pl.id = l.lid)
    ON CONFLICT (list_id, prospect_id) DO UPDATE SET list_rank = coalesce(EXCLUDED.list_rank, prospect_list_members.list_rank);
    -- already an account in PD HQ? link it (domain first, then exact company name)
    IF (SELECT customer_id FROM prospects WHERE id = pid) IS NULL THEN
      -- two indexed lookups (an OR here scanned every customer for every row and hit the statement timeout)
      SELECT x.id, x.dnc INTO cust FROM (
        SELECT c.id, c.dnc, 1 AS o FROM customers c WHERE d IS NOT NULL AND lower(c.domain) = d
        UNION ALL
        SELECT c.id, c.dnc, 2 FROM customers c WHERE prospect_norm_name(coalesce(c.company, c.name)) = prospect_norm_name(r->>'name')
      ) x ORDER BY x.o LIMIT 1;
      IF cust.id IS NOT NULL THEN
        UPDATE prospects SET customer_id = cust.id, dnc = dnc OR coalesce(cust.dnc, false),
          status = CASE WHEN status IN ('new','researching','ready') THEN 'promoted' ELSE status END
        WHERE id = pid;
        linked := linked + 1;
      END IF;
    END IF;
  END LOOP;
  PERFORM set_config('app.importing', '', true);
  RETURN jsonb_build_object('created', created, 'updated', updated, 'linked_to_accounts', linked, 'skipped', skipped);
END $$;

CREATE OR REPLACE FUNCTION public.import_prospect_people(p_rows jsonb, p_source text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r jsonb; k text; d text; pk text; pid uuid; li text; em text; created int := 0; updated int := 0; skipped int := 0; ex uuid; touched uuid[] := '{}';
BEGIN
  IF NOT public.is_admin_or_team(auth.uid()) THEN RAISE EXCEPTION 'Only admin or team can load prospects'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF nullif(trim(coalesce(r->>'full_name','')), '') IS NULL THEN skipped := skipped + 1; CONTINUE; END IF;
    li := nullif(regexp_replace(lower(trim(coalesce(r->>'linkedin_url',''))), '^https?://([a-z]+\.)?linkedin\.com/in/([^/?#]+).*$', 'https://www.linkedin.com/in/\2'), '');
    em := nullif(lower(trim(coalesce(r->>'email',''))), '');
    pid := NULL;
    IF nullif(trim(coalesce(r->>'company','')), '') IS NOT NULL THEN
      d := prospect_norm_domain(r->>'domain');
      IF d IS NULL AND em LIKE '%@%' AND em !~ '@(gmail|yahoo|hotmail|outlook|aol|icloud)\.' THEN d := split_part(em, '@', 2); END IF;
      pk := CASE WHEN d IS NOT NULL THEN 'd:' || d ELSE 'n:' || prospect_norm_name(r->>'company') || '|' || lower(coalesce(r->>'country','')) END;
      SELECT id INTO pid FROM prospects WHERE match_key = pk;
      IF pid IS NULL AND d IS NULL THEN
        SELECT id INTO pid FROM prospects WHERE prospect_norm_name(name) = prospect_norm_name(r->>'company') LIMIT 1;
      END IF;
      IF pid IS NULL THEN
        INSERT INTO prospects (match_key, name, domain, country, sources) VALUES (pk, trim(r->>'company'), d, nullif(r->>'country',''),
          CASE WHEN p_source IS NULL THEN '{}' ELSE ARRAY[p_source] END) RETURNING id INTO pid;
      END IF;
    END IF;
    k := CASE WHEN li IS NOT NULL THEN 'li:' || li WHEN em IS NOT NULL THEN 'e:' || em
              ELSE 'n:' || lower(trim(r->>'full_name')) || '|' || coalesce(pid::text, '') END;
    SELECT id INTO ex FROM prospect_people WHERE match_key = k;
    IF ex IS NULL THEN
      INSERT INTO prospect_people (match_key, full_name, prospect_id) VALUES (k, trim(r->>'full_name'), pid) RETURNING id INTO ex;
      created := created + 1;
    ELSE updated := updated + 1; END IF;
    UPDATE prospect_people pp SET
      prospect_id = coalesce(pp.prospect_id, pid),
      title = coalesce(nullif(r->>'title',''), pp.title),
      linkedin_url = coalesce(li, pp.linkedin_url),
      email = coalesce(em, pp.email),
      location = coalesce(nullif(r->>'location',''), pp.location),
      source = coalesce(pp.source, nullif(r->>'source',''), p_source),
      outreach_state = coalesce(nullif(r->>'outreach_state',''), pp.outreach_state),
      score = coalesce(nullif(r->>'score','')::numeric, pp.score),
      decision_maker = coalesce((r->>'decision_maker')::boolean, pp.decision_maker),
      contact_id = coalesce(pp.contact_id, coalesce((SELECT c.id FROM contacts c WHERE li IS NOT NULL AND lower(c.linkedin_url) = li LIMIT 1), (SELECT c.id FROM contacts c WHERE em IS NOT NULL AND lower(c.email) = em LIMIT 1))),
      data = pp.data || coalesce(r->'data', '{}'::jsonb)
    WHERE pp.id = ex;
    UPDATE prospect_people pp SET dnc = true FROM contacts c WHERE pp.id = ex AND c.id = pp.contact_id AND c.dnc;
    IF pid IS NOT NULL THEN touched := touched || pid; END IF;
    IF pid IS NOT NULL AND jsonb_typeof(r->'lists') = 'array' THEN
      INSERT INTO prospect_list_members (list_id, prospect_id)
      SELECT l, pid FROM jsonb_array_elements_text(r->'lists') l WHERE EXISTS (SELECT 1 FROM prospect_lists pl WHERE pl.id = l)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  -- people count and best contact for the prospects this batch touched
  UPDATE prospects p SET people_count = s.n, best_contact = coalesce(p.best_contact, s.best), best_contact_title = coalesce(p.best_contact_title, s.best_title)
  FROM (SELECT prospect_id, count(*) n,
          (array_agg(full_name ORDER BY decision_maker DESC NULLS LAST, score DESC NULLS LAST))[1] best,
          (array_agg(title ORDER BY decision_maker DESC NULLS LAST, score DESC NULLS LAST))[1] best_title
        FROM prospect_people WHERE prospect_id = ANY(touched) GROUP BY prospect_id) s
  WHERE p.id = s.prospect_id;
  RETURN jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped);
END $$;

REVOKE ALL ON FUNCTION public.import_prospects(text, jsonb, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_prospect_people(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_prospects(text, jsonb, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_prospect_people(jsonb, text) TO authenticated;
