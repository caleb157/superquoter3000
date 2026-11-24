-- Sales command center: the Sales landing page's birds-eye view.
-- 1. Email bounces on touches (bounce rate against the 2% rule).
-- 2. sales_schedules learns one-off runs, credit budgets and the real last / next fire (synced from the scheduled tasks).
-- 3. usage_snapshots: Claude plan use and tool balances over time, for the Pro vs Max call.
-- 4. The schedule list brought up to what is really set up on 24 Nov 2026 (all IST).

-- ---------- 1. bounces ----------
ALTER TABLE public.sales_touches ADD COLUMN IF NOT EXISTS bounced_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_sales_touches_out_time ON public.sales_touches (occurred_at DESC) WHERE direction = 'out';

-- ---------- 2. schedules ----------
ALTER TABLE public.sales_schedules
  ADD COLUMN IF NOT EXISTS run_once_at timestamptz,
  ADD COLUMN IF NOT EXISTS credit_budget text,
  ADD COLUMN IF NOT EXISTS last_fired_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_fire_status text,
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS live_since timestamptz;  -- a fire before this is not a missed run

-- ---------- 3. usage snapshots ----------
CREATE TABLE IF NOT EXISTS public.usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,                      -- claude, firecrawl, reoon, waalaxy, apollo, ...
  metric text NOT NULL,                      -- weekly_pct, session_pct, credits_left, credits_used, ...
  value numeric NOT NULL,
  unit text,                                 -- pct, credits, usd
  resets_at timestamptz,
  plan text,
  note text,
  logged_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_snapshots_source_time ON public.usage_snapshots (source, metric, taken_at DESC);

