CREATE TABLE IF NOT EXISTS public.traction_channels (
  id integer PRIMARY KEY,
  name text NOT NULL,
  ring text NOT NULL DEFAULT 'promising' CHECK (ring IN ('inner','engine','promising','long_shot','off')),
  sort_order integer NOT NULL DEFAULT 0,
  fit integer CHECK (fit IS NULL OR fit BETWEEN 0 AND 5),
  cost text,
  test_ends date,
  map_note text,
  ring_reason text,
  ring_changed_at timestamptz,
  ring_changed_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.traction_ring_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id integer NOT NULL REFERENCES public.traction_channels(id) ON DELETE CASCADE,
  from_ring text,
  to_ring text NOT NULL,
  reason text,
  actor text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_traction_ring_events_channel ON public.traction_ring_events (channel_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.traction_channels_before_write()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.ring IS DISTINCT FROM OLD.ring THEN
    IF NEW.ring = 'inner' AND (SELECT count(*) FROM public.traction_channels WHERE ring = 'inner' AND id <> NEW.id) >= 3 THEN
      RAISE EXCEPTION 'The inner ring already holds 3 channels. Move one out first.';
    END IF;
    NEW.ring_changed_at := now();
    NEW.ring_changed_by := coalesce(nullif(NEW.ring_changed_by, OLD.ring_changed_by), current_setting('request.jwt.claim.email', true), 'system');
    INSERT INTO public.traction_ring_events (channel_id, from_ring, to_ring, reason, actor)
    VALUES (NEW.id, OLD.ring, NEW.ring, CASE WHEN NEW.ring_reason IS DISTINCT FROM OLD.ring_reason THEN NEW.ring_reason END, NEW.ring_changed_by);
    IF NEW.ring_reason IS NOT DISTINCT FROM OLD.ring_reason THEN NEW.ring_reason := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_traction_channels_before_write ON public.traction_channels;
CREATE TRIGGER trg_traction_channels_before_write
  BEFORE INSERT OR UPDATE ON public.traction_channels
  FOR EACH ROW EXECUTE FUNCTION public.traction_channels_before_write();

CREATE TABLE IF NOT EXISTS public.traction_ideas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_key text UNIQUE,
  channel_id integer NOT NULL REFERENCES public.traction_channels(id) ON DELETE CASCADE,
  rank integer NOT NULL DEFAULT 99,
  title text NOT NULL,
  pitch text,
  free_or_paid text NOT NULL DEFAULT 'free' CHECK (free_or_paid IN ('free','paid')),
  hours_per_week numeric(5,2),
  reach text,
  soonest_inquiry text,
  deadline date,
  evidence text,
  status text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','proposed','approved','running','done','dropped','not_for_now')),
  proposed_at date,
  decision_note text,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_traction_ideas_channel ON public.traction_ideas (channel_id, rank);

CREATE TABLE IF NOT EXISTS public.communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  grp text,
  audience text,
  cost text,
  promotion_allowed text,
  link text,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','joined','active','dropped')),
  priority text,
  high_value boolean NOT NULL DEFAULT false,
  interaction_plan text,
  who_acts text,
  hours_per_month numeric(5,2),
  last_touch date,
  next_touch date,
  channel_id integer REFERENCES public.traction_channels(id) ON DELETE SET NULL DEFAULT 10,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_pieces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'post' CHECK (kind IN ('post','article','case_study','chart','design','drip','video','other')),
  pillar text,
  status text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','draft','review','approved','scheduled','posted','dropped')),
  body text,
  format_note text,
  proof text,
  target_search text,
  parent_id uuid REFERENCES public.content_pieces(id) ON DELETE SET NULL,
  asset_url text,
  source text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.content_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id uuid NOT NULL REFERENCES public.content_pieces(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'linkedin' CHECK (channel IN ('linkedin','website','drip','other')),
  slot_date date NOT NULL,
  slot_time_ct text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','scheduled','posted','skipped')),
  variant text,
  test_id text,
  post_url text,
  impressions integer,
  reactions integer,
  comments integer,
  qualified_comments integer,
  profile_views_3d integer,
  accepts_3d integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (piece_id, channel, slot_date)
);
CREATE INDEX IF NOT EXISTS idx_content_slots_date ON public.content_slots (slot_date);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['traction_ideas','communities','content_pieces','content_slots'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', t, t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['traction_channels','traction_ring_events','traction_ideas','communities','content_pieces','content_slots'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admin/team manage %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Admin/team manage %s" ON public.%I FOR ALL TO authenticated USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()))', t, t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.customer_rfqs_sales_handoff()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
DECLARE v_stage text;
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  SELECT sales_stage INTO v_stage FROM public.customers WHERE id = NEW.customer_id;
  IF v_stage IS NULL OR v_stage IN ('dnc','not_a_fit') THEN RETURN NEW; END IF;
  IF NEW.status IN ('po','complete') AND v_stage <> 'customer' THEN
    UPDATE public.customers SET sales_stage = 'customer', not_now_until = NULL WHERE id = NEW.customer_id;
  ELSIF TG_OP = 'INSERT' AND v_stage IN ('queued','in_outreach','responded','in_conversation','not_now') THEN
    UPDATE public.customers SET sales_stage = 'inquiry', not_now_until = NULL WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.customer_rfqs_default_source()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.source_channel IS NULL AND NEW.customer_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.customers WHERE id = NEW.customer_id AND sales_stage IN ('in_outreach','responded','in_conversation')) THEN
    NEW.source_channel := '4';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customer_rfqs_default_source ON public.customer_rfqs;
CREATE TRIGGER trg_customer_rfqs_default_source
  BEFORE INSERT ON public.customer_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.customer_rfqs_default_source();
DROP TRIGGER IF EXISTS trg_customer_rfqs_sales_handoff ON public.customer_rfqs;
CREATE TRIGGER trg_customer_rfqs_sales_handoff
  AFTER INSERT OR UPDATE OF status ON public.customer_rfqs
  FOR EACH ROW EXECUTE FUNCTION public.customer_rfqs_sales_handoff();