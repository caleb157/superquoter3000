
ALTER TABLE public.quote_snapshots
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE DEFAULT (gen_random_uuid())::text;

-- Allow anon to read quote snapshots by share token (for public portal)
CREATE POLICY "Public can view quotes by share token"
  ON public.quote_snapshots
  FOR SELECT
  TO anon
  USING (share_token IS NOT NULL);

-- Allow anon to update customer_selections and status on quotes
CREATE POLICY "Public can update customer selections by share token"
  ON public.quote_snapshots
  FOR UPDATE
  TO anon
  USING (share_token IS NOT NULL)
  WITH CHECK (share_token IS NOT NULL);
