CREATE TABLE public.consent_renewal_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id text NOT NULL,
  employee_id text NOT NULL,
  consent_version integer NOT NULL,
  previous_version integer,
  reason text NOT NULL DEFAULT 'version_bump',
  channel text NOT NULL DEFAULT 'in_app',
  status text NOT NULL DEFAULT 'pending',
  message text NOT NULL DEFAULT '',
  created_by_user_id uuid,
  created_by_name text,
  sent_at timestamp with time zone,
  acknowledged_at timestamp with time zone,
  acknowledged_consent_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_renewal_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_renewal_notifications TO anon;
GRANT ALL ON public.consent_renewal_notifications TO service_role;

ALTER TABLE public.consent_renewal_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crn read" ON public.consent_renewal_notifications
  FOR SELECT TO authenticated USING (can_read_tenant(auth.uid(), tenant_id));
CREATE POLICY "crn insert" ON public.consent_renewal_notifications
  FOR INSERT TO authenticated WITH CHECK (can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "crn update" ON public.consent_renewal_notifications
  FOR UPDATE TO authenticated USING (can_write_tenant(auth.uid(), tenant_id))
  WITH CHECK (can_write_tenant(auth.uid(), tenant_id));
CREATE POLICY "crn delete" ON public.consent_renewal_notifications
  FOR DELETE TO authenticated USING (can_manage_tenant(auth.uid(), tenant_id));

CREATE POLICY "crn demo read" ON public.consent_renewal_notifications
  FOR SELECT TO anon USING (tenant_id = 'demo-tenant');
CREATE POLICY "crn demo insert" ON public.consent_renewal_notifications
  FOR INSERT TO anon WITH CHECK (tenant_id = 'demo-tenant');
CREATE POLICY "crn demo update" ON public.consent_renewal_notifications
  FOR UPDATE TO anon USING (tenant_id = 'demo-tenant') WITH CHECK (tenant_id = 'demo-tenant');
CREATE POLICY "crn demo delete" ON public.consent_renewal_notifications
  FOR DELETE TO anon USING (tenant_id = 'demo-tenant');

CREATE INDEX idx_crn_tenant_status ON public.consent_renewal_notifications (tenant_id, status, created_at DESC);
CREATE INDEX idx_crn_employee ON public.consent_renewal_notifications (tenant_id, employee_id, consent_version);

CREATE OR REPLACE FUNCTION public.touch_consent_renewal_notifications()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crn_updated_at
  BEFORE UPDATE ON public.consent_renewal_notifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_consent_renewal_notifications();