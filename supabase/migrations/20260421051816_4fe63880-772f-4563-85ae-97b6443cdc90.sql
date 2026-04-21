DROP POLICY IF EXISTS "Admin can modify customers" ON public.customers;

CREATE POLICY "Admin/team can modify customers"
ON public.customers
FOR ALL
TO authenticated
USING (is_admin_or_team(auth.uid()))
WITH CHECK (is_admin_or_team(auth.uid()));