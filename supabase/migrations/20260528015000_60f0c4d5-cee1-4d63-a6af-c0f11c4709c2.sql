
CREATE TABLE public.consent_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id text NOT NULL,
  employee_id text NOT NULL,
  consent_id uuid,
  event_type text NOT NULL,
  consent_version integer,
  acted_by_user_id uuid,
  acted_by_email text,
  acted_by_name text,
  reason text,
  ip_origin inet,
  user_agent text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.consent_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.consent_audit_log TO anon;
GRANT ALL ON public.consent_audit_log TO service_role;

ALTER TABLE public.consent_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cal read"
  ON public.consent_audit_log FOR SELECT TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

CREATE POLICY "cal insert"
  ON public.consent_audit_log FOR INSERT TO authenticated
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));

CREATE POLICY "cal demo read"
  ON public.consent_audit_log FOR SELECT TO anon
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "cal demo insert"
  ON public.consent_audit_log FOR INSERT TO anon
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE INDEX consent_audit_log_tenant_emp_idx
  ON public.consent_audit_log (tenant_id, employee_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.consent_audit_set_ip()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ip_origin IS NULL THEN
    BEGIN
      NEW.ip_origin := inet_client_addr();
    EXCEPTION WHEN OTHERS THEN
      NEW.ip_origin := NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consent_audit_log_fill_ip
  BEFORE INSERT ON public.consent_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.consent_audit_set_ip();
