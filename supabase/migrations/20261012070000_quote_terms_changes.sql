-- Quote Terms changelog: one row per save of an entity's terms list in Settings → Quote Terms,
-- with plain-words change lines and the list as saved. Safe to run more than once.

CREATE TABLE IF NOT EXISTS public.quote_terms_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES public.company_entities(id) ON DELETE CASCADE,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid DEFAULT auth.uid(),
  changed_by_name text,
  changes jsonb NOT NULL DEFAULT '[]'::jsonb,  -- e.g. ["Added \"Warranty\"", "Changed the text of \"Lead time\""]
  terms jsonb                                  -- the full list after this change
);
CREATE INDEX IF NOT EXISTS quote_terms_changes_entity_idx
  ON public.quote_terms_changes(entity_id, changed_at DESC);

ALTER TABLE public.quote_terms_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin/team can manage quote terms changes" ON public.quote_terms_changes;
CREATE POLICY "Admin/team can manage quote terms changes"
  ON public.quote_terms_changes FOR ALL TO authenticated
  USING (public.is_admin_or_team(auth.uid()))
  WITH CHECK (public.is_admin_or_team(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_terms_changes TO authenticated;
GRANT ALL ON public.quote_terms_changes TO service_role;
