
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_tenant(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_tenant(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_write_tenant(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tenant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_tenant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_tenant(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_tenant(uuid, text) TO authenticated;
