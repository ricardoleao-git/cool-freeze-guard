-- Restringe EXECUTE em todas as funções SECURITY DEFINER do schema public
-- Padrão: revogar de PUBLIC e anon; conceder apenas a authenticated (helpers de role)
-- ou a ninguém (funções de trigger — invocadas implicitamente pelo Postgres)

-- =========== Helpers de role (usadas em RLS e podem ser chamadas via RPC pelo app) ===========
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_user_tenant(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_tenant(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_manage_tenant(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_tenant(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_read_tenant(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_read_tenant(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.can_write_tenant(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_write_tenant(uuid, text) TO authenticated, service_role;

-- =========== Funções de trigger (só o sistema/Postgres precisa invocar) ===========
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.access_events_immutable()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.access_events_forensic()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consent_audit_set_ip()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_consent_renewal_notifications() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at()                    FROM PUBLIC, anon, authenticated;

-- service_role mantém EXECUTE em tudo (necessário para edge functions/admin)
GRANT EXECUTE ON FUNCTION public.handle_new_user()                     TO service_role;
GRANT EXECUTE ON FUNCTION public.access_events_immutable()             TO service_role;
GRANT EXECUTE ON FUNCTION public.access_events_forensic()              TO service_role;
GRANT EXECUTE ON FUNCTION public.consent_audit_set_ip()                TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_consent_renewal_notifications() TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_updated_at()                    TO service_role;