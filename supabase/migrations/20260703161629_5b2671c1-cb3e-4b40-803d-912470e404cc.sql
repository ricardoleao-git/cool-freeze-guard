GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_tenant(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_tenant(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_tenant(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_tenant(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_tenant(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_read_tenant(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_write_tenant(uuid, text) FROM anon;