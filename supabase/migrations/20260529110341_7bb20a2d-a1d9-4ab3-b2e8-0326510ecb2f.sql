-- Helpers usadas apenas dentro de policies RLS (avaliadas com privilégio do dono da policy).
-- Revogar EXECUTE de authenticated elimina os warnings sem quebrar nada.

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)         FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[])   FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid)                    FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant(uuid)                   FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.can_manage_tenant(uuid, text)           FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.can_read_tenant(uuid, text)             FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.can_write_tenant(uuid, text)            FROM authenticated;