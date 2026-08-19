DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Users can view own profile"
ON public.profiles FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admin and team can view profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.is_admin_or_team(auth.uid()));

REVOKE ALL ON public.vendor_rfq_responses FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_rfq_responses TO authenticated;
GRANT ALL ON public.vendor_rfq_responses TO service_role;

CREATE POLICY "Deny anonymous access to vendor responses"
ON public.vendor_rfq_responses AS RESTRICTIVE FOR ALL TO anon
USING (false) WITH CHECK (false);