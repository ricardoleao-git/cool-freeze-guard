
-- 1) Employees: prevent anon from reading PIN-related sensitive columns
REVOKE SELECT ON public.employees FROM anon;
GRANT SELECT (
  id, tenant_id, unit_id, department_id, name, registration_number,
  position, avatar, status, current_status, accumulated_minutes,
  inside_since, current_area_id, break_started_at, updated_at,
  created_at, origem, pin_set_at
) ON public.employees TO anon;

-- Also restrict pin_hash from authenticated; PIN validation runs via service_role edge functions.
REVOKE SELECT ON public.employees FROM authenticated;
GRANT SELECT (
  id, tenant_id, unit_id, department_id, name, registration_number,
  position, avatar, status, current_status, accumulated_minutes,
  inside_since, current_area_id, break_started_at, updated_at,
  created_at, origem, pin_set_at, pin_failed_attempts, pin_locked_until
) ON public.employees TO authenticated;

-- 2) daily_statement_confirmations: add demo-tenant anon policies so the public kiosk flow works
GRANT SELECT, INSERT ON public.daily_statement_confirmations TO anon;

CREATE POLICY "dsc demo anon read"
  ON public.daily_statement_confirmations
  FOR SELECT TO anon
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "dsc demo anon insert"
  ON public.daily_statement_confirmations
  FOR INSERT TO anon
  WITH CHECK (tenant_id = 'demo-tenant');

-- 3) integration_config.guardia_token: restrict reads to service_role; admins may write but not read it back
REVOKE SELECT ON public.integration_config FROM authenticated;
GRANT SELECT (
  id, tenant_id, guardia_url, sync_interval, active,
  last_sync_at, last_sync_count, created_at, updated_at,
  janela_tolerancia_segundos, sessao_longa_alerta_minutos,
  auth_header_name, auth_scheme, api_base_path, events_endpoint,
  last_event_poll_at, last_event_cursor, last_push_at, last_push_count,
  last_event_error, last_event_error_at, events_processed_total,
  cron_interval_minutes, stale_error_threshold_minutes
) ON public.integration_config TO authenticated;
-- INSERT/UPDATE of guardia_token still allowed via existing policies; column may be written but not selected.
