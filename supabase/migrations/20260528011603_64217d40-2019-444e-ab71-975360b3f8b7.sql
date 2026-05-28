
CREATE TABLE IF NOT EXISTS public.tenant_settings (
  tenant_id text PRIMARY KEY,
  biometric_retention_days integer NOT NULL DEFAULT 180,
  logs_retention_days integer NOT NULL DEFAULT 730,
  occurrences_retention_days integer NOT NULL DEFAULT 1825,
  consent_version integer NOT NULL DEFAULT 1,
  consent_text text NOT NULL DEFAULT '',
  lawful_basis text NOT NULL DEFAULT 'obrigacao_legal',
  dpo_name text NOT NULL DEFAULT '',
  dpo_email text NOT NULL DEFAULT '',
  privacy_policy_url text NOT NULL DEFAULT '',
  require_consent_before_capture boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO authenticated;
GRANT ALL ON public.tenant_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO anon;

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ts read" ON public.tenant_settings FOR SELECT TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));
CREATE POLICY "ts insert" ON public.tenant_settings FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_tenant(auth.uid(), tenant_id));
CREATE POLICY "ts update" ON public.tenant_settings FOR UPDATE TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_manage_tenant(auth.uid(), tenant_id));
CREATE POLICY "ts delete" ON public.tenant_settings FOR DELETE TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "ts demo read" ON public.tenant_settings FOR SELECT TO anon
  USING (tenant_id = 'demo-tenant');
CREATE POLICY "ts demo insert" ON public.tenant_settings FOR INSERT TO anon
  WITH CHECK (tenant_id = 'demo-tenant');
CREATE POLICY "ts demo update" ON public.tenant_settings FOR UPDATE TO anon
  USING (tenant_id = 'demo-tenant') WITH CHECK (tenant_id = 'demo-tenant');
CREATE POLICY "ts demo delete" ON public.tenant_settings FOR DELETE TO anon
  USING (tenant_id = 'demo-tenant');

DROP TRIGGER IF EXISTS trg_tenant_settings_updated ON public.tenant_settings;
CREATE TRIGGER trg_tenant_settings_updated
  BEFORE UPDATE ON public.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.employee_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  employee_id text NOT NULL,
  consent_version integer NOT NULL DEFAULT 1,
  scope text[] NOT NULL DEFAULT ARRAY['biometric_facial','access_logs']::text[],
  status text NOT NULL DEFAULT 'active',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  accepted_by text NOT NULL DEFAULT '',
  signature_text text NOT NULL DEFAULT '',
  ip_origin inet,
  user_agent text,
  consent_text_snapshot text NOT NULL DEFAULT '',
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_consents TO authenticated;
GRANT ALL ON public.employee_consents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_consents TO anon;

ALTER TABLE public.employee_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ec read" ON public.employee_consents FOR SELECT TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));
CREATE POLICY "ec write" ON public.employee_consents FOR INSERT TO authenticated
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "ec update" ON public.employee_consents FOR UPDATE TO authenticated
  USING (public.can_write_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "ec delete" ON public.employee_consents FOR DELETE TO authenticated
  USING (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "ec demo read" ON public.employee_consents FOR SELECT TO anon
  USING (tenant_id = 'demo-tenant');
CREATE POLICY "ec demo insert" ON public.employee_consents FOR INSERT TO anon
  WITH CHECK (tenant_id = 'demo-tenant');
CREATE POLICY "ec demo update" ON public.employee_consents FOR UPDATE TO anon
  USING (tenant_id = 'demo-tenant') WITH CHECK (tenant_id = 'demo-tenant');
CREATE POLICY "ec demo delete" ON public.employee_consents FOR DELETE TO anon
  USING (tenant_id = 'demo-tenant');

CREATE INDEX IF NOT EXISTS idx_employee_consents_tenant_emp
  ON public.employee_consents(tenant_id, employee_id, accepted_at DESC);
