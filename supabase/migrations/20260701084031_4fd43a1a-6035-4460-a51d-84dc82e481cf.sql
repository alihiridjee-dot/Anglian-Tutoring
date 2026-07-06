
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role, postgres;
