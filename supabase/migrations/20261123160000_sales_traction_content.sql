-- Sales section, Phase 2: Traction page (channels, bullseye, ideas, communities) and Content (pieces + posting calendar with A/B tags).
-- Seeded from the project's Traction board (playbooks/channel-proposals/board) and the 24 drafted LinkedIn posts. Seeds never overwrite edits (ON CONFLICT DO NOTHING).

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

-- The inner ring holds three channels at once; every ring move is logged with its reason.
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

-- Hand-off: an inquiry on a pipeline account moves it to Inquiry (and tags Sales as the source if none is set);
-- an inquiry reaching PO or Complete makes it a Customer. Both moves land in sales_stage_events like any other.
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

-- ---------- seed ----------
INSERT INTO public.traction_channels (id, name, ring, sort_order, fit, cost, test_ends, map_note, ring_reason, ring_changed_at, ring_changed_by) VALUES
  (1, 'Targeting blogs (podcasts, newsletters, niche blogs)', 'inner', 1, 5, 'Free', '2027-03-31', 'Inner', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (2, 'Existing platforms', 'inner', 2, 5, 'Free', '2027-03-31', 'Inner', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (3, 'Business development', 'inner', 3, 5, 'Free', '2027-03-31', 'Inner', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (4, 'Sales (direct outreach)', 'engine', 4, 5, 'Free', NULL, 'Inner, already built', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (5, 'Offline events', 'promising', 5, 4, 'Low', NULL, 'Middle, start now', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (6, 'SEO', 'promising', 6, 4, 'Free', NULL, 'Middle, start now', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (7, 'Content marketing', 'promising', 7, 4, 'Free', NULL, 'Middle, start now', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (8, 'Speaking engagements', 'promising', 8, 4, 'Free', NULL, 'Middle', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (9, 'Engineering as marketing', 'promising', 9, 3, 'Free', NULL, 'Middle', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (10, 'Community building', 'promising', 10, 3, 'Free', NULL, 'Middle, in motion', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (11, 'Email marketing (to people who know you)', 'promising', 11, 3, 'Free', NULL, 'Middle', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (12, 'Publicity (PR)', 'promising', 12, 3, 'Free', NULL, 'Middle', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (13, 'Affiliate programs', 'promising', 13, 3, 'Pay on success', NULL, 'Middle, folded into BD', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (14, 'Trade shows', 'promising', 14, 3, 'Paid for a booth, low to walk', NULL, 'Middle', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (15, 'Search ads (SEM)', 'long_shot', 15, 3, 'Paid', NULL, 'Outer until budget', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (16, 'Social and display ads', 'long_shot', 16, 2, 'Paid', NULL, 'Outer until budget', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (17, 'Unconventional PR', 'long_shot', 17, 2, 'Free to low', NULL, 'Outer', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (18, 'Offline ads', 'long_shot', 18, 1, 'Paid', NULL, 'Outer', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb'),
  (19, 'Viral marketing', 'long_shot', 19, 1, 'n/a', NULL, 'Outer', 'Caleb: go with the map for now', '2026-11-23'::timestamptz, 'Caleb')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.traction_ideas (seed_key, channel_id, rank, title, pitch, free_or_paid, hours_per_week, reach, soonest_inquiry, evidence, status, proposed_at, decision_note) VALUES
  ('c1-r1', 1, 1, 'Pitch you as a guest to 12 shows that have already hosted a sourcing guest', 'Pitch you as a guest to 12 shows that have already hosted a sourcing guest. Pass: 2 bookings in 60 days and 1 tagged inquiry within 30 days of airing.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c2-r1', 2, 1, 'Create an Amazon Manufacturing Central profile and ask about the Service Provide', 'Create an Amazon Manufacturing Central profile and ask about the Service Provider Network. Pass: profile live in 30 days, 3 qualified requests in the 60 days after.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c3-r1', 3, 1, '10 partner conversations', '10 partner conversations. Pass: 2 agree to refer, 1 referred inquiry in 90 days.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c4-r1', 4, 1, 'Already designed in the plan: 25 researched messages a week', 'Already designed in the plan: 25 researched messages a week. Pass: 8% reply rate after 100 messages. Stop and rework under 3%.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c5-r1', 5, 1, 'Invite 20 US buyers who will be at the Delhi fair to add a day in Jodhpur, or a ', 'Invite 20 US buyers who will be at the Delhi fair to add a day in Jodhpur, or a live video walk. Pass: 5 accept, 2 ask for a quote.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c6-r1', 6, 1, 'After the new site is live, publish 6 guides aimed at one question each', 'After the new site is live, publish 6 guides aimed at one question each. Pass: 2 inquiries with a search source within 90 days of launch.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c7-r1', 7, 1, 'Same work as SEO. The 24 LinkedIn posts become the guides, and 4 case studies fo', 'Same work as SEO. The 24 LinkedIn posts become the guides, and 4 case studies follow. Pass: 3 posts a week for 8 weeks, and one post that draws a prospect''s comment or message each week.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c8-r1', 8, 1, 'One 30-minute online talk, "What a first order from India really takes", offered', 'One 30-minute online talk, "What a first order from India really takes", offered to two seller communities and to the student founders at Mays. Pass: 1 booked, 15 attendees, 2 follow-up conversations.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c9-r1', 9, 1, 'Build one free tool on the new site from numbers you already publish: a containe', 'Build one free tool on the new site from numbers you already publish: a container-fill and first-order timeline planner. Pass: 30 uses a month and 2 inquiries in 90 days.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c10-r1', 10, 1, 'Already running as the 45-channel community tracker', 'Already running as the 45-channel community tracker. Pass: 5 useful answers posted a week once approved, 1 inquiry a month.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c11-r1', 11, 1, 'A monthly "Notes from Jodhpur" to customers, past inquirers and the warm 78, wri', 'A monthly "Notes from Jodhpur" to customers, past inquirers and the warm 78, written from that month''s best posts. Pass: 40% open rate, 2 replies an issue.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c12-r1', 12, 1, '5 pitches of the founder story to trade and local press', '5 pitches of the founder story to trade and local press. Pass: 1 published piece.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c13-r1', 13, 1, 'Decide whether DKT pays a referral fee, then offer it inside the business develo', 'Decide whether DKT pays a referral fee, then offer it inside the business development test. No separate test.', 'free', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'idea', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c14-r1', 14, 1, 'No booth. Walk High Point in April 2027 with meetings set beforehand, as the pla', 'No booth. Walk High Point in April 2027 with meetings set beforehand, as the plan already says. Pass: 8 meetings booked before the show.', 'paid', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'not_for_now', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c15-r1', 15, 1, 'When budget opens: $300 on three exact-match category phrases sent to the start ', 'When budget opens: $300 on three exact-match category phrases sent to the start page. Pass: an inquiry for under $150.', 'paid', NULL, NULL, NULL, 'dkt-gtm/strategy/traction-channel-map.md section 3', 'not_for_now', '2026-11-18', 'seeded from the map, not yet reviewed'),
  ('c1-r2', 1, 2, 'Pitch 5 Amazon seller newsletters for a guest issue', 'Offer a short guest piece, ''What a first order from India really takes'', to newsletters already read by Amazon and DTC sellers. Pass: 1 run in 60 days.', 'free', 1, 'direct', '6-10 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c1-r3', 1, 3, 'Answer sourcing questions on niche blogs that take reader Q&A', 'Find blogs that publish reader sourcing questions and send a straight answer with real numbers. Pass: 2 published answers.', 'free', 0.5, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c1-r4', 1, 4, 'Aaron Hughes co-appearance', 'Pitch a joint episode with Aaron Hughes (agreed to be named, sells on Amazon) as the customer proof. Pass: 1 booking.', 'free', 1, 'direct', '6-10 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c1-r5', 1, 5, 'Paid newsletter classified (when budget opens)', 'Logged, not proposed: one classified in a seller newsletter from the community tracker''s paid list.', 'paid', 0.25, 'direct', '2-4 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c2-r2', 2, 2, 'Free SourceReady profile', 'List the Jodhpur factory on SourceReady, where Jodhpur competitors already sit. Pass: profile live, 1 fitting request in 60 days.', 'free', 0.5, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c2-r3', 2, 3, 'ThomasNet and Kompass profiles', 'Finish the ThomasNet and Kompass listings already in the SEO plan, same name, phone and Fort Worth city everywhere.', 'free', 0.5, 'medium', '6-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c2-r4', 2, 4, 'Houzz pro profile for decor and furniture', 'Houzz lists Jodhpur makers; a profile with finished-piece photos reaches decor buyers and designers.', 'free', 0.5, 'medium', '6-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c2-r5', 2, 5, 'Ask Amazon about the Service Provider Network manufacturing category', 'It may be invite only; ask once through Manufacturing Central support. Pass: a clear yes or no.', 'free', 0.25, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c3-r2', 3, 2, 'Industrial design studios that work in plastics', 'Offer wood, iron, steel and marble as the materials they can''t make. 3 studios first.', 'free', 1, 'medium', '6-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c3-r3', 3, 3, 'Amazon launch agencies and private-label consultants', 'They get asked ''who can make this?'' every week. 3 agencies first.', 'free', 1, 'direct', '6-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c3-r4', 3, 4, 'Freight forwarders and 3PLs with partner directories', 'Get listed where ShipBob lists Zignify. Pass: 1 directory listing.', 'free', 0.5, 'medium', '8-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c3-r5', 3, 5, 'Sourcing agents who don''t cover India', 'Start from the 185 agents set aside as partners. Offer to be their India arm.', 'free', 1, 'direct', '6-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c4-r2', 4, 2, 'Warm 78 first: reply to everyone who said interested', 'Work the Waalaxy interested list before any cold send. Pass: 10 conversations in 2 weeks.', 'free', 1.5, 'direct', 'days', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c4-r3', 4, 3, 'A/B test the opener type on LinkedIn invites', 'Question opener vs observation opener, 100 sends each, judged on reply rate.', 'free', 0, 'direct', '2-3 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c4-r4', 4, 4, 'Email ramp 8, 12, 16, 20 a day while bounces stay under 2%', 'Personal emails drafted by the outreach job, Caleb sends.', 'free', 1, 'direct', '1-2 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c4-r5', 4, 5, 'Re-target paused Waalaxy Attempt 2 (3,139 queued)', 'Re-score the queue with our ranking before sending again.', 'free', 0.5, 'direct', '2-4 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c5-r2', 5, 2, 'Live video factory walk offer', 'Offer a 20-minute live video walk of the Jodhpur floor to every warm prospect. Pass: 5 walks, 2 quote asks.', 'free', 1, 'direct', '2-4 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c5-r3', 5, 3, 'Meet buyers at the Delhi fair (IHGF spring 2027)', 'Set meetings with US buyers before the fair. Dates still to check.', 'paid', 2, 'direct', 'fixed dates', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c5-r4', 5, 4, 'Online event: first-order Q&A for seller communities', 'A free 30-minute online Q&A hosted by a seller community.', 'free', 1, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c5-r5', 5, 5, 'Texas meetups for e-commerce sellers', 'Attend one Dallas-Fort Worth seller meetup a quarter.', 'free', 1, 'medium', '4-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c6-r2', 6, 2, 'One page per product category', 'Furniture, iron decor, marble, wood decor: a page each answering one search, like Cosmo Sourcing and Leeline.', 'free', 0.5, 'medium', '3-6 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c6-r3', 6, 3, '''Manufacturer in India for Amazon sellers'' guide', 'One guide aimed at the exact buyer search, with the US-contract line on the page.', 'free', 0.25, 'direct', '3-6 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c6-r4', 6, 4, 'Google Business Profile, Bing Places, Apple Business Connect', 'Same listing text everywhere, Fort Worth only, no street address.', 'free', 0.25, 'medium', '1-3 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c6-r5', 6, 5, 'Gallery titles and alt text that carry the buying search', 'Already on the task list; quick wins on the home page images.', 'free', 0.25, 'medium', '1-3 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c7-r2', 7, 2, 'Case studies with real charts, unnamed until clients agree', '4 case studies, ''a US online decor brand'', one proof point each.', 'free', 0.5, 'direct', '6-10 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c7-r3', 7, 3, 'Factory-floor photo posts from DKT-photos-sorted', 'One photo and what it shows, from 01 Factory, 03 Samples, 04 QC.', 'free', 0.25, 'medium', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c7-r4', 7, 4, 'Monthly ''what we''re working on'' note cut from the posts', 'Feeds the drip; approved in the weekly sitting.', 'free', 0.25, 'direct', '4 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c7-r5', 7, 5, 'Straight-answer posts: when not to buy from us', 'Short, specific, DKT-only answers. Judged on qualified comments.', 'free', 0.25, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c8-r2', 8, 2, 'Talk to student founders at Mays (Texas A&M)', 'Caleb is class of 2012; offer the first-order talk to the Mays founder program.', 'free', 1, 'medium', '6-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c8-r3', 8, 3, 'Guest slot in an Amazon seller mastermind call', 'Offer the same talk to 2 paid seller masterminds as a free guest.', 'free', 1, 'direct', '6-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c8-r4', 8, 4, 'Panel spot at a sourcing or e-commerce conference', 'Apply to speak where Kian Golzari and Zignify speak. Logged for 2027 calls for speakers.', 'free', 2, 'direct', '3-6 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c8-r5', 8, 5, 'Record the talk once and reuse it', 'Turn the talk into a site page and 3 LinkedIn cut-ups.', 'free', 0.5, 'medium', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c9-r2', 9, 2, 'Container-fill and first-order timeline planner', 'Free tool on the site from numbers already published. Pass: 30 uses a month.', 'free', 0.5, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c9-r3', 9, 3, 'Rough landed-cost estimator for one category', 'Like Design 1st''s estimator: dimensions in, a range out, then a quote ask.', 'free', 0.5, 'direct', '6-10 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c9-r4', 9, 4, 'Sample timeline and cost calculator', 'Samples up to 2 weeks at twice bulk price, credited back. Makes the rule concrete.', 'free', 0.25, 'medium', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c9-r5', 9, 5, 'Which-town-makes-this lookup', 'Product in, Indian specialist town out (Jodhpur, Moradabad, Firozabad...).', 'free', 0.5, 'medium', '6-10 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c10-r2', 10, 2, 'Shopify Community sourcing board: 5 useful answers a week', 'Answer, never pitch. From the A-priority communities.', 'free', 1, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c10-r3', 10, 3, 'Reddit r/FulfillmentByAmazon and r/AmazonSeller answers', 'Straight answers on India sourcing threads, per each sub''s rules.', 'free', 1, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c10-r4', 10, 4, 'Facebook seller groups (A list)', 'Join and take part; pitch only where promotion is allowed.', 'free', 1, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c10-r5', 10, 5, 'Agree interaction plans for the high-value communities', 'Caleb''s open task: how we show up, how often, who posts.', 'free', 0.5, 'medium', '1-2 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c11-r2', 11, 2, 'Drip for really interested contacts', 'One short monthly note; contacts with drip_enrolled get it.', 'free', 0.25, 'direct', '4 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c11-r3', 11, 3, 'Re-engage past inquirers with a new-sample photo', 'One personal email per past inquirer with a relevant new piece.', 'free', 0.5, 'direct', '2-4 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c11-r4', 11, 4, 'Customer-only update each quarter', 'What changed at the factory, one lesson, one question.', 'free', 0.25, 'direct', '3 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c11-r5', 11, 5, 'Referral ask in every customer update', 'The nearest thing to a viral loop: ask who else should hear from us.', 'free', 0, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c12-r2', 12, 2, 'Fort Worth and Texas business press', 'Two Americans who own a factory in Jodhpur: a local business story.', 'free', 0.5, 'medium', '6-12 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c12-r3', 12, 3, 'Texas A&M alumni magazine and newsletters', 'Class of 2012 alumnus story.', 'free', 0.25, 'low', '2-4 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c12-r4', 12, 4, 'Trade press for home furnishings (Furniture Today, Home Accents Today)', 'Pitch a short piece on making in Jodhpur.', 'free', 0.5, 'medium', '2-4 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c12-r5', 12, 5, 'India export council and Jodhpur trade body news', 'Get mentioned in their member news.', 'free', 0.25, 'low', '2-4 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c13-r2', 13, 2, 'Decide whether DKT pays a referral fee', 'Benchmarks: Gembah 10% of first-year revenue, JingSourcing 1-2% of orders. Caleb''s call.', 'free', 0.25, 'medium', '1 week', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c13-r3', 13, 3, 'Customer referral thank-you', 'A small credit on the next order for a referred customer.', 'paid', 0, 'direct', '2-3 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c13-r4', 13, 4, 'Partner referral agreement template', 'One-page plain agreement for the BD test partners.', 'free', 0.25, 'medium', '2-4 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c13-r5', 13, 5, 'Affiliate listing on sourcing directories', 'Logged only; pay-per-lead directories when budget opens.', 'paid', 0, 'medium', '1-2 months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c14-r2', 14, 2, 'Walk Las Vegas Market or ASD with meetings set', 'No booth; meet decor buyers already on the list.', 'paid', 2, 'direct', 'fixed dates', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c14-r3', 14, 3, 'India pavilion visits at NY NOW / Sourcing at Magic', 'Learn who else from India shows and who the buyers are.', 'paid', 2, 'medium', 'fixed dates', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c14-r4', 14, 4, 'Pre-show LinkedIn outreach to attendees', 'Use exhibitor and attendee lists to book meetings before the show.', 'free', 1, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c14-r5', 14, 5, 'Booth (when budget opens)', 'Logged, not proposed.', 'paid', 4, 'direct', 'fixed dates', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c15-r2', 15, 2, 'Exact-match category phrases to the start page', '$300 on three phrases, Gembah''s one-category-per-ad pattern.', 'paid', 0.25, 'direct', 'days', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c15-r3', 15, 3, 'Brand name protection ad', 'Cheap ad on our own name once search volume exists.', 'paid', 0, 'low', 'days', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c15-r4', 15, 4, 'Microsoft Ads mirror of the Google test', 'Same three phrases, often cheaper clicks.', 'paid', 0.25, 'direct', 'days', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c15-r5', 15, 5, 'Amazon sponsored ads? Not applicable', 'We sell to sellers, not on Amazon. Logged and dropped.', 'paid', 0, 'low', 'n/a', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c16-r1', 16, 1, 'India-sourcing Meta ad test', 'Only about 3 US Meta ads mention sourcing from India. A small test when budget opens.', 'paid', 0.25, 'direct', 'days', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c16-r2', 16, 2, 'LinkedIn sponsored post to Amazon sellers', 'Boost the best organic post to a seller audience.', 'paid', 0.25, 'direct', 'days', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c16-r3', 16, 3, 'Retargeting site visitors', 'Needs analytics live first.', 'paid', 0, 'medium', 'weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c16-r4', 16, 4, 'YouTube factory-floor pre-roll', 'Logged only.', 'paid', 0.5, 'low', 'weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c16-r5', 16, 5, 'Check the Meta Ad Library monthly for India-sourcing ads', 'Free watch: if others start buying the gap, it pays; if not, the empty field may mean it doesn''t.', 'free', 0.25, 'low', 'n/a', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c17-r1', 17, 1, 'Short factory-floor videos', 'Already in the content plan; cheap and occasionally travels.', 'free', 0.5, 'medium', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c17-r2', 17, 2, '''Two samples, one locked away'' demo video', 'Show the reference sample rule on camera.', 'free', 0.5, 'medium', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c17-r3', 17, 3, 'Behind-the-scenes of one container leaving Jodhpur', 'One photo story from order to truck.', 'free', 0.5, 'medium', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c17-r4', 17, 4, 'Seller pitch contests as a sponsor-judge', 'Logged; costs time or money.', 'paid', 1, 'medium', 'months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c17-r5', 17, 5, 'Answer one viral factory video with our own floor', 'When a factory-floor video trends, post our version the same week.', 'free', 0.25, 'medium', 'weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c18-r1', 18, 1, 'Newsletter classifieds (community tracker paid list)', 'Already listed as paid tests in the tracker.', 'paid', 0.25, 'direct', '2-4 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c18-r2', 18, 2, 'Trade magazine classified', 'Logged only.', 'paid', 0.25, 'low', 'months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c18-r3', 18, 3, 'Printed flyer at trade shows walked', 'Use the existing overview flyer; costs printing only.', 'free', 0, 'medium', 'fixed dates', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c18-r4', 18, 4, 'Direct mail sample swatch to top 20 accounts', 'A wood or iron swatch with a note. Logged until budget.', 'paid', 1, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c18-r5', 18, 5, 'Sponsor a local Fort Worth business event', 'Logged only.', 'paid', 1, 'low', 'months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c19-r1', 19, 1, 'Monthly referral ask to customers', 'The nearest thing to a loop.', 'free', 0.25, 'direct', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c19-r2', 19, 2, 'Shareable first-order planner result', 'If the planner tool exists, let buyers share their plan.', 'free', 0.25, 'low', 'months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c19-r3', 19, 3, 'Customer quote cards they can repost', 'Named customers only (Chicken Coop Company, Leavitt Bay Coffee, RawHyd, Sherwood).', 'free', 0.25, 'medium', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c19-r4', 19, 4, '''Made in Jodhpur by DKT'' tag on finished pieces', 'A small tag buyers'' customers see. Needs Caleb''s yes.', 'paid', 0, 'low', 'months', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'not_for_now', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed'),
  ('c19-r5', 19, 5, 'Named-customer case study they share', 'Ask a named customer to share their own case study post.', 'free', 0.25, 'medium', '4-8 weeks', 'dkt-gtm/strategy/traction-channel-map.md, competitor-channel-research.md', 'idea', '2026-11-23', 'drafted 23 Nov 2026 from the Traction map, not yet reviewed')
ON CONFLICT (seed_key) DO NOTHING;

INSERT INTO public.communities (name, grp, audience, cost, promotion_allowed, link, status, priority, notes) VALUES
  ('Amazon Service Provider Network (Manufacturing category)', 'Amazon sellers', 'Amazon sellers looking for vetted providers. Launchers.', 'Free for sellers to browse. Provider fees are not stated on the page I read.', 'Yes. It is a provider directory, and ''Manufacturing'' is one of the listed provider categories. ''Sourcing'' is not a categ', 'https://spcentral.amazon.com/nlp/register-ww', 'candidate', 'A', 'priority: A - free, start here'),
  ('Shopify Community: Product Development & Sourcing board', 'Small brands', 'Shopify store owners asking where to get products made. Launchers.', 'Free', 'Unknown. The guidelines page is closed to automated readers. One reply naming a supplier platform was standing in a furn', 'https://community.shopify.com/', 'candidate', 'A', 'priority: A - free, start here'),
  ('Sellers Ask Sellers (independent seller forum)', 'Amazon sellers', 'Amazon, eBay and Walmart sellers. Launchers.', 'Free', 'Unknown. Guidelines and terms are linked from the site but I could not read their text.', 'https://sellersasksellers.com/', 'candidate', 'A', 'priority: A - free, start here'),
  ('Reddit r/FulfillmentByAmazon', 'Amazon sellers', 'Mid to high level FBA sellers. Launchers.', 'Free', 'Unknown. Reddit is blocked to my tools, so I could not read the rules. Assume no self-promotion until read.', 'https://www.reddit.com/r/FulfillmentByAmazon/', 'candidate', 'A', 'priority: A - free, start here'),
  ('Reddit r/AmazonSeller', 'Amazon sellers', 'Amazon sellers of all sizes. Launchers.', 'Free', 'Restricted. A secondary source says ''Moderators enforce rules around spam, self-promotion, deceptive practices, and proh', 'https://www.reddit.com/r/AmazonSeller/', 'candidate', 'A', 'priority: A - free, start here'),
  ('AmazonFBA Discord', 'Amazon sellers', 'FBA sellers in live chat. Launchers.', 'Free invite', 'Unknown. Not read.', 'https://discord.com/invite/amazonfba-507527499769446401', 'candidate', 'A', 'priority: A - free, start here'),
  ('Alignable', 'Local business', 'Local business owners trading referrals. Fort Worth network. Switchers and Trade.', '''Get Started Free''. Paid plan price not found.', 'Profile and referrals are the purpose. The site says ''Say goodbye to spam and solicitation''. Code of conduct not read.', 'https://www.alignable.com/', 'candidate', 'A', 'priority: A - free, start here'),
  ('TexAgs forums (answer requests only)', 'Texas A&M', 'Current and former Texas A&M students. Mixed fit.', 'Free to answer. Sponsorship price is not public.', 'Mostly no. ''You may not promote businesses without the permission of TexAgs.com.'' The one opening: ''If a service is requ', 'https://texags.com/', 'candidate', 'A', 'priority: A - free, start here'),
  ('Texas A&M CAEI at Mays Business School (student entrepreneurship)', 'Texas A&M', 'Student founders with product ideas. Future Launchers.', 'Free', 'Not an ad channel. The page invites former students to contribute to programs.', 'https://mays.tamu.edu/centers-and-institutes/caei/', 'candidate', 'A', 'priority: A - free, start here'),
  ('The Kingdom Business Owner (newsletter and podcast)', 'Faith-based', '''A weekly briefing for Christian business owners who want to build differently.'' Owners of all kinds. Launchers and Swit', 'Not public. Caleb reports paid classifieds in the newsletter. The price is in th', 'Yes, paid. The advertise form offers ''Email Newsletter'' or ''Podcast'' and asks for a monthly budget.', 'https://thekingdombusinessowner.com/advertise-with-us/', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('U.S. Christian Chamber of Commerce: National Business Builder', 'Faith-based', 'Christian-led businesses across the US. Switchers and Launchers.', '$39 a month. Higher tiers $129 and $417 a month.', 'Yes. Membership includes ''Designation as a member'', a standard directory listing and monthly hybrid forums.', 'https://business.uschristianchamber.com/uscccmembership', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('Billion Dollar Sellers newsletter', 'Amazon sellers', 'Amazon sellers: 68% FBA, 15% wholesalers, 17% service providers. Launchers.', '$500 for one ad in a Monday or Thursday issue. 3 ads for $1,200. Dedicated email', 'Yes, paid. ''No direct competitors allowed in same newsletter.'' One ad per issue.', 'https://www.amzmarketer.com/BDSS_Partner_Kit.pdf', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('Business of Home: classifieds', 'Trade', 'Interior designers and the design trade. Trade segment.', 'Not stated. The submit page needs a login.', 'Yes. A ''Submit a Classified'' page exists. Current listings are studio shares, bookkeeping, marketing consultants and fir', 'https://businessofhome.com/classifieds/new', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('Business of Home: Experts directory', 'Trade', 'Interior designers looking for service firms. Trade segment.', '''free for BOH Insiders, or $349 per year''. BOH Insider is $250 a year.', 'Yes. Categories include ''Sales & Independent Rep Firms'' and ''Purchasing Agents''.', 'https://businessofhome.com/experts/new', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('Furniture World (magazine, e-newsletter, classifieds)', 'Furniture trade', '''owners, managers and buyers in retail furniture stores''. Switchers.', 'Not stated. By media kit.', 'Yes, paid. Print ads, classified ads, e-newsletter ads and eBlasts, for ''manufacturers of home furnishings products''.', 'https://forum.furninfo.com/about', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('Furniture Today E-Classifieds', 'Furniture trade', 'Furniture industry. Categories are Employment, For Sale and Buyers Wanted. Switchers.', 'Not stated', 'Yes, paid. ''To advertise in our E-Classifieds Contact: Jordyn Jarvis 336-271-1267.''', 'https://www.furnituretoday.com/classifieds/', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('Shopifreaks newsletter', 'Small brands', '''read each week by over 20,000+ e-commerce professionals'': merchants, agencies, app developers. Launchers, mixed.', 'Not stated', 'Yes, as a ''News Partner'' sponsor.', 'https://www.shopifreaks.com/', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('My Wife Quit Her Job newsletter', 'Amazon sellers', '''store owners, Amazon and Shopify sellers, and aspiring entrepreneurs''. Launchers.', 'Dollar price is only shown at checkout. A pack of 4 is the smallest buy.', 'Yes, paid and vetted. ''Limited to two non-competing sponsors per email.'' Slots sold in packs of 4, 8 or 12.', 'https://mywifequitherjob.com/advertise-newsletter/', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('DTC News by Workspace6', 'Small brands', 'Direct-to-consumer brand operators. Launchers and Switchers.', 'Not public', 'Yes. Listed as accepting sponsors.', 'https://news.workspace6.io', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('The Kingdom Investor newsletter', 'Faith-based', 'Faith-driven investors, entrepreneurs, real estate professionals. Weak product fit.', 'Not stated', 'Yes, paid: banner ads, sponsored content, product highlights.', 'https://www.thekingdominvestor.org/p/advertise', 'candidate', 'B', 'priority: B - paid test, when budget opens'),
  ('Dallas A&M Club: Aggie Business Luncheon and Aggie Coffee Connections', 'Texas A&M', 'Aggie business people in Dallas. Mixed fit. In person.', 'Not stated', 'Networking events. No stated rule.', 'https://www.dallasaggies.org/programs/', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Fort Worth/Tarrant County A&M Club', 'Texas A&M', 'Aggies in Fort Worth. In person.', 'Not stated', 'Unknown. Club details sit behind an Aggie Network login.', 'https://aggienetwork.com/club/ftwor/fort-worthtarrant-county-aandm-club-inc', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Aggie 100', 'Texas A&M', 'Honors list of ''the 100 fastest growing Aggie-owned or Aggie-led businesses''. Credibility, not reach.', 'Not stated', 'Not an ad. Nomination only.', 'https://www.aggie100.com/', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Helium 10 Members Facebook group', 'Amazon sellers', 'Amazon sellers using Helium 10. Launchers.', 'Free. ''You don''t have to be a Helium 10 customer to join.''', 'No. ''advertising your products is not allowed''. Also ''keep spam and shameless self-promotional messages where they belon', 'https://www.facebook.com/groups/Helium10Users', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Interior Design Community (Mighty Networks)', 'Trade', 'Interior design professionals who ''source products, share ideas''. Trade segment.', 'Not stated', 'Unclear. The page says ''No Algorithm shifts. No Ads. No Distractions.''', 'https://interior-design-community.mn.co/', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('LinkedIn group: Home Decor and Interior Design USA', 'Trade', 'Home decor and design professionals. Trade and Switchers.', 'Free', 'Unknown. Not read.', 'Search the group name on LinkedIn', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Reddit r/ecommerce, r/smallbusiness, r/Entrepreneur', 'Small brands', 'Broad small-business audiences. Launchers.', 'Free', 'Unknown. Reddit is blocked to my tools. These large subs usually limit promotion to set threads, but that is my expectat', 'https://www.reddit.com/r/ecommerce/ , https://www.reddit.com/r/smallbusiness/ , https://www.reddit.com/r/Entrepreneur/', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('C-Suite for Christ, Dallas-Fort Worth', 'Faith-based', 'Christian owners and senior executives. Meets in Plano.', '$575 a year for a for-profit member', 'Not a selling venue. ''This is not a networking group.''', 'https://dallasfortworth.csuiteforchrist.com/membership/', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('DFW Christian Business networking lunches (Eventbrite)', 'Faith-based', 'Local Christian entrepreneurs. In person, Fort Worth.', 'Free', 'Networking event. ''Connect, collaborate, and grow your business with other local like-minded entrepreneurs in Christ.''', 'https://www.eventbrite.com/e/fort-worth-christian-business-networking-tickets-1111017887409', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Kings in the Marketplace (Substack)', 'Faith-based', 'Kingdom business readers.', 'Not stated', 'No ad route shown.', 'https://kmarketplace.substack.com', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Indie Niche (Substack)', 'Founders', 'Indie software founders. US 29%, India 17%. Weak fit for physical products.', '$30 Product of the Week, $50 basic sponsor slot, $200 sponsored email', 'Yes, paid.', 'https://indieniche.substack.com/p/sponsorships', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Paved marketplace (tool for finding newsletter classifieds)', 'Founders', 'Marketplace of newsletters across topics.', 'Examples: JessPicks $25 (business, 2,500 list), Smarter Brain $150, Recomendo $2', 'Yes, that is its purpose. Classifieds are ''Typically $100-$200''.', 'https://www.paved.com/marketplace', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Hive Index topic page ad', 'Small brands', 'People browsing a directory of online communities.', '$50 a month for the home decor page. $200 a month for the r/FulfillmentByAmazon ', 'Yes, paid.', 'https://thehiveindex.com/partners/paid-ad/', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Fort Worth Chamber of Commerce', 'Local business', 'Tarrant County businesses. Local Switchers and Trade.', '''CLASSIC $750 ANNUALLY'' (fewer than 25 employees)', 'Yes, membership. Classic includes a ''Search-engine-optimized business listing'' and member events.', 'https://www.fortworthchamber.com/membership/join/', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('The Christian Entrepreneur (beehiiv newsletter)', 'Faith-based', 'Christian entrepreneurs starting a business.', 'Not stated', 'Yes, an ''Advertise'' Google form.', 'https://forms.gle/9hcS3LGSopXGfLnL7', 'candidate', 'C', 'priority: C - join and take part, no pitch'),
  ('Amazon Seller Forums (Seller Central)', 'Amazon sellers', 'Amazon selling partners.', 'Free', 'No. Bars posts that ''send users to non-Amazon external websites'', including ''commercial content such as advertising, pro', 'https://sellercentral.amazon.com/seller-forums/guidelines', 'candidate', 'X', 'priority: X - skip'),
  ('Find an Aggie directory (Association of Former Students)', 'Texas A&M', 'Former students. Holds ''contact information for 98% of living former students''.', 'Free to former students', 'No. ''Find an Aggie is not for commercial, business or political use.'' Misuse includes ''Trying to find potential business', 'https://www.aggienetwork.com/', 'candidate', 'X', 'priority: X - skip'),
  ('Association of Former Students partner program', 'Texas A&M', 'Former students.', 'Not stated', 'By selection only. ''The Association selects a limited number of leading brands''.', 'https://www.aggienetwork.com/programs/', 'candidate', 'X', 'priority: X - skip'),
  ('Aggie Owned and Operated program', 'Texas A&M', 'Aggie-owned businesses.', 'Not stated', 'Unknown. A 2011 article describes a business listing program run with TexAgs.', 'http://maroonbook.com/About/AggieOO/ (now redirects to TexAgs)', 'candidate', 'X', 'priority: X - skip'),
  ('C12 Business Forums', 'Faith-based', 'Christian CEOs.', 'Monthly dues ''determined locally''', 'Not for promotion. ''C12 is not a business bible study or a Christian business networking group.'' Invitation only, for co', 'https://www.joinc12.com/', 'candidate', 'X', 'priority: X - skip'),
  ('Faith Driven Entrepreneur', 'Faith-based', 'Faith-driven entrepreneurs and investors.', 'n/a', 'No. ''Faith Driven Movements does not partner with individuals or individual businesses on projects.'' No advertising offe', 'https://www.faithdrivenentrepreneur.org/', 'candidate', 'X', 'priority: X - skip'),
  ('Kingdompreneur Directory', 'Faith-based', 'Christian families shopping for consumer goods.', 'Not found. The listing page would not load.', 'Listings exist, but the audience is consumers.', 'https://kingdompreneurdirectory.com/', 'candidate', 'X', 'priority: X - skip'),
  ('Who''s Who In Kingdom Business directory', 'Faith-based', '''Business owned by kingdom women in business''.', '$14.99 full page listing (page shows conflicting package prices)', 'Paid listing, women-owned businesses only.', 'https://form.jotform.com/212145822673050', 'candidate', 'X', 'priority: X - skip'),
  ('Dormant or closed: EcommerceBytes, For The Interested, SellerBites, Lunch with Norm, Christian Business Builders, FCCI Dallas/Fort Worth lunch, CROWNED Christian Network', 'Closed', 'Various.', 'n/a', 'n/a', NULL, 'candidate', 'X', 'priority: X - skip'),
  ('Paid seller masterminds: eComFuel and Million Dollar Sellers', 'Amazon sellers', 'Seven-figure and larger sellers.', 'eComFuel ''$199 per month for seven-figure businesses''. Million Dollar Sellers ''$', 'Member groups for sellers with revenue minimums, not for suppliers.', 'https://directory.ecommercefuel.com/apply and https://mds.co', 'candidate', 'X', 'priority: X - skip')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.content_pieces (slug, title, kind, pillar, status, body, format_note, source) VALUES
  ('li-post-01', 'Two Americans own a furniture factory in Jodhpur, India. Here is why.', 'post', 'Straight answers', 'draft', 'Two Americans own a furniture factory in Jodhpur, India. Here is why.

Many people who try to manufacture in India get there through an agent. The agent makes an introduction, takes a cut, and steps aside. When something goes wrong, there is nobody to call.

My partner Parker and I set this up the other way around.

Desert Kingdom Traders is a US company in Fort Worth, Texas. You sign with us and you pay us. We own the factory where our furniture is built, and every piece is finished by hand there.

And we have one rule we do not bend: nothing goes into production until you have approved a physical sample. Every order. Including the rush ones.

We crossed the ocean so you don''t have to.

For the next 8 weeks I''m going to post how this actually works: the terms, the timelines, the things that go wrong. Follow along if you make or sell physical products.', 'text, with a photo of Caleb and Parker at the factory if you have one. Pin this post.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-02', 'We never make one sample. We make two.', 'post', 'How we work', 'draft', 'We never make one sample. We make two.

One goes to you. You hold it, measure it, put it in your living room, mark it up.

The other stays locked at the factory. Once you approve yours, the factory copy becomes the reference for the whole production run. Every piece coming off the line gets compared to it.

A few numbers people ask for:

Samples take up to 2 weeks.
They cost twice the bulk price.
The extra you paid over bulk price is credited back on your invoice when you place the order.

A drawing can be read two ways. A sample can''t. It is the only version of the spec that both of us can hold.', 'text. First comment: link to the terms page.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-03', 'India is not one factory.', 'post', 'How India works', 'draft', 'India is not one factory.

It is a country of specialist towns. Each one does one thing, and has done it for generations.

Jodhpur builds solid wood furniture. That is where our factory is.
Moradabad is called the Brass City: casting, spinning, plating.
Firozabad blows glass.
Khurja makes ceramics.
Bhadohi and Mirzapur supply most of the world''s hand-knotted rugs.

This matters to a buyer for one reason. If you ask a furniture factory to make your glassware, you will get glassware made by people who don''t make glass.

The first question for any product is not "who is the supplier?" It is "which town makes this?"

5 towns, 5 specialties. There are dozens more.', 'text, or a simple map graphic later. First comment: "Which product are you trying to place? I''ll tell you which town I''d start in."', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-04', 'A question every buyer should ask an overseas supplier: who am I actually buying from?', 'post', 'Straight answers', 'draft', 'A question every buyer should ask an overseas supplier: who am I actually buying from?

There are three possible answers.

1. A factory. You deal with them directly, in their time zone, under their contract.
2. An agent. They introduce you to a factory and step back. Your contract is still with the factory.
3. A company in your own country that takes responsibility for the order.

We are the third kind. Desert Kingdom Traders is a US company. You contract with us and you pay us. Depending on the product, we make it in our own factory in Jodhpur, manage it through a partner workshop, or buy it finished and sell it to you.

In all 3 cases the responsible supplier is us. There is nobody else for you to chase.

Whoever you buy from, get that answer in writing before you send a deposit.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-05', 'How long does a first order from India really take? Here is the honest math.', 'post', 'How India works', 'draft', 'How long does a first order from India really take? Here is the honest math.

Sample: up to 2 weeks to make, plus the courier and your time to review it.
Production: 50 to 60 days after you approve the sample.
Ocean freight: 45 to 60 days. A full container is usually nearer 45. A shared container is usually nearer 60.

Add it up and you are at 109 to 134 days before anything unexpected. Plan on four to five months from an approved drawing to your warehouse.

So if you want a product on the shelf for next fall, the conversation starts in the spring. Not in August.

The most common mistake I see is not a quality mistake. It is a calendar mistake.', 'text. A simple timeline graphic would work well here.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-06', 'This is the most important object in our factory.', 'post', 'From the floor', 'draft', 'This is the most important object in our factory.

It is a customer''s approved sample. It sits on the floor for the entire production run, and it is the reference every piece gets checked against.

We check 3 times. The first piece off the line. Again in the middle of the run, while there is still time to correct something. And once more before anything is packed, with photos sent to the customer.

If we find a problem, the customer hears about it from us before anything ships.', 'photo.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-07', 'Our payment terms fit in one line: 30% to start production, 70% on shipment from the factory.', 'post', 'How we work', 'draft', 'Our payment terms fit in one line: 30% to start production, 70% on shipment from the factory.

And our quotes are valid for 30 days.

People sometimes ask why only 30. Wood, iron and stone prices move. After a month, the honest thing is to requote, not to hold a price we can no longer honor and make it up somewhere you can''t see.

A quote from us costs nothing. Send a drawing or a photo with your quantity and target size, and you get pricing back with the lead time and the shipping term attached.

I would always rather tell you a real number today than a nice number that changes later.', 'text. First comment: link to the terms page.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-08', 'Five reasons you should not manufacture in India.', 'post', 'Straight answers', 'draft', 'Five reasons you should not manufacture in India.

1. You need it in six weeks. Standard production alone is 50 to 60 days, and then it has to cross an ocean.

2. "Made in USA" is your brand. Then it should stay that way.

3. You need every piece to be identical. Wood and stone vary. We hold the dimensions, finish, construction and packing constant. The grain is up to the tree.

4. You don''t have time to approve a sample. We will not start production without one, so we would just be waiting on each other.

5. You want the lowest price on earth and nothing else matters. Someone will always quote less. Ask them who is responsible when it goes wrong.

If none of those is you, India is worth a serious look.', 'text. This is the post most likely to travel. Reply to every comment.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-09', 'Aaron Hughes runs Leavitt Bay Coffee on his own. He sells on Amazon. This is what he wrote about working with us:', 'post', 'Customer voice', 'draft', 'Aaron Hughes runs Leavitt Bay Coffee on his own. He sells on Amazon. This is what he wrote about working with us:

"DKT is my go to for product development & manufacturing. As a 1 man business, it''s nice to be able to dream up new product lines and work with Caleb and Parker to make that vision into a reality. They fit my needs perfectly."

I''m sharing it because of the first half of the second sentence. A 1 man business.

You do not need a sourcing department to make a product overseas. You need an idea, a target cost, and someone on the ground who answers for the result.', 'text with a product photo.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-10', 'A container holds less than the brochure says.', 'post', 'How India works', 'draft', 'A container holds less than the brochure says.

A 20 foot container is 33 cubic meters on paper. Plan on 28.
A 40 foot is 67 on paper. Plan on 58.
A 40 foot high cube is 76 on paper. Plan on 66.

The gap is real life: cartons are not liquid, pallets take space, and nothing packs to the last inch.

Two more things I tell every first-time buyer. A 20 foot is rarely the right box for furniture. And with stone, you hit the weight limit long before you fill the space.

Size your first order off the planning number, not the brochure number.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-11', '"Can you go faster?"', 'post', 'How we work', 'draft', '"Can you go faster?"

Yes. Standard production is 50 to 60 days. Anything under 40 days is a rush order, and it adds 5%. That covers the extra labor and moving your order ahead in the line.

Here is what a rush order does not do: skip the sample.

A rush shortens production. It does not shorten approval. You still hold a physical sample and sign off on it before we build.

That one step is what stops an expensive mistake from reaching the container. I have never met a deadline worth shipping the wrong product for.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-12', 'Merry Christmas from all of us at Desert Kingdom Traders.', 'post', 'From us', 'draft', 'Merry Christmas from all of us at Desert Kingdom Traders.

To the customers who trusted us with a product this year: thank you. Every one of them started as a drawing, a photo or a rough idea, and none of them went into production until you had approved a sample in your own hands.

We''ll be back at it next week. In 2027 I''d like to help a few more people find out what is possible.', 'text with a team or factory photo. Short on purpose. If you would rather not post on Christmas Day, move it to Thursday 24 December.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-13', '"Do I have to be a big buyer to work with you?"', 'post', 'Straight answers', 'draft', '"Do I have to be a big buyer to work with you?"

No.

We do have minimums. They are real, and they come from production efficiency, not from a policy someone wrote. Setting up for a small run takes much of the same work as setting up for a large one.

But a first order below the minimum is usually possible. It carries a surcharge of 10 to 15%, depending on the item, to cover setup and calibration.

My advice: tell us your real quantity at the start. We will tell you whether the numbers still leave you a margin. If they don''t, you have lost nothing but an email.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-14', 'FOB is three letters that decide who pays for what.', 'post', 'How India works', 'draft', 'FOB is three letters that decide who pays for what.

We quote FOB Nhava Sheva as standard. Nhava Sheva is the port outside Mumbai. FOB means our price covers the goods, packed and loaded onto the vessel.

From there it is yours: ocean freight, insurance, customs duty, your broker, and the truck to your warehouse.

That is not the only way to buy. We also quote Ex Works, where you collect from the factory, and delivered to your warehouse with duty unpaid, and most things in between.

If you have never imported before, delivered duty unpaid is usually the one to ask about. It is 1 delivery to your door, and you learn the rest on the second order.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-15', 'Three things we will not change in 2027.', 'post', 'How we work', 'draft', 'Three things we will not change in 2027.

1. You will approve a physical sample before we produce anything.

2. You will contract with one US company that is responsible for the order from the first sketch until the container leaves port.

3. If your idea won''t work at your target cost, we will tell you before you pay for a sample.

Everything else we are trying to get better at. Happy New Year.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-16', 'If you are planning a product for 2027, here is an easy first step.', 'post', 'Offer', 'draft', 'If you are planning a product for 2027, here is an easy first step.

Send me one thing: a drawing, a photo, a link to a competitor''s product, or a sketch on a napkin. Add your target quantity and what you need it to cost landed.

I''ll come back with whether it can be made, which part of India would make it, how it would pack, and roughly what it costs.

It costs nothing, and the quote is good for 30 days.

This is also the stage where we say no if the numbers don''t work for you. That is far better for both of us than finding out later.

Link in the comments, or message me here.', 'text. First comment: link to the new site''s start page.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-17', '"What happens if the quality is wrong?"', 'post', 'How we work', 'draft', '"What happens if the quality is wrong?"

The answer I believe in: catch it before it sails.

We welcome third-party inspection, and we''ll suggest independent agencies you can hire yourself. If flying someone out is more than the order justifies, we walk the goods on a live video call before they are packed.

You also get photos from our own pre-pack inspection on every order.

A supplier who gets nervous when you mention an outside inspector is telling you something. Ask every supplier that 1 question, including us.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-18', 'Every piece of furniture we make is finished by hand, in our own factory in Jodhpur.', 'post', 'From the floor', 'draft', 'Every piece of furniture we make is finished by hand, in our own factory in Jodhpur.

Machines can cut and shape. The finish is done by people, and each piece is checked against the sample the customer approved.

Standard production is 50 to 60 days, and a good share of that care goes into the part your customer touches first.', 'photo or a 20-second video.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-19', '"If I send you my design, who owns it?"', 'post', 'Straight answers', 'draft', '"If I send you my design, who owns it?"

You do.

Designs and concepts you bring to us stay yours. We protect them, and we will sign an NDA before you send anything.

There is one other case, and I''d rather say it plainly. If the design and engineering came from our team, we keep the rights and may offer that product to other buyers. If you want something we developed to be exclusive to you, raise it when we quote and we''ll put it in writing.

2 cases, both in writing before any work starts.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-20', 'Selling on Amazon? Say so in your first message to any factory.', 'post', 'How India works', 'draft', 'Selling on Amazon? Say so in your first message to any factory.

FBA-ready means each unit is packed in its own carton, sized and labeled to Amazon''s requirements, so the shipment goes from the port to a fulfillment center without being repacked.

It changes the carton design. It changes the cost per unit. And it is expensive to add after the fact.

We pack for the route the goods are actually taking: FBA-ready cartons for Amazon, flat-pack where freight is the constraint, crated when it has to arrive ready to place.

1 sentence at the quoting stage saves a repacking bill at the other end.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-21', 'Danny is the CEO of Chicken Coop Company. Here is what he said after working with us:', 'post', 'Customer voice', 'draft', 'Danny is the CEO of Chicken Coop Company. Here is what he said after working with us:

"You don''t know what''s possible until you talk to Desert Kingdom. They make what seems impossible possible."

I like the quote, but I want to add the unglamorous half. Part of finding out what is possible is finding out what isn''t. The first thing we do with any idea is check whether it can be built at the price you need. Sometimes the answer is no, and we say so before you have spent anything on a sample.

2 answers are useful to a buyer: yes, and a fast no.', 'text with a product photo.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-22', 'Not everything needs to be manufactured for you.', 'post', 'How India works', 'draft', 'Not everything needs to be manufactured for you.

If something close to what you want is already made somewhere in India, we''ll find it, check it, and sell it to you as a finished product. That is usually quicker than a custom run, and we''ll tell you when it is the better option.

Custom makes sense when the design is yours and it is the reason people buy. Sourcing makes sense when you are filling out a catalog or testing a new category before you commit.

Either way you are buying from the same US company, on the same terms: 30% to start, 70% on shipment.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-23', 'Your second order will not be identical to your first. Anyone who promises otherwise is not working in wood or stone.', 'post', 'Straight answers', 'draft', 'Your second order will not be identical to your first. Anyone who promises otherwise is not working in wood or stone.

Here is what we do hold constant:

The dimensions, to the tolerance on the drawing.
The finish.
The construction.
The packing.
The factory.

And your approved sample stays on file as the reference for every reorder.

5 things fixed, 1 thing that belongs to nature. Tell your customers that part too. It is why they wanted real wood in the first place.', 'text.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)'),
  ('li-post-24', '"Can I visit the factory?"', 'post', 'Offer', 'draft', '"Can I visit the factory?"

Yes, and we''d like you to.

Tell us when you''re coming and we''ll build the trip around what you are making, not around a showroom. That usually means more than one place.

If you can''t travel, ask for floor photos or a video walkthrough of your own order while it is in production. You''ll get them.

8 weeks ago I said I would post how this really works. That was post 1, and this is post 24. If something here made you think of a product, send me a message. A quote is free and good for 30 days.', 'text with a factory photo.', 'dkt-gtm/linkedin/linkedin-plan-and-posts.md (old 8-week plan, needs a pass against the content playbook)')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.content_slots (piece_id, channel, slot_date, slot_time_ct, status) VALUES
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-01'), 'linkedin', '2026-11-30', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-02'), 'linkedin', '2026-12-02', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-03'), 'linkedin', '2026-12-04', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-04'), 'linkedin', '2026-12-07', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-05'), 'linkedin', '2026-12-09', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-06'), 'linkedin', '2026-12-11', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-07'), 'linkedin', '2026-12-14', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-08'), 'linkedin', '2026-12-16', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-09'), 'linkedin', '2026-12-18', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-10'), 'linkedin', '2026-12-21', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-11'), 'linkedin', '2026-12-23', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-12'), 'linkedin', '2026-12-25', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-13'), 'linkedin', '2026-12-28', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-14'), 'linkedin', '2026-12-30', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-15'), 'linkedin', '2027-01-01', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-16'), 'linkedin', '2027-01-04', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-17'), 'linkedin', '2027-01-06', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-18'), 'linkedin', '2027-01-08', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-19'), 'linkedin', '2027-01-11', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-20'), 'linkedin', '2027-01-13', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-21'), 'linkedin', '2027-01-15', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-22'), 'linkedin', '2027-01-18', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-23'), 'linkedin', '2027-01-20', '08:00', 'planned'),
  ((SELECT id FROM public.content_pieces WHERE slug='li-post-24'), 'linkedin', '2027-01-22', '08:00', 'planned')
ON CONFLICT (piece_id, channel, slot_date) DO NOTHING;
