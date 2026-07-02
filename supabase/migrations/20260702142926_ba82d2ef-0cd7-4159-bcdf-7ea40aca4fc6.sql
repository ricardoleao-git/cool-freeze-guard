
CREATE TABLE public.demo_bypass_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  function_name text NOT NULL,
  ip_origin inet,
  user_agent text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.demo_bypass_audit_log TO authenticated;
GRANT ALL ON public.demo_bypass_audit_log TO service_role;
ALTER TABLE public.demo_bypass_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin reads demo bypass log" ON public.demo_bypass_audit_log
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
CREATE INDEX idx_demo_bypass_audit_log_created ON public.demo_bypass_audit_log (created_at DESC);
CREATE INDEX idx_demo_bypass_audit_log_tenant ON public.demo_bypass_audit_log (tenant_id, created_at DESC);
