-- Sales section, Phase 3: the whole prospect universe in PD HQ.
-- prospects = every company we know of (raw pool, filtered TAM, research picks, trade buyers, Waalaxy, Apollo, LinkedIn),
-- prospect_lists + prospect_list_members = the lists the playbooks build (a prospect can sit on many),
-- prospect_people = people at a prospect, prospect_events = every manual rank move, promotion or exclusion.
-- Accounts we actually work stay in customers; promote_prospect() moves a prospect into the pipeline (Queued).
-- Imports write score/tier/rank only; Caleb's manual tier and pin are never touched by a re-score.
-- Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------- lists ----------
CREATE TABLE IF NOT EXISTS public.prospect_lists (
  id text PRIMARY KEY,                       -- slug, e.g. 'tam-filtered', 'research-2026-11-23'
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'custom' CHECK (kind IN
    ('tam_raw','tam_filtered','research','trade_research','weekly_outreach','waalaxy','apollo','linkedin','customers','custom')),
  description text,
  source_file text,
  run_date date,
  sort_order integer NOT NULL DEFAULT 100,
  member_count integer NOT NULL DEFAULT 0,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- prospects ----------
CREATE TABLE IF NOT EXISTS public.prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_key text NOT NULL UNIQUE,            -- 'd:<domain>' when we know the domain, else 'n:<normalized name>|<country>'
  name text NOT NULL,
  domain text,
  website text,
  country text,
  state text,
  city text,
  prospect_type text,                        -- main type from the scoring (decor e-commerce, furniture importer, trade buyer, ...)
  tags text[] NOT NULL DEFAULT '{}',         -- amazon_seller, trade_buyer, wayfair, us, ...
  industry text,
  employees integer,
  revenue text,
  linkedin_url text,
  email text,
  phone text,
  products text,                             -- what they buy or sell, for search
  trade_shipments integer,
  trade_value_2025 numeric,
  trade_last_shipment date,
  apollo_org_id text,
  people_count integer NOT NULL DEFAULT 0,
  best_contact text,
  best_contact_title text,
  score numeric,                             -- latest score from the playbook scoring
  tier text,                                 -- latest tier from the scoring (A, B, C, D)
  rank integer,                              -- latest rank from the scoring (1 = best)
  tier_override text CHECK (tier_override IS NULL OR tier_override IN ('A','B','C','D','X')),
  pinned boolean NOT NULL DEFAULT false,     -- pinned to the top of its tier
  effective_tier text GENERATED ALWAYS AS (coalesce(tier_override, tier, 'D')) STORED,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','researching','ready','promoted','excluded')),
  excluded_reason text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  dnc boolean NOT NULL DEFAULT false,
  sources text[] NOT NULL DEFAULT '{}',      -- files it came from
  data jsonb NOT NULL DEFAULT '{}'::jsonb,   -- every other column from the source files
  scored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(domain,'') || ' ' || coalesce(city,'') || ' ' || coalesce(state,'') || ' ' ||
      coalesce(country,'') || ' ' || coalesce(prospect_type,'') || ' ' || coalesce(industry,'') || ' ' || coalesce(products,'') || ' ' || coalesce(best_contact,''))
  ) STORED
);
CREATE INDEX IF NOT EXISTS idx_prospects_search ON public.prospects USING gin (search);
CREATE INDEX IF NOT EXISTS idx_prospects_name_trgm ON public.prospects USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_prospects_domain ON public.prospects (domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prospects_domain_trgm ON public.prospects USING gin (domain extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_prospects_rank ON public.prospects (effective_tier, pinned DESC, score DESC NULLS LAST, id);
CREATE INDEX IF NOT EXISTS idx_prospects_type ON public.prospects (prospect_type);
CREATE INDEX IF NOT EXISTS idx_prospects_country ON public.prospects (country);
CREATE INDEX IF NOT EXISTS idx_prospects_status ON public.prospects (status);
CREATE INDEX IF NOT EXISTS idx_prospects_tags ON public.prospects USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_prospects_customer ON public.prospects (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.prospect_list_members (
  list_id text NOT NULL REFERENCES public.prospect_lists(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  list_rank integer,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, prospect_id)
);
CREATE INDEX IF NOT EXISTS idx_prospect_list_members_prospect ON public.prospect_list_members (prospect_id);

CREATE TABLE IF NOT EXISTS public.prospect_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid REFERENCES public.prospects(id) ON DELETE CASCADE,
  match_key text NOT NULL UNIQUE,            -- 'li:<linkedin url>' or 'e:<email>' or 'n:<name>|<prospect>'
  full_name text NOT NULL,
  title text,
  linkedin_url text,
  email text,
  location text,
  source text,
  outreach_state text,                       -- e.g. Waalaxy state: invited, connected, replied
  score numeric,
  decision_maker boolean,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  dnc boolean NOT NULL DEFAULT false,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospect_people_prospect ON public.prospect_people (prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_people_name_trgm ON public.prospect_people USING gin (full_name extensions.gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.prospect_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.prospects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('tier','pin','status','promote','note','import')),
  from_value text,
  to_value text,
  reason text,
  actor text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospect_events_prospect ON public.prospect_events (prospect_id, occurred_at DESC);

-- What runs on a schedule (playbook jobs), so the Jobs tab shows what is set up, not only what has reported.
CREATE TABLE IF NOT EXISTS public.sales_schedules (
  id text PRIMARY KEY,
  job text NOT NULL,
  name text NOT NULL,
  cadence text NOT NULL,                     -- plain words, e.g. 'Mon-Fri 9:44 and 15:58 IST'
  cron text,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  runs_where text,                           -- cloud task, Mac, manual
  what_it_does text,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live','paused','planned','retired')),
  sort_order integer NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- housekeeping ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['prospect_lists','prospects','prospect_people','sales_schedules'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['prospect_lists','prospects','prospect_list_members','prospect_people','prospect_events','sales_schedules'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin/team manage %1$s" ON public.%1$s', t);
    EXECUTE format('CREATE POLICY "Admin/team manage %1$s" ON public.%1$s FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Manual tier and pin moves are logged with who and why; a promoted or excluded prospect logs its status change.
CREATE OR REPLACE FUNCTION public.prospects_log_manual()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE who text := coalesce(nullif(current_setting('app.actor', true), ''), (SELECT email FROM auth.users WHERE id = auth.uid()), 'system');
        why text := nullif(current_setting('app.reason', true), '');
BEGIN
  IF NEW.tier_override IS DISTINCT FROM OLD.tier_override THEN
    INSERT INTO prospect_events (prospect_id, kind, from_value, to_value, reason, actor)
    VALUES (NEW.id, 'tier', coalesce(OLD.tier_override, OLD.tier), coalesce(NEW.tier_override, NEW.tier), why, who);
  END IF;
  IF NEW.pinned IS DISTINCT FROM OLD.pinned THEN
    INSERT INTO prospect_events (prospect_id, kind, from_value, to_value, reason, actor)
    VALUES (NEW.id, 'pin', OLD.pinned::text, NEW.pinned::text, why, who);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO prospect_events (prospect_id, kind, from_value, to_value, reason, actor)
    VALUES (NEW.id, CASE WHEN NEW.status = 'promoted' THEN 'promote' ELSE 'status' END, OLD.status, NEW.status, coalesce(why, NEW.excluded_reason), who);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_prospects_log_manual ON public.prospects;
CREATE TRIGGER trg_prospects_log_manual AFTER UPDATE OF tier_override, pinned, status ON public.prospects
  FOR EACH ROW EXECUTE FUNCTION public.prospects_log_manual();

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION public.prospect_norm_name(n text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(regexp_replace(lower(coalesce(n,'')),
    '\m(inc|llc|ltd|limited|co|corp|corporation|company|the|gmbh|pvt|plc|lp|llp)\M\.?', '', 'g'), '[^a-z0-9]+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.prospect_norm_domain(d text)
 RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(regexp_replace(regexp_replace(lower(trim(coalesce(d,''))), '^[a-z]+://', ''), '^www\.', ''), '[/?#:].*$', ''), '')
$$;

CREATE INDEX IF NOT EXISTS idx_prospects_norm_name ON public.prospects (public.prospect_norm_name(name));

-- ---------- import ----------
-- rows: [{name, domain, website, country, state, city, prospect_type, tags[], industry, employees, revenue, linkedin_url, email, phone,
--         products, trade_shipments, trade_value_2025, trade_last_shipment, apollo_org_id, best_contact, best_contact_title,
--         score, tier, rank, list_rank, data{}}]
-- Upserts on match_key, adds every row to the list, links rows to existing customers by domain or exact name,
-- copies do not contact from the account. Never writes tier_override, pinned, status (except new -> promoted when linked).
CREATE OR REPLACE FUNCTION public.import_prospects(p_list_id text, p_rows jsonb, p_source text DEFAULT NULL, p_replace_list boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE r jsonb; k text; d text; pid uuid; was_new boolean; created int := 0; updated int := 0; linked int := 0; skipped int := 0;
        cust record;
BEGIN
  IF p_list_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM prospect_lists WHERE id = p_list_id) THEN
    RAISE EXCEPTION 'No prospect list %', p_list_id;
  END IF;
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
      SELECT c.id, c.dnc INTO cust FROM customers c
       WHERE (d IS NOT NULL AND lower(c.domain) = d)
          OR prospect_norm_name(coalesce(c.company, c.name)) = prospect_norm_name(r->>'name')
       ORDER BY (d IS NOT NULL AND lower(c.domain) = d) DESC LIMIT 1;
      IF cust.id IS NOT NULL THEN
        UPDATE prospects SET customer_id = cust.id, dnc = dnc OR coalesce(cust.dnc, false),
          status = CASE WHEN status IN ('new','researching','ready') THEN 'promoted' ELSE status END
        WHERE id = pid;
        linked := linked + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created', created, 'updated', updated, 'linked_to_accounts', linked, 'skipped', skipped);
END $$;

-- people: [{full_name, title, linkedin_url, email, location, source, outreach_state, score, decision_maker, company, domain, country, data{}}]
-- Each person is attached to a prospect found by domain or company name (one is created when missing, on no list).
CREATE OR REPLACE FUNCTION public.import_prospect_people(p_rows jsonb, p_source text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE r jsonb; k text; d text; pk text; pid uuid; li text; em text; created int := 0; updated int := 0; skipped int := 0; ex uuid; touched uuid[] := '{}';
BEGIN
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
      source = coalesce(pp.source, p_source, nullif(r->>'source','')),
      outreach_state = coalesce(nullif(r->>'outreach_state',''), pp.outreach_state),
      score = coalesce(nullif(r->>'score','')::numeric, pp.score),
      decision_maker = coalesce((r->>'decision_maker')::boolean, pp.decision_maker),
      contact_id = coalesce(pp.contact_id, (SELECT c.id FROM contacts c WHERE (li IS NOT NULL AND c.linkedin_url = li) OR (em IS NOT NULL AND lower(c.email) = em) LIMIT 1)),
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

-- Lists: upsert the list rows of a load file, and refresh member counts after a load.
CREATE OR REPLACE FUNCTION public.upsert_prospect_lists(p_lists jsonb)
 RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
AS $$
  WITH up AS (
    INSERT INTO prospect_lists (id, name, kind, description, source_file, run_date, sort_order)
    SELECT e->>'id', e->>'name', coalesce(e->>'kind','custom'), e->>'description', e->>'source_file', nullif(e->>'run_date','')::date,
           coalesce(nullif(e->>'sort_order','')::int, 100)
    FROM jsonb_array_elements(p_lists) e WHERE coalesce(e->>'id','') <> '' AND coalesce(e->>'name','') <> ''
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind, description = EXCLUDED.description,
      source_file = EXCLUDED.source_file, run_date = EXCLUDED.run_date, sort_order = EXCLUDED.sort_order
    RETURNING 1)
  SELECT count(*)::int FROM up
$$;

CREATE OR REPLACE FUNCTION public.refresh_prospect_counts()
 RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path TO 'public'
AS $$
  UPDATE prospect_lists l SET member_count = coalesce((SELECT count(*) FROM prospect_list_members m WHERE m.list_id = l.id), 0);
$$;

-- ---------- search ----------
-- One call for the Prospects page and the connector: full text + fuzzy name, list / type / tier / country / tag / status filters,
-- ordered by effective tier, pin, score. Returns {total, rows}. total is exact up to 10,000, then estimated.
CREATE OR REPLACE FUNCTION public.search_prospects(
  p_q text DEFAULT NULL, p_lists text[] DEFAULT NULL, p_types text[] DEFAULT NULL, p_tiers text[] DEFAULT NULL,
  p_countries text[] DEFAULT NULL, p_tags text[] DEFAULT NULL, p_status text[] DEFAULT NULL,
  p_in_crm boolean DEFAULT NULL, p_has_people boolean DEFAULT NULL, p_sort text DEFAULT 'rank',
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public', 'extensions'
AS $$
DECLARE q text := nullif(trim(coalesce(p_q,'')), ''); tsq tsquery; total bigint; ids uuid[]; out jsonb;
        lim int := least(greatest(coalesce(p_limit, 50), 1), 500); off int := greatest(coalesce(p_offset, 0), 0);
BEGIN
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

-- Counts for the filter chips: per list, per type, per tier, per country, per status.
CREATE OR REPLACE FUNCTION public.prospect_facets()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
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
$$;

-- ---------- manual moves ----------
-- Move a prospect up or down a tier (or set one), pin it, with a reason. Logged by the trigger.
CREATE OR REPLACE FUNCTION public.set_prospect_rank(p_id uuid, p_tier text DEFAULT NULL, p_move integer DEFAULT NULL, p_pinned boolean DEFAULT NULL, p_reason text DEFAULT NULL, p_actor text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE cur text; nxt text; tiers text[] := ARRAY['A','B','C','D']; i int; row prospects;
BEGIN
  SELECT * INTO row FROM prospects WHERE id = p_id;
  IF row.id IS NULL THEN RAISE EXCEPTION 'No prospect %', p_id; END IF;
  PERFORM set_config('app.reason', coalesce(p_reason, ''), true);
  IF p_actor IS NOT NULL THEN PERFORM set_config('app.actor', p_actor, true); END IF;
  cur := row.effective_tier;
  nxt := row.tier_override;
  IF p_tier IS NOT NULL THEN
    nxt := CASE WHEN p_tier = 'auto' THEN NULL ELSE p_tier END;
  ELSIF p_move IS NOT NULL AND p_move <> 0 THEN
    i := coalesce(array_position(tiers, cur), 4) - p_move;   -- move +1 = one tier up (D -> C)
    nxt := tiers[greatest(1, least(4, i))];
  END IF;
  UPDATE prospects SET tier_override = nxt, pinned = coalesce(p_pinned, pinned) WHERE id = p_id RETURNING * INTO row;
  RETURN jsonb_build_object('id', row.id, 'tier', row.tier, 'tier_override', row.tier_override, 'effective_tier', row.effective_tier, 'pinned', row.pinned);
END $$;

-- Put a prospect into the pipeline: find its account (domain, then name) or add one as a Queued prospect, copy people
-- into contacts, link everything. Refuses do not contact.
CREATE OR REPLACE FUNCTION public.promote_prospect(p_id uuid, p_reason text DEFAULT NULL, p_owner text DEFAULT 'CQ')
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE p prospects; cid uuid; made boolean := false; people int := 0;
BEGIN
  SELECT * INTO p FROM prospects WHERE id = p_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'No prospect %', p_id; END IF;
  IF p.dnc THEN RAISE EXCEPTION '% is on do not contact', p.name; END IF;
  cid := p.customer_id;
  IF cid IS NULL THEN
    SELECT id INTO cid FROM customers c
     WHERE (p.domain IS NOT NULL AND lower(c.domain) = p.domain) OR prospect_norm_name(coalesce(c.company, c.name)) = prospect_norm_name(p.name)
     ORDER BY (p.domain IS NOT NULL AND lower(c.domain) = p.domain) DESC LIMIT 1;
  END IF;
  IF cid IS NULL THEN
    INSERT INTO customers (name, company, domain, website, country, customer_type, persona, fit_score, owner, source, lead_status, sales_stage, linkedin_url, email, notes)
    VALUES (p.name, p.name, p.domain, p.website, p.country, p.prospect_type, p.prospect_type,
            CASE WHEN p.score IS NULL THEN NULL ELSE least(100, greatest(0, round(p.score)))::int END, p_owner,
            'Prospects: ' || coalesce(array_to_string(p.sources, ', '), 'manual'), 'prospect', 'queued', p.linkedin_url, p.email, p_reason)
    RETURNING id INTO cid;
    made := true;
  ELSIF (SELECT dnc FROM customers WHERE id = cid) THEN
    UPDATE prospects SET dnc = true, customer_id = cid WHERE id = p_id;
    RAISE EXCEPTION '% is on do not contact', p.name;
  ELSE
    UPDATE customers SET sales_stage = 'queued' WHERE id = cid AND sales_stage IS NULL;
  END IF;
  INSERT INTO contacts (customer_id, full_name, title, linkedin_url, email)
  SELECT cid, pp.full_name, pp.title, pp.linkedin_url, pp.email FROM prospect_people pp
   WHERE pp.prospect_id = p_id AND pp.contact_id IS NULL AND NOT pp.dnc
     AND NOT EXISTS (SELECT 1 FROM contacts c WHERE (pp.linkedin_url IS NOT NULL AND c.linkedin_url = pp.linkedin_url) OR (pp.email IS NOT NULL AND lower(c.email) = lower(pp.email)));
  GET DIAGNOSTICS people = ROW_COUNT;
  UPDATE prospect_people pp SET contact_id = c.id FROM contacts c
   WHERE pp.prospect_id = p_id AND pp.contact_id IS NULL AND c.customer_id = cid
     AND ((pp.linkedin_url IS NOT NULL AND c.linkedin_url = pp.linkedin_url) OR (pp.email IS NOT NULL AND lower(c.email) = lower(pp.email)) OR lower(c.full_name) = lower(pp.full_name));
  PERFORM set_config('app.reason', coalesce(p_reason, ''), true);
  UPDATE prospects SET customer_id = cid, status = 'promoted' WHERE id = p_id;
  RETURN jsonb_build_object('customer_id', cid, 'created_account', made, 'contacts_added', people);
END $$;

GRANT EXECUTE ON FUNCTION public.import_prospects(text, jsonb, text, boolean), public.import_prospect_people(jsonb, text),
  public.search_prospects(text, text[], text[], text[], text[], text[], text[], boolean, boolean, text, integer, integer),
  public.upsert_prospect_lists(jsonb), public.refresh_prospect_counts(),
  public.prospect_facets(), public.set_prospect_rank(uuid, text, integer, boolean, text, text),
  public.promote_prospect(uuid, text, text), public.prospect_norm_name(text), public.prospect_norm_domain(text) TO authenticated;

-- A customer put on do not contact flags its prospect too.
CREATE OR REPLACE FUNCTION public.customers_dnc_to_prospects()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.dnc AND NOT coalesce(OLD.dnc, false) THEN
    UPDATE prospects SET dnc = true WHERE customer_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_customers_dnc_to_prospects ON public.customers;
CREATE TRIGGER trg_customers_dnc_to_prospects AFTER UPDATE OF dnc ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_dnc_to_prospects();

-- ---------- what runs on a schedule (from the 23 Nov 2026 inventory; all IST) ----------
INSERT INTO public.sales_schedules (id, job, name, cadence, cron, runs_where, what_it_does, status, sort_order) VALUES
 ('crm-watchdog', 'crm-watchdog', 'CRM watchdog', 'Mon-Fri 9:44 and 15:58 IST', '44 9 * * 1-5; 58 15 * * 1-5', 'Cloud task', 'Reads LinkedIn and email replies, flags forgotten conversations, drafts replies and nudges for your approval.', 'live', 10),
 ('daily-send', 'daily-send', 'Daily send and follow-up', 'Mon-Fri 19:22 IST (8:52 AM CT)', '22 19 * * 1-5', 'Cloud task', 'Sends the approved messages for the day, spread out, and logs every touch.', 'live', 20),
 ('list-run', 'list-building', 'Weekly list run', 'Mon 8:51 IST (monthly rebuild and re-score in week 1)', '51 8 * * 1', 'Cloud task', 'Builds the weekly 150 main + 175 trade research picks and loads them into Prospects.', 'live', 30),
 ('traction-digest', 'traction', 'Traction digest', 'Mon 10:23 IST (inner-ring count in week 1)', '23 10 * * 1', 'Cloud task', 'Reviews the bullseye, proposes ideas and ring moves for you to decide.', 'live', 40),
 ('outreach-batch', 'outreach', 'Outreach batch', 'Mon 11:37 IST', '37 11 * * 1', 'Cloud task', 'Drafts the week''s personal messages for review in one sitting.', 'live', 50),
 ('content-run', 'content', 'Content run', 'Mon 13:13 IST (drip draft in week 1)', '13 13 * * 1', 'Cloud task', 'Drafts the week''s posts and fills the content calendar.', 'live', 60),
 ('website-report', 'website-seo', 'Website report', 'Mon 14:47 IST, odd ISO weeks', '47 14 * * 1', 'Cloud task', 'Search and site numbers, with fixes to approve.', 'live', 70),
 ('held-back-review', 'email', 'Held-back email review', 'Mon 10:17 IST, first Monday of the month', '17 10 1-7 * 1', 'Cloud task', 'Reviews emails held back by the copy check.', 'live', 80),
 ('brand-review', 'brand', 'Brand review', 'Tue 11:41 IST, first week of the month', '41 11 1-7 * 2', 'Cloud task', 'Checks posts and pages against the brand rules.', 'live', 90),
 ('competitor-note', 'research', 'Competitor note', 'Wed 11:33 IST, first week of the month', '33 11 1-7 * 3', 'Cloud task', 'A short note on what competitors changed.', 'live', 100),
 ('weekly-report', 'reporting', 'Weekly sales and credit usage report', 'Fri 17:17 IST', '17 17 * * 5', 'Cloud task', 'The week in numbers: sends, replies, inquiries, credits and cost against targets.', 'live', 110)
ON CONFLICT (id) DO NOTHING;
