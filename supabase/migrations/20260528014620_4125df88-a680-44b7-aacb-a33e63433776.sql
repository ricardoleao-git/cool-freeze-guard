
CREATE TABLE public.retention_purge_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id text NOT NULL,
  run_at timestamptz NOT NULL DEFAULT now(),
  triggered_by text NOT NULL DEFAULT 'cron',
  cutoff_logs timestamptz,
  cutoff_biometric timestamptz,
  cutoff_occurrences timestamptz,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_access_events integer NOT NULL DEFAULT 0,
  deleted_alerts integer NOT NULL DEFAULT 0,
  deleted_thermal_breaks integer NOT NULL DEFAULT 0,
  deleted_occurrences integer NOT NULL DEFAULT 0,
  deleted_consents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.retention_purge_log TO authenticated;
GRANT SELECT ON public.retention_purge_log TO anon;
GRANT ALL ON public.retention_purge_log TO service_role;

ALTER TABLE public.retention_purge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rpl read"
  ON public.retention_purge_log FOR SELECT
  TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

CREATE POLICY "rpl demo read"
  ON public.retention_purge_log FOR SELECT
  TO anon
  USING (tenant_id = 'demo-tenant');

CREATE INDEX retention_purge_log_tenant_run ON public.retention_purge_log (tenant_id, run_at DESC);