ALTER TABLE public.usage_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team manage usage_snapshots" ON public.usage_snapshots;
CREATE POLICY "Admin/team manage usage_snapshots" ON public.usage_snapshots FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid())) WITH CHECK (public.is_admin_or_team(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usage_snapshots TO authenticated;
GRANT ALL ON public.usage_snapshots TO service_role;

-- Readings already taken (24 Nov 2026 8:30 AM IST from claude.ai/settings/usage; balances from 23 Nov).
INSERT INTO public.usage_snapshots (id, taken_at, source, metric, value, unit, resets_at, plan, note, logged_by) VALUES
 ('7a1d0000-0000-4000-8000-000000000001', '2026-11-24T03:00:00Z', 'claude', 'weekly_pct', 62, 'pct', '2026-11-25T03:00:00Z', 'Max 5x', 'All models, this week', 'command-center seed'),
 ('7a1d0000-0000-4000-8000-000000000002', '2026-11-24T03:00:00Z', 'claude', 'session_pct', 35, 'pct', NULL, 'Max 5x', 'Current session', 'command-center seed'),
 ('7a1d0000-0000-4000-8000-000000000003', '2026-11-24T03:00:00Z', 'claude', 'claude_code_share_pct', 78, 'pct', '2026-11-25T03:00:00Z', 'Max 5x', 'Share of the week used by Claude Code', 'command-center seed'),
 ('7a1d0000-0000-4000-8000-000000000004', '2026-11-23T06:00:00Z', 'waalaxy', 'email_finder_left', 50, 'credits', '2026-12-12T00:00:00Z', NULL, '50 a month, shared team-wide', 'command-center seed'),
 ('7a1d0000-0000-4000-8000-000000000005', '2026-11-23T06:00:00Z', 'apollo', 'lead_credits_left', 0, 'credits', '2027-02-28T00:00:00Z', NULL, '122,110 a year, all used; not renewing after 28 Feb 2027', 'command-center seed')
ON CONFLICT (id) DO NOTHING;

-- ---------- 4. the schedule as set up on 24 Nov 2026 ----------
INSERT INTO public.sales_schedules (id, job, name, cadence, cron, runs_where, what_it_does, status, sort_order, run_once_at, credit_budget, note) VALUES
 ('channel-digest', 'channel-digest', 'Weekly channel digest', 'Mon 8:38 IST', '38 8 * * 1', 'Cloud task', 'Researches the inner-ring channels and writes the weekly digest of free ideas and community nudges.', 'live', 35, NULL, NULL, 'Same job as the Traction digest at 10:23. Keep one.'),
 ('usage-snapshot', 'usage-snapshot', 'Daily Claude usage snapshot', 'Daily 21:47 IST', '47 21 * * *', 'Cloud task (your Chrome)', 'Reads claude.ai usage (session, week, resets) for the Pro vs Max call. Posts only above 80% or on a limit hit.', 'live', 115, NULL, NULL, NULL),
 ('trade-research', 'trade-research', 'Weekly trade research', 'Tue 16:07 IST, from 1 Dec', '7 16 * * 2', 'Cloud task + Mac', '175-250 trade-only companies: website and buyer via Firecrawl, then the Apollo match.', 'live', 32, NULL, 'Stop at 600 Firecrawl', 'First real run 1 Dec; the 26 Nov one-off covers this week.'),
 ('oneoff-crm-load', 'oneoff-crm-load', 'One-off: LinkedIn repliers into the CRM', 'Once, 24 Nov 10:31 IST', NULL, 'Cloud task', 'Brings the ~85 Waalaxy repliers into the CRM and fills the watchdog staging file. Nothing sent.', 'live', 200, '2026-11-24T05:01:00Z', NULL, NULL),
 ('oneoff-ga4', 'oneoff-ga4', 'One-off: GA4 and Search Console tutorial', 'Once, 24 Nov 13:03 IST', NULL, 'Cloud task', 'Step-by-step setup guide for analytics, as a short doc.', 'live', 201, '2026-11-24T07:33:00Z', NULL, NULL),
 ('oneoff-search-terms', 'oneoff-search-terms', 'One-off: search terms and article briefs', 'Once, 24 Nov 14:33 IST', NULL, 'Cloud task', 'Search terms and one brief per piece for the first ~30 content pieces.', 'live', 202, '2026-11-24T09:03:00Z', NULL, NULL),
 ('oneoff-faire', 'oneoff-faire', 'One-off: Faire 50-brand pull', 'Once, 24 Nov 17:07 IST', NULL, 'Cloud task', 'Pulls 50 Faire brands in our categories, fit gate, Apollo match, into the lists.', 'live', 203, '2026-11-24T11:37:00Z', 'Stop at 30 Firecrawl', NULL),
 ('oneoff-contact-research', 'oneoff-contact-research', 'One-off: contacts for this week''s 500', 'Once, 25 Nov 9:07 IST', NULL, 'Cloud task + Mac', 'Finds buyers for the 304 of the 500 with no contact: own data, Apollo export, site pages. Never LinkedIn scraping.', 'live', 204, '2026-11-25T03:37:00Z', 'Stop at 700 Firecrawl', NULL),
 ('oneoff-content-plan', 'oneoff-content-plan', 'One-off: plan the first 30 content pieces', 'Once, 25 Nov 14:07 IST', NULL, 'Cloud task', 'The 30-piece plan with proof and LinkedIn cut-ups; starts the first ~10. Nothing published.', 'live', 205, '2026-11-25T08:37:00Z', NULL, NULL),
 ('oneoff-naming', 'oneoff-naming', 'One-off: naming-permission asks', 'Once, 25 Nov 16:37 IST', NULL, 'Cloud task', 'Drafts the asks to Luxe, Hypernikao, CCT and the home-page logo clients for you to send. Never sent by Claude.', 'live', 206, '2026-11-25T11:07:00Z', NULL, NULL),
 ('oneoff-trade-research', 'oneoff-trade-research', 'One-off: first trade research run (250)', 'Once, 26 Nov 9:07 IST', NULL, 'Cloud task + Mac', '250 trade-only companies: website and buyer, classify, Apollo match.', 'live', 207, '2026-11-26T03:37:00Z', 'Stop at 600 Firecrawl', NULL),
 ('oneoff-first-batch', 'oneoff-first-batch', 'One-off: first outreach batch', 'Once, 26 Nov 12:07 IST', NULL, 'Cloud task', 'Builds the first personal outreach batch for one review sitting. Nothing sent before you approve.', 'live', 208, '2026-11-26T06:37:00Z', NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  job = EXCLUDED.job, name = EXCLUDED.name, cadence = EXCLUDED.cadence, cron = EXCLUDED.cron, runs_where = EXCLUDED.runs_where,
  what_it_does = EXCLUDED.what_it_does, run_once_at = EXCLUDED.run_once_at, credit_budget = EXCLUDED.credit_budget, note = EXCLUDED.note;

-- The rows from the Prospects release: budgets, the real first fire of the daily send, and the duplicate digest.
UPDATE public.sales_schedules SET last_fired_at = '2026-11-23T13:53:27Z', last_fire_status = 'delivered' WHERE id = 'daily-send' AND last_fired_at IS NULL;
UPDATE public.sales_schedules SET note = 'Same job as the channel digest at 8:38. Keep one.' WHERE id = 'traction-digest' AND note IS NULL;
UPDATE public.sales_schedules SET credit_budget = 'Email lookups only for an approved batch' WHERE id = 'list-run' AND credit_budget IS NULL;
UPDATE public.sales_schedules SET credit_budget = 'Reoon only for approved sends' WHERE id = 'outreach-batch' AND credit_budget IS NULL;

-- When each scheduled task was set up, so fires from before it existed are not shown as missed.
UPDATE public.sales_schedules SET live_since = v.since FROM (VALUES
  ('crm-watchdog', '2026-11-23T12:12:19Z'::timestamptz), ('daily-send', '2026-11-23T12:12:40Z'), ('list-run', '2026-11-23T12:12:25Z'),
  ('traction-digest', '2026-11-23T12:12:28Z'), ('outreach-batch', '2026-11-23T12:12:31Z'), ('content-run', '2026-11-23T12:12:34Z'),
  ('website-report', '2026-11-23T12:12:36Z'), ('held-back-review', '2026-11-23T10:53:24Z'), ('brand-review', '2026-11-23T12:12:46Z'),
  ('competitor-note', '2026-11-23T12:13:38Z'), ('weekly-report', '2026-11-23T12:12:43Z'), ('channel-digest', '2026-11-23T12:04:08Z'),
  ('usage-snapshot', '2026-11-24T02:59:27Z'), ('trade-research', '2026-11-24T03:00:25Z')
) AS v(id, since) WHERE sales_schedules.id = v.id AND sales_schedules.live_since IS NULL;
UPDATE public.sales_schedules SET live_since = coalesce(live_since, updated_at) WHERE live_since IS NULL;
