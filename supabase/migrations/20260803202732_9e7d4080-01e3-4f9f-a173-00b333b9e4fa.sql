UPDATE public.employees
SET portal_password_hash = NULL,
    portal_password_set_at = NULL,
    portal_must_change_password = true,
    portal_failed_attempts = 0,
    portal_locked_until = NULL
WHERE tenant_id = 'demo-tenant';