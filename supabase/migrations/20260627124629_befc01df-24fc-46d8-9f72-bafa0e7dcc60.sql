-- Audit log for GuardIA integration (errors + key events from polling/sync/dispatch)
CREATE TABLE IF NOT EXISTS public.integration_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  integration text NOT NULL DEFAULT 'guardia',
  source text NOT NULL,            -- 'poll' | 'push' | 'webhook' | 'cron' | 'backfill'
  severity text NOT NULL DEFAULT 'info', -- 'info' | 'warn' | 'error'
  code text,                       -- 'auth_failed' | 'timeout' | 'normalize_failed' | 'http_error' | 'ok' | ...
  message text,
  details jsonb,
  cursor_used text,
  fetched_count int,
  processed_count int,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.integration_audit_log TO authenticated;
GRANT ALL ON public.integration_audit_log TO service_role;
ALTER TABLE public.integration_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_read_tenant" ON public.integration_audit_log
  FOR SELECT TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE INDEX IF NOT EXISTS idx_integration_audit_tenant_time
  ON public.integration_audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_audit_severity
  ON public.integration_audit_log (tenant_id, severity, created_at DESC);

-- Add backfill bookkeeping columns to integration_config
ALTER TABLE public.integration_config
  ADD COLUMN IF NOT EXISTS last_event_error text,
  ADD COLUMN IF NOT EXISTS last_event_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS events_processed_total bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cron_interval_minutes int NOT NULL DEFAULT 10;

-- Enable cron + net extensions for scheduled polling
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
