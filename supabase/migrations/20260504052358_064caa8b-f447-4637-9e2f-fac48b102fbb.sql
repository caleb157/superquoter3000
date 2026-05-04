DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE OR REPLACE FUNCTION public.admin_list_users()
 RETURNS TABLE(user_id uuid, email text, display_name text, assignee_code text, created_at timestamp with time zone, roles text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    u.id AS user_id,
    u.email::text,
    p.display_name,
    p.assignee_code,
    u.created_at,
    COALESCE(ARRAY_AGG(ur.role::text) FILTER (WHERE ur.role IS NOT NULL), '{}') AS roles
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY u.id, u.email, p.display_name, p.assignee_code, u.created_at
  ORDER BY u.created_at DESC;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_assignee_code(_target_user_id uuid, _code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can change assignee codes';
  END IF;
  UPDATE public.profiles
    SET assignee_code = NULLIF(trim(_code), '')
    WHERE user_id = _target_user_id;
END;
$function$;