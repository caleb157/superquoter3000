CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(user_id uuid, email text, display_name text, created_at timestamptz, roles text[])
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS user_id,
    u.email::text,
    p.display_name,
    u.created_at,
    COALESCE(ARRAY_AGG(ur.role::text) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY u.id, u.email, p.display_name, u.created_at
  ORDER BY u.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_role(_target_user_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;

  -- Replace any existing role for this user with the new single role
  DELETE FROM public.user_roles WHERE user_id = _target_user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_target_user_id, _role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_user_role(_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _target_user_id;
END;
$$;