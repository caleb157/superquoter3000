
-- Fix privilege escalation: replace ALL policy with separate policies that properly guard INSERT with WITH CHECK
DROP POLICY IF EXISTS "Admin can manage roles" ON public.user_roles;

-- SELECT: admins see all, users see own (already exists via separate policy)
CREATE POLICY "Admin can select all roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- INSERT: only admins can insert roles
CREATE POLICY "Admin can insert roles"
  ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- UPDATE: only admins can update roles
CREATE POLICY "Admin can update roles"
  ON public.user_roles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- DELETE: only admins can delete roles
CREATE POLICY "Admin can delete roles"
  ON public.user_roles FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
