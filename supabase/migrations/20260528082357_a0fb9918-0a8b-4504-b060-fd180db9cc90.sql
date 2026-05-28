
CREATE TABLE public.monthly_report_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  employee_id text NOT NULL,
  reference_year int NOT NULL,
  reference_month int NOT NULL,
  clickwrap_version int NOT NULL DEFAULT 1,
  clickwrap_text text NOT NULL DEFAULT '',
  clickwrap_text_hash text NOT NULL,
  content_hash text NOT NULL,
  signed_by_name text NOT NULL DEFAULT '',
  signed_by_user_id uuid,
  signature_method text NOT NULL DEFAULT 'clickwrap',
  ip_origin inet,
  user_agent text,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_filename text NOT NULL DEFAULT '',
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_mrs_tenant_employee_period
  ON public.monthly_report_signatures (tenant_id, employee_id, reference_year, reference_month);

GRANT SELECT, INSERT ON public.monthly_report_signatures TO authenticated;
GRANT ALL ON public.monthly_report_signatures TO service_role;
GRANT SELECT, INSERT ON public.monthly_report_signatures TO anon;

ALTER TABLE public.monthly_report_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mrs read"
  ON public.monthly_report_signatures
  FOR SELECT TO authenticated
  USING (public.can_read_tenant(auth.uid(), tenant_id));

CREATE POLICY "mrs insert"
  ON public.monthly_report_signatures
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));

CREATE POLICY "mrs demo read"
  ON public.monthly_report_signatures
  FOR SELECT TO anon
  USING (tenant_id = 'demo-tenant');

CREATE POLICY "mrs demo insert"
  ON public.monthly_report_signatures
  FOR INSERT TO anon
  WITH CHECK (tenant_id = 'demo-tenant');

CREATE TRIGGER mrs_set_ip
  BEFORE INSERT ON public.monthly_report_signatures
  FOR EACH ROW EXECUTE FUNCTION public.consent_audit_set_ip();
