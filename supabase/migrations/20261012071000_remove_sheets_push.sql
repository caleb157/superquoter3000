-- The Google Sheets projection push was removed from the app (no push button since PR #9,
-- and the push-projections-to-sheets function is deleted). Drops its settings and log.
-- Safe to run more than once.
DROP TABLE IF EXISTS public.projection_push_log;
ALTER TABLE public.global_settings
  DROP COLUMN IF EXISTS projections_sheet_id,
  DROP COLUMN IF EXISTS projections_sheet_tab_name;
