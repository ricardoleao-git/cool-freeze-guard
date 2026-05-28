
CREATE TABLE public.access_event_corrections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_id UUID NOT NULL,
  employee_id TEXT NOT NULL,
  original_event_type TEXT NOT NULL,
  original_occurred_at TIMESTAMPTZ NOT NULL,
  new_event_type TEXT,
  new_occurred_at TIMESTAMPTZ,
  reason_category TEXT NOT NULL DEFAULT 'outro',
  reason_detail TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by_user_id UUID,
  requested_by_name TEXT NOT NULL DEFAULT '',
  approved_by_user_id UUID,
  approved_by_name TEXT,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  employee_notified_at TIMESTAMPTZ,
  employee_response TEXT,
  employee_responded_at TIMESTAMPTZ,
  supervisor_validation TEXT,
  evidence_attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aec_tenant_event ON public.access_event_corrections(tenant_id, event_id);
CREATE INDEX idx_aec_tenant_status ON public.access_event_corrections(tenant_id, status, created_at DESC);
CREATE INDEX idx_aec_employee ON public.access_event_corrections(tenant_id, employee_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_event_corrections TO authenticated;
GRANT ALL ON public.access_event_corrections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.access_event_corrections TO anon;

ALTER TABLE public.access_event_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aec read" ON public.access_event_corrections
  FOR SELECT TO authenticated USING (public.can_read_tenant(auth.uid(), tenant_id));
CREATE POLICY "aec insert" ON public.access_event_corrections
  FOR INSERT TO authenticated WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "aec update" ON public.access_event_corrections
  FOR UPDATE TO authenticated USING (public.can_write_tenant(auth.uid(), tenant_id))
  WITH CHECK (public.can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "aec delete" ON public.access_event_corrections
  FOR DELETE TO authenticated USING (public.can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "aec demo read" ON public.access_event_corrections
  FOR SELECT TO anon USING (tenant_id = 'demo-tenant');
CREATE POLICY "aec demo insert" ON public.access_event_corrections
  FOR INSERT TO anon WITH CHECK (tenant_id = 'demo-tenant');
CREATE POLICY "aec demo update" ON public.access_event_corrections
  FOR UPDATE TO anon USING (tenant_id = 'demo-tenant') WITH CHECK (tenant_id = 'demo-tenant');
CREATE POLICY "aec demo delete" ON public.access_event_corrections
  FOR DELETE TO anon USING (tenant_id = 'demo-tenant');

CREATE TRIGGER trg_aec_touch
  BEFORE UPDATE ON public.access_event_corrections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
